"""Optional pain suggestions through Jev (TypeSafe).

The browser never calls this host. When TYPESAFE_API_KEY is empty, classify_pain
returns None and does not open a connection. Model output is not a pin: this
module returns catalog ids only, never coordinates.
"""

import asyncio
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

import httpx

from .models import PAIN_LEVEL_BANDS, Region

JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL = "jev-latest"
JEV_MIN_CONFIDENCE = 0.5
JEV_TRIGGER_MIN_CONFIDENCE = 0.7
MAX_STATE_CHARS = 4000
CATALOG_PATH = Path(__file__).resolve().parent.parent / "config" / "pain-regions.json"
_ID = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
_MODEL = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
_UNSAFE = set("<>{}")

REGION_QUESTION = (
    "Does the person explicitly report pain or discomfort in this place? "
    "Answer yes only when they name it. Left, right, or both still counts when they name this place. "
    "Do not infer a place from a sport, activity, or a different region."
)
RADIATION_QUESTION = (
    "Does the person say the pain spreads, radiates, shoots, or travels to this place? "
    "Answer yes only when they name that destination. "
    "Do not infer a destination from the source of the pain, a sport, or an activity."
)
TRIGGER_QUESTION = (
    "Does the person say this brings on or worsens the pain? "
    "Answer yes only when their words mention it. "
    "Do not add a trigger they did not say, and do not infer one from a sport, a posture, or another activity."
)
# Choice criteria for each band. The stored 0-10 number comes from PAIN_LEVEL_BANDS, not from the model.
PAIN_LEVEL_CRITERIA = {
    "none": "No pain, or they say none or 0.",
    "mild": "Mild or slight, or a 1, 2, or 3.",
    "moderate": "Moderate, or a 4 or 5.",
    "severe": "Severe or strong, or a 6 or 7.",
    "very_severe": "Very severe or the worst, or an 8, 9, or 10.",
}
SIDE_LABELS = {
    "left": "Left",
    "right": "Right",
    "both": "Both sides",
    "midline": "Midline",
    "unspecified": "Side not stated",
}


class JevError(Exception):
    def __init__(self, status: int):
        super().__init__("Jev request failed.")
        self.status = status


@dataclass(frozen=True)
class CatalogItem:
    id: str
    name: str
    side: str | None
    anatomy_id: str
    description: str
    mentions: str = ""


@dataclass(frozen=True)
class SubOption:
    id: str
    label: str
    description: str


@dataclass(frozen=True)
class SubGroup:
    id: str
    label: str
    anatomy_ids: frozenset[str]
    options: tuple[SubOption, ...]


@dataclass(frozen=True)
class Catalog:
    regions: tuple[CatalogItem, ...]
    pain_types: dict[str, str]
    severity: dict[str, str]
    triggers: dict[str, str]
    red_flags: dict[str, str]
    pain_type_criteria: dict[str, str]
    severity_criteria: dict[str, str]
    trigger_criteria: dict[str, str]
    red_flag_criteria: dict[str, str]
    sub_groups: tuple[SubGroup, ...]
    sub_by_anatomy: dict[str, SubGroup]


