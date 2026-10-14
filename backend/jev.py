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

from .models import Region

JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL = "jev-latest"
JEV_MIN_CONFIDENCE = 0.5
MAX_STATE_CHARS = 4000
CATALOG_PATH = Path(__file__).resolve().parent.parent / "config" / "pain-regions.json"
_ID = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
_MODEL = re.compile(r"^[A-Za-z0-9._-]{1,40}$")
_UNSAFE = set("<>{}")

REGION_QUESTION = (
    "Does the person explicitly report pain or discomfort in this place? "
    "Answer yes only when they name it. Do not infer a place from a sport, activity, or a different region."
)


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
        if len(description) > 300:
            raise ValueError(f"{item_id} description is too long.")
        seen.add(item_id)
        regions.append(CatalogItem(item_id, name, side, anatomy_id, description))
    covered = {item.anatomy_id for item in regions if item.id == item.anatomy_id}
    if covered != known:
        raise ValueError("Every anatomy region needs an entry in the pain region list.")
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
    )


_CATALOG: Catalog | None = None


def catalog() -> Catalog:
    global _CATALOG
    if _CATALOG is None:
        _CATALOG = load_catalog()
    return _CATALOG


def _choice(instructions: str, criteria: dict[str, str], abstain: str) -> dict:
    return {
        "type": "choice",
        "instructions": instructions,
        "criteria": {**criteria, abstain: "The person did not say."},
    }


def _noul(instructions: str, yes: str) -> dict:
    return {
        "type": "noul",
        "instructions": instructions,
        "criteria": {"true": yes, "false": "Not reported."},
    }


def build_request(text: str, source: Catalog | None = None) -> dict:
    source = source or catalog()
    questions: dict[str, dict] = {}
    for region in source.regions:
        questions[f"region:{region.id}"] = _noul(REGION_QUESTION, region.description)
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
        "Which whole number from 0 to 10 does the person state for this pain? Choose unknown when they do not give a number.",
        {str(level): f"Pain level {level} out of 10" for level in range(11)},
        "unknown",
    )
    for item_id, description in source.trigger_criteria.items():
        questions[f"trigger:{item_id}"] = _noul(
            "Does the person say this brings on or worsens the pain? Do not infer a trigger from an activity name alone.",
            description,
        )
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


def _accepted(value) -> float | None:
    score = _confidence(value)
    if score is None or score < JEV_MIN_CONFIDENCE:
        return None
    return score


def _noul_score(answer) -> float | None:
    if not isinstance(answer, dict) or answer.get("type") not in (None, "noul"):
        return None
    return _accepted(answer.get("noul"))


def _choice_score(answer, allowed: dict[str, str]) -> tuple[str, float] | None:
    if not isinstance(answer, dict) or answer.get("type") not in (None, "choice"):
        return None
    choice = answer.get("choice")
    if not isinstance(choice, str) or choice not in allowed:
        return None
    score = _accepted(answer.get("confidence"))
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


def parse_payload(payload, source: Catalog | None = None) -> dict:
    source = source or catalog()
    if not isinstance(payload, dict):
        raise JevError(502)
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        raise JevError(502)
    by_anatomy: dict[str, dict] = {}
    for region in source.regions:
        score = _noul_score(answers.get(f"region:{region.id}"))
        if score is None:
            continue
        candidate = {
            "id": region.id,
            "anatomy_id": region.anatomy_id,
            "side": region.side,
            "name": region.name,
            "confidence": round(score, 4),
        }
        by_anatomy[region.anatomy_id] = _prefer(by_anatomy.get(region.anatomy_id), candidate)
    regions = sorted(by_anatomy.values(), key=lambda item: (-item["confidence"], item["id"]))[:10] or None
    pain = _choice_score(answers.get("pain_type"), source.pain_types)
    severity = _choice_score(answers.get("severity"), source.severity)
    level = _choice_score(answers.get("pain_level"), {str(number): str(number) for number in range(11)})
    triggers = [
        _label(item_id, source.triggers[item_id], score)
        for item_id in source.triggers
        if (score := _noul_score(answers.get(f"trigger:{item_id}"))) is not None
    ]
    flags = [
        _label(item_id, source.red_flags[item_id], score)
        for item_id in source.red_flags
        if (score := _noul_score(answers.get(f"red_flag:{item_id}"))) is not None
    ]
    model = payload.get("model")
    return {
        "regions": regions,
        "pain_type": _label(pain[0], source.pain_types[pain[0]], pain[1]) if pain else None,
        "severity": _label(severity[0], source.severity[severity[0]], severity[1]) if severity else None,
        "pain_level": {"value": int(level[0]), "confidence": round(level[1], 4)} if level else None,
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
