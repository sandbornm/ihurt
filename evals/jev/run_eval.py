"""Live utility eval: Jev pain suggestions vs the existing map providers.

Usage (from repo root):
    uv run python evals/jev/run_eval.py --env-file /path/to/.env [--targets jev-1.13.0,jev-1.14.0,demo,openai]

Keys are read from the environment or --env-file and are never printed.
Raw per-case results go to .tmp/jev-eval/ (not committed). Only the score table is printed.
"""

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
CASES = Path(__file__).with_name("cases.jsonl")
OUT = ROOT / ".tmp" / "jev-eval"
JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000  # docs.typesafe.ai/models, Oct 2026
MIDLINE = {"neck", "chest", "upper_back", "lower_back", "abdomen"}


def load_env(path: str | None) -> None:
    if not path:
        return
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def band(level):
    if level is None:
        return None
    if level == 0:
        return "none"
    if level <= 3:
        return "mild"
    if level <= 5:
        return "moderate"
    if level <= 7:
        return "severe"
    return "very_severe"


def side_from_regions(regions):
    sides = {r.split("_", 1)[0] for r in regions if r.startswith(("left_", "right_"))}
    if sides == {"left", "right"}:
        return "both"
    return next(iter(sides), None)


async def run_jev(model, text, client, key):
    from backend import jev
    jev.JEV_MODEL = model
    start = time.perf_counter()
    payload = await jev.post_systemone(client, key, jev.build_request(text), retries=2)
    latency = time.perf_counter() - start
    parsed = jev.parse_payload(payload)
    usage = payload.get("usage") or {}
    tokens = usage.get("input_tokens") or 0
    side = parsed["side"]["id"] if parsed["side"] else None
    if side in ("unspecified", "midline"):
        side = None
    level_band = parsed["pain_level"]["band"] if parsed["pain_level"] else None
    return {"regions": [], "side": side, "band": level_band, "latency": latency,
            "tokens": tokens, "cost": tokens * JEV_USD_PER_INPUT_TOKEN, "answered_by": parsed["model"]}


async def run_provider(provider, text):
    from backend.models import MapRequest
    start = time.perf_counter()
    result = await provider.map(MapRequest(request_id=str(uuid.uuid4()), note=text, consent=True))
    latency = time.perf_counter() - start
    regions = [r.value for r in result.regions]
    return {"regions": regions, "side": side_from_regions(regions), "band": band(result.intensity),
            "latency": latency, "tokens": None, "cost": None}


def score(case, got, *, regions_from_model: bool):
    exp_band = band(case["level"])
    out = {
        "side_ok": (got["side"] == case["side"]) if case["side"] else None,
        "band_ok": (got["band"] == exp_band) if exp_band else None,
        "invented_level": (got["band"] not in (None, "unknown")) if exp_band is None else None,
    }
    if not regions_from_model:
        # Jev no longer proposes regions; those stay with the map provider.
        out["region_ok"] = None
        out["fp_case"] = None
        return out
    exp = set(case["regions"])
    pred = set(got["regions"])
    if case.get("any_region"):
        out["region_ok"] = bool(pred) and pred <= exp
        out["fp_case"] = len(pred - exp) > 0
    else:
        out["region_ok"] = pred == exp
        out["fp_case"] = len(pred - exp) > 0
    return out


def summarize(name, rows):
    def rate(key):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return f"{sum(vals)}/{len(vals)}" if vals else "-"
    lat = sorted(r["latency"] for r in rows if r.get("latency") is not None)
    errors = sum(1 for r in rows if r.get("error"))
    cost = sum(r["cost"] or 0 for r in rows if r.get("cost") is not None)
    has_cost = any(r.get("cost") is not None for r in rows)
    p50 = f"{lat[len(lat) // 2]:.2f}s" if lat else "-"
    return (f"| {name} | {rate('region_ok')} | {rate('side_ok')} | {rate('band_ok')} | "
            f"{rate('fp_case')} | {rate('invented_level')} | {errors} | {p50} | "
            f"{'$%.4f' % cost if has_cost else 'n/a'} |")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-file")
    ap.add_argument("--targets", default="jev-1.13.0,jev-1.14.0,demo,default")
    args = ap.parse_args()
    load_env(args.env_file)
    import httpx
    from backend.config import Settings
    from backend.providers import create_providers
    try:
        settings = Settings()
    except Exception:
        settings = Settings.model_construct(**{k.lower(): v for k, v in os.environ.items() if k.lower() in Settings.model_fields})
    providers = create_providers(settings)
    key = (os.environ.get("TYPESAFE_API_KEY") or "").strip()
    cases = [json.loads(line) for line in CASES.read_text().splitlines() if line.strip()]
    targets = []
    for t in args.targets.split(","):
        t = t.strip()
        if t == "default":
            t = settings.llm_provider
        if t not in targets:
            targets.append(t)
    OUT.mkdir(parents=True, exist_ok=True)
    print("| target | region exact | side | level band | cases w/ false-positive region | invented level | errors | p50 latency | cost |")
    print("|---|---|---|---|---|---|---|---|---|")
    async with httpx.AsyncClient(timeout=40) as client:
        for target in targets:
            if target.startswith("jev-") and not key:
                print(f"| {target} | skipped: no TYPESAFE_API_KEY |")
                continue
            if not target.startswith("jev-") and target not in providers:
                print(f"| {target} | skipped: provider not configured |")
                continue
            rows = []
            for case in cases:
                try:
                    if target.startswith("jev-"):
                        got = await run_jev(target, case["text"], client, key)
                    else:
                        got = await run_provider(providers[target], case["text"])
                    rows.append({"id": case["id"], **got, **score(case, got, regions_from_model=not target.startswith("jev-"))})
                except Exception as exc:  # record the type only; never echo request content or keys
                    rows.append({"id": case["id"], "error": type(exc).__name__, "region_ok": False, "fp_case": False})
            (OUT / f"{target}.json").write_text(json.dumps(rows, indent=1))
            print(summarize(target, rows), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