def _text(value, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text.")
    cleaned = value.strip()
    if not cleaned or len(cleaned) > limit or any(char in cleaned for char in _UNSAFE) or "\n" in cleaned:
        raise ValueError(f"{field} is not a usable label.")
    return cleaned


def _expected_side(anatomy_id: str) -> str | None:
    if anatomy_id in {"neck", "chest", "upper_back", "lower_back", "abdomen"}:
        return None
    if anatomy_id.startswith("left_"):
        return "left"
    if anatomy_id.startswith("right_"):
        return "right"
    raise ValueError(f"Unknown anatomy region {anatomy_id}.")


def _mentions(item: dict, item_id: str) -> str:
    if "mentions" not in item or item.get("mentions") in (None, ""):
        return ""
    return _text(item.get("mentions"), f"{item_id}.mentions", 160)


def _sub_groups(raw, known_anatomy: set[str]) -> tuple[SubGroup, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError("sub_locations must be a list.")
    groups: list[SubGroup] = []
    seen_ids: set[str] = set()
    seen_anatomy: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("A sub-location group must be an object.")
        group_id = item.get("id")
        if not isinstance(group_id, str) or not _ID.fullmatch(group_id) or group_id in seen_ids:
            raise ValueError("A sub-location group id is missing or duplicated.")
        label = _text(item.get("label"), f"sub_locations.{group_id}", 80)
        anatomy_ids = item.get("anatomy_ids")
        if not isinstance(anatomy_ids, list) or not anatomy_ids:
            raise ValueError(f"{group_id} needs anatomy ids.")
        cleaned: list[str] = []
        for anatomy_id in anatomy_ids:
            if not isinstance(anatomy_id, str) or anatomy_id not in known_anatomy or anatomy_id in seen_anatomy:
                raise ValueError(f"{group_id} has an unknown or repeated anatomy id.")
            seen_anatomy.add(anatomy_id)
            cleaned.append(anatomy_id)
        options_raw = item.get("options")
        if not isinstance(options_raw, list) or not options_raw:
            raise ValueError(f"{group_id} needs options.")
        options: list[SubOption] = []
        seen_options: set[str] = set()
        for option in options_raw:
            if not isinstance(option, dict):
                raise ValueError(f"{group_id} has an invalid option.")
            option_id = option.get("id")
            if not isinstance(option_id, str) or not _ID.fullmatch(option_id) or option_id in seen_options or option_id == "unspecified":
                raise ValueError(f"{group_id} has a duplicate or invalid option.")
            seen_options.add(option_id)
            options.append(SubOption(
                option_id,
                _text(option.get("label"), f"{group_id}.{option_id}", 80),
                _text(option.get("description") or option.get("label"), f"{group_id}.{option_id}.description", 300),
            ))
        seen_ids.add(group_id)
        groups.append(SubGroup(group_id, label, frozenset(cleaned), tuple(options)))
    return tuple(groups)


def _items(raw, field: str) -> tuple[dict[str, str], dict[str, str]]:
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{field} must list at least one option.")
    labels: dict[str, str] = {}
    criteria: dict[str, str] = {}
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError(f"{field} has an invalid option.")
        item_id = item.get("id")
        if not isinstance(item_id, str) or not _ID.fullmatch(item_id) or item_id in labels:
            raise ValueError(f"{field} has a duplicate or invalid id.")
        labels[item_id] = _text(item.get("label"), f"{field}.{item_id}", 80)
        criteria[item_id] = _text(item.get("description") or item.get("label"), f"{field}.{item_id}.description", 300)
    return labels, criteria


def load_catalog(path: Path = CATALOG_PATH) -> Catalog:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Pain region config must be an object.")
    raw_regions = data.get("regions")
    if not isinstance(raw_regions, list) or not raw_regions:
        raise ValueError("Pain region config needs a region list.")
    regions: list[CatalogItem] = []
    seen: set[str] = set()
    known = {region.value for region in Region}
    for item in raw_regions:
        if not isinstance(item, dict):
            raise ValueError("A pain region must be an object.")
        item_id = item.get("id")
        anatomy_id = item.get("anatomy_id")
        if not isinstance(item_id, str) or not _ID.fullmatch(item_id) or item_id in seen:
            raise ValueError("A pain region id is missing or duplicated.")
        if not isinstance(anatomy_id, str) or anatomy_id not in known:
            raise ValueError(f"{item_id} does not map to a known anatomy region.")
        side = item.get("side")
        if side not in ("left", "right", None) or side != _expected_side(anatomy_id):
            raise ValueError(f"{item_id} has a side that does not match its anatomy region.")
        muscles = item.get("muscles") or []
        if not isinstance(muscles, list) or any(not isinstance(muscle, str) for muscle in muscles):
            raise ValueError(f"{item_id} has an invalid muscle list.")
        muscle_names = [_text(muscle, f"{item_id}.muscle", 80) for muscle in muscles]
        name = _text(item.get("name"), item_id, 80)
        description = name if not muscle_names else f"{name}: {', '.join(muscle_names)}"
        mentions = _mentions(item, item_id)
        spread = description if not mentions else f"{description}. Also named: {mentions}"
        if len(description) > 300 or len(spread) > 300:
            raise ValueError(f"{item_id} description is too long.")
        seen.add(item_id)
        regions.append(CatalogItem(item_id, name, side, anatomy_id, description, mentions))
    covered = {item.anatomy_id for item in regions if item.id == item.anatomy_id}
    if covered != known:
        raise ValueError("Every anatomy region needs an entry in the pain region list.")
    groups = _sub_groups(data.get("sub_locations"), known)
    by_anatomy = {anatomy_id: group for group in groups for anatomy_id in group.anatomy_ids}
    pain_labels, pain_criteria = _items(data.get("pain_types"), "pain_types")
    severity_labels, severity_criteria = _items(data.get("severity"), "severity")
    trigger_labels, trigger_criteria = _items(data.get("triggers"), "triggers")
    flag_labels, flag_criteria = _items(data.get("red_flags"), "red_flags")
    return Catalog(
        tuple(regions),
        pain_labels,
        severity_labels,
        trigger_labels,
        flag_labels,
        pain_criteria,
        severity_criteria,
        trigger_criteria,
        flag_criteria,
        groups,
        by_anatomy,
    )


_CATALOG: Catalog | None = None


def catalog() -> Catalog:
    global _CATALOG
    if _CATALOG is None:
        _CATALOG = load_catalog()
    return _CATALOG


def _choice(instructions: str, criteria: dict[str, str], abstain: str, abstain_text: str = "The person did not say.") -> dict:
    return {
        "type": "choice",
        "instructions": instructions,
        "criteria": {**criteria, abstain: abstain_text},
    }


def _spread_text(region: CatalogItem) -> str:
    if not region.mentions:
        return region.description
    return f"{region.description}. Also named: {region.mentions}"


def _noul(instructions: str, yes: str) -> dict:
    return {
        "type": "noul",
        "instructions": instructions,
        "criteria": {"true": yes, "false": "Not reported."},
    }


def build_request(text: str, source: Catalog | None = None) -> dict:
    source = source or catalog()
    if set(PAIN_LEVEL_CRITERIA) != set(PAIN_LEVEL_BANDS):
        raise RuntimeError("Pain level bands and criteria diverged.")
    questions: dict[str, dict] = {}
    for region in source.regions:
        questions[f"region:{region.id}"] = _noul(REGION_QUESTION, region.description)
        questions[f"radiation:{region.id}"] = _noul(RADIATION_QUESTION, _spread_text(region))
    questions["side"] = _choice(
        "Which side does the person name for this pain? Choose unspecified when they do not name a side.",
        {
            "left": "They say left.",
            "right": "They say right.",
            "both": "They say both sides.",
            "midline": "They say the middle, the center, or the midline.",
        },
        "unspecified",
        "They do not name a side.",
    )
    for group in source.sub_groups:
        questions[f"sub_location:{group.id}"] = _choice(
            f"Which part of the {group.label.lower()} does the person name? Choose unspecified when they do not name a part.",
            {option.id: option.description for option in group.options},
            "unspecified",
            "They do not name a part of this area.",
        )
    questions["pain_type"] = _choice(
        "Which pain quality does the person state? Choose unclear when they do not name one.",
        source.pain_type_criteria,
        "unclear",
    )
    questions["severity"] = _choice(
        "Which severity word matches what the person states? Choose unknown when they do not say.",
        source.severity_criteria,
        "unknown",
    )
    questions["pain_level"] = _choice(
        "Which pain-level band matches what the person states? Use their words or a number they give. Choose unknown when they do not describe how strong it is.",
        PAIN_LEVEL_CRITERIA,
        "unknown",
    )
    questions["radiates"] = _noul(
        "Does the person say the pain spreads, radiates, shoots, or travels to another place? Answer yes only when they say it spreads.",
        "The pain spreads or radiates.",
    )
    for item_id, description in source.trigger_criteria.items():
        questions[f"trigger:{item_id}"] = _noul(TRIGGER_QUESTION, description)
    for item_id, description in source.red_flag_criteria.items():
        questions[f"red_flag:{item_id}"] = _noul(
            "Does the person report this warning symptom? A negated statement is no.",
            description,
        )
    return {
        "model": JEV_MODEL,
        "state": {"description": text.strip()[:MAX_STATE_CHARS]},
        "questions": questions,
    }


def _confidence(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or not 0 <= number <= 1:
        return None
    return number


def _accepted(value, minimum: float = JEV_MIN_CONFIDENCE) -> float | None:
    score = _confidence(value)
    if score is None or score < minimum:
        return None
    return score


def _noul_score(answer, minimum: float = JEV_MIN_CONFIDENCE) -> float | None:
    if not isinstance(answer, dict) or answer.get("type") not in (None, "noul"):
        return None
    return _accepted(answer.get("noul"), minimum)


def _choice_score(answer, allowed: dict[str, str], minimum: float = JEV_MIN_CONFIDENCE) -> tuple[str, float] | None:
    if not isinstance(answer, dict) or answer.get("type") not in (None, "choice"):
        return None
    choice = answer.get("choice")
    if not isinstance(choice, str) or choice not in allowed:
        return None
    score = _accepted(answer.get("confidence"), minimum)
    if score is None:
        return None
    return choice, score


def _label(item_id: str, label: str, score: float) -> dict:
    return {"id": item_id, "label": label, "confidence": round(score, 4)}


def _prefer(current: dict | None, candidate: dict) -> dict:
    if current is None or candidate["confidence"] > current["confidence"]:
        return candidate
    if candidate["confidence"] < current["confidence"]:
        return current
    if current["id"] == current["anatomy_id"]:
        return current
    if candidate["id"] == candidate["anatomy_id"]:
        return candidate
    return current if current["id"] <= candidate["id"] else candidate


def _sub_location(answers: dict, source: Catalog, anatomy_id: str) -> dict | None:
    group = source.sub_by_anatomy.get(anatomy_id)
    if group is None:
        return None
    allowed = {option.id: option.label for option in group.options}
    picked = _choice_score(answers.get(f"sub_location:{group.id}"), allowed)
    if picked is None:
        return None
    return {"id": picked[0], "label": allowed[picked[0]], "confidence": round(picked[1], 4)}


def _region_hits(answers: dict, source: Catalog, prefix: str) -> list[dict] | None:
    by_anatomy: dict[str, dict] = {}
    for region in source.regions:
        score = _noul_score(answers.get(f"{prefix}:{region.id}"))
        if score is None:
            continue
        candidate = {
            "id": region.id,
            "anatomy_id": region.anatomy_id,
            "side": region.side,
            "name": region.name,
            "confidence": round(score, 4),
            "sub_location": _sub_location(answers, source, region.anatomy_id),
        }
        by_anatomy[region.anatomy_id] = _prefer(by_anatomy.get(region.anatomy_id), candidate)
    hits = sorted(by_anatomy.values(), key=lambda item: (-item["confidence"], item["id"]))[:10]
    return hits or None


def _pain_level(answer) -> dict | None:
    labels = {band: label for band, (label, _value) in PAIN_LEVEL_BANDS.items()}
    picked = _choice_score(answer, labels)
    if picked is None:
        return None
    band = picked[0]
    label, number = PAIN_LEVEL_BANDS[band]
    return {"band": band, "label": label, "value": number, "confidence": round(picked[1], 4)}


def parse_payload(payload, source: Catalog | None = None) -> dict:
    source = source or catalog()
    if not isinstance(payload, dict):
        raise JevError(502)
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        raise JevError(502)
    regions = _region_hits(answers, source, "region")
    side = _choice_score(answers.get("side"), SIDE_LABELS)
    pain = _choice_score(answers.get("pain_type"), source.pain_types)
    severity = _choice_score(answers.get("severity"), source.severity)
    radiates = _noul_score(answers.get("radiates"))
    radiation = None
    if radiates is not None:
        destinations = _region_hits(answers, source, "radiation")
        source_anatomy = {item["anatomy_id"] for item in (regions or [])}
        if destinations:
            destinations = [item for item in destinations if item["anatomy_id"] not in source_anatomy] or None
        radiation = {"present": True, "confidence": round(radiates, 4), "regions": destinations}
    triggers = [
        _label(item_id, source.triggers[item_id], score)
        for item_id in source.triggers
        if (score := _noul_score(answers.get(f"trigger:{item_id}"), JEV_TRIGGER_MIN_CONFIDENCE)) is not None
    ]
    flags = [
        _label(item_id, source.red_flags[item_id], score)
        for item_id in source.red_flags
        if (score := _noul_score(answers.get(f"red_flag:{item_id}"))) is not None
    ]
    model = payload.get("model")
    return {
        "regions": regions,
        "side": {"id": side[0], "label": SIDE_LABELS[side[0]], "confidence": round(side[1], 4)} if side else None,
        "pain_type": _label(pain[0], source.pain_types[pain[0]], pain[1]) if pain else None,
        "severity": _label(severity[0], source.severity[severity[0]], severity[1]) if severity else None,
        "pain_level": _pain_level(answers.get("pain_level")),
        "radiation": radiation,
        "triggers": triggers or None,
        "red_flags": flags or None,
        "model": model if isinstance(model, str) and _MODEL.fullmatch(model) else "unknown",
    }


async def post_systemone(client: httpx.AsyncClient, api_key: str, body: dict, *, retries: int = 2, sleep=asyncio.sleep):
    delay = 0.2
    for attempt in range(retries + 1):
        try:
            response = await client.post(
                JEV_ENDPOINT,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
            )
        except httpx.HTTPError:
            if attempt >= retries:
                raise JevError(0) from None
            await sleep(delay)
            delay = min(delay * 2, 5)
            continue
        if response.status_code == 200:
            try:
                payload = response.json()
            except ValueError:
                raise JevError(502) from None
            return payload
        retryable = response.status_code == 429 or response.status_code >= 500
        if not retryable or attempt >= retries:
            raise JevError(response.status_code) from None
        header = response.headers.get("retry-after")
        try:
            wait = float(header) if header else delay
        except ValueError:
            wait = delay
        if not math.isfinite(wait) or wait < 0:
            wait = delay
        await sleep(min(wait, 5))
        delay = min(delay * 2, 5)
    raise JevError(0)


async def classify_pain(text: str, api_key: str, client: httpx.AsyncClient | None = None, *, retries: int = 2, sleep=asyncio.sleep):
    """Return a suggestion, or None when no key is configured. Never calls without a key."""
    if not api_key or not api_key.strip():
        return None
    if client is None:
        raise JevError(0)
    payload = await post_systemone(client, api_key.strip(), build_request(text), retries=retries, sleep=sleep)
    return parse_payload(payload)
