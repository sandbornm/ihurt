import asyncio
import json
import uuid
from decimal import Decimal

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import create_app
from backend.config import Settings
from backend.jev import (
    CATALOG_PATH,
    JEV_ENDPOINT,
    JEV_MIN_CONFIDENCE,
    JEV_MODEL,
    JEV_TRIGGER_MIN_CONFIDENCE,
    JevError,
    build_request,
    catalog,
    classify_pain,
    load_catalog,
    parse_payload,
)
from backend.models import Region

ORIGIN = {"Origin": "http://localhost:5173"}
KEY = "typesafe-test-key"


def settings(tmp_path, **kwargs):
    base = dict(
        _env_file=None,
        database_path=tmp_path / "quota.sqlite3",
        session_secret="test-secret-" * 4,
        requests_per_minute=60,
        typesafe_api_key="",
    )
    base.update(kwargs)
    return Settings(**base)


def noul(value):
    return {"type": "noul", "noul": value}


def choice(value, confidence):
    return {"type": "choice", "choice": value, "confidence": confidence, "probabilities": {value: confidence}}


def payload(answers, model="jev-1.13.0"):
    return {"model": model, "answers": answers, "usage": {"input_tokens": 20, "output_tokens": 4}}


def answered():
    return payload({
        "side": choice("right", 0.9),
        "pain_level": choice("severe", 0.8),
    })


def test_catalog_covers_anatomy_and_rejects_unknown_regions(tmp_path):
    source = catalog()
    listed = {item.anatomy_id for item in source.regions if item.id == item.anatomy_id}
    assert listed == {region.value for region in Region}
    assert "left_deltoid" in {item.id for item in source.regions}
    broken = {"regions": [{"id": "mystery", "name": "Mystery", "side": None, "anatomy_id": "not_a_region", "muscles": []}], "pain_types": source.pain_types, "severity": source.severity, "triggers": source.triggers, "red_flags": source.red_flags}
    # load_catalog expects the on-disk shape, including description fields.
    path = tmp_path / "pain-regions.json"
    path.write_text(json.dumps({"regions": [{"id": "left_shoulder", "name": "Left shoulder", "side": "right", "anatomy_id": "left_shoulder", "muscles": ["deltoid"]}]}))
    with pytest.raises(ValueError, match="side"):
        load_catalog(path)
    path.write_text(json.dumps({"regions": [{"id": "made_up", "name": "Made up", "side": None, "anatomy_id": "not_a_region", "muscles": []}]}))
    with pytest.raises(ValueError, match="known anatomy"):
        load_catalog(path)
    assert broken["regions"][0]["anatomy_id"] not in listed


def test_request_asks_only_side_and_pain_level():
    assert JEV_ENDPOINT == "https://api.typesafe.ai/v1/systemone"
    assert JEV_MIN_CONFIDENCE == 0.5
    body = build_request("x" * 5000)
    assert body["model"] == JEV_MODEL
    assert body["state"]["description"] == "x" * 4000
    assert set(body["questions"]) == {"side", "pain_level"}
    assert all(question["type"] == "choice" for question in body["questions"].values())
    assert set(body["questions"]["pain_level"]["criteria"]) == {"none", "mild", "moderate", "severe", "very_severe", "unknown"}
    assert set(body["questions"]["side"]["criteria"]) == {"left", "right", "both", "midline", "unspecified"}
    assert not any(key.startswith(("region:", "radiation:", "sub_location:")) for key in body["questions"])


def test_confidence_threshold_nulls_weak_and_unknown_fields():
    parsed = parse_payload(answered())
    assert set(parsed) == {"side", "pain_level", "model"}
    assert parsed["side"] == {"id": "right", "label": "Right", "confidence": 0.9}
    assert parsed["pain_level"] == {"band": "severe", "label": "Severe (6-7)", "value": 6, "confidence": 0.8}
    weak = parse_payload(payload({
        "region:left_shoulder": noul(0.99),
        "pain_level": choice("none", 0.5),
        "side": choice("unspecified", 0.49),
    }))
    assert "regions" not in weak
    assert weak["side"] is None
    assert weak["pain_level"]["band"] == "none"
    assert weak["pain_level"]["value"] == 0


def test_invalid_output_is_dropped_or_rejected():
    invalid = parse_payload(payload({
        "pain_level": choice("11", 1),
        "side": choice("<script>", 1),
        "region:left_shoulder": {"type": "noul", "noul": True},
    }, model="<script>"))
    assert invalid == {"side": None, "pain_level": None, "model": "unknown"}
    assert "<" not in json.dumps(invalid)
    with pytest.raises(JevError):
        parse_payload(["nope"])
    with pytest.raises(JevError):
        parse_payload({"model": "jev-1.13.0"})


def test_no_key_skips_the_network_call():
    called = False

    def handler(request):
        nonlocal called
        called = True
        raise AssertionError(request.url)

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert await classify_pain("My left shoulder is sharp.", "", client) is None
            assert await classify_pain("My left shoulder is sharp.", "   ", client) is None

    asyncio.run(check())
    assert called is False


def test_classify_sends_bearer_auth_and_retries_only_retryable_status():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        seen["calls"] = seen.get("calls", 0) + 1
        if seen["calls"] == 1:
            return httpx.Response(429, headers={"retry-after": "0"})
        return httpx.Response(200, json=answered())

    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await classify_pain("Sharp pain in the left deltoid.", KEY, client, sleep=lambda delay: asyncio.sleep(0))
        assert result["side"]["id"] == "right"
        assert result["pain_level"]["band"] == "severe"
        assert "regions" not in result
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(401, json={"error": KEY}))) as client:
            with pytest.raises(JevError) as error:
                await classify_pain("Sharp pain in the left deltoid.", KEY, client)
        assert error.value.status == 401

    asyncio.run(check())
    assert seen["url"] == JEV_ENDPOINT
    assert seen["auth"] == f"Bearer {KEY}"
    assert seen["body"]["model"] == JEV_MODEL
    assert seen["calls"] == 2


def test_endpoint_without_a_key_returns_nothing(tmp_path):
    called = False

    def handler(request):
        nonlocal called
        called = True
        return httpx.Response(200, json=answered())

    with TestClient(create_app(settings(tmp_path), jev_transport=httpx.MockTransport(handler))) as client:
        client.headers.update(ORIGIN)
        session = client.get("/api/session").json()
        assert session["pain_suggestions"] is False
        assert KEY not in json.dumps(session)
        response = client.post("/api/pain", json={"request_id": str(uuid.uuid4()), "text": "Left shoulder feels sharp.", "consent": False})
        assert response.status_code == 200
        assert response.json() == {"suggestion": None}
    assert called is False


def test_endpoint_validates_output_red_flags_and_keeps_the_key_off_the_response(tmp_path):
    def handler(request):
        assert request.headers["authorization"] == f"Bearer {KEY}"
        return httpx.Response(200, json=answered())

    config = settings(tmp_path, typesafe_api_key=KEY)
    with TestClient(create_app(config, jev_transport=httpx.MockTransport(handler))) as client:
        client.headers.update(ORIGIN)
        client.get("/api/session")
        assert client.get("/api/session").json()["pain_suggestions"] is True
        missing = client.post("/api/pain", json={"request_id": str(uuid.uuid4()), "text": "SECRET-PAIN-1948 left deltoid is sharp.", "consent": False})
        assert missing.status_code == 400
        body = {"request_id": str(uuid.uuid4()), "text": "SECRET-PAIN-1948 left deltoid is sharp.", "consent": True}
        response = client.post("/api/pain", json=body)
        assert response.status_code == 200
        suggestion = response.json()["suggestion"]
        assert set(suggestion) == {"side", "pain_level", "model"}
        assert suggestion["pain_level"]["band"] == "severe"
        assert suggestion["pain_level"]["value"] == 6
        assert suggestion["side"]["id"] == "right"
        assert "<" not in response.text
        assert KEY not in response.text
        assert "SECRET-PAIN-1948" not in response.text
        assert client.post("/api/pain", json=body).status_code == 409
        assert client.get("/api/session").json()["remaining"] == 3
    assert b"SECRET-PAIN-1948" not in config.database_path.read_bytes()
    assert KEY.encode() not in config.database_path.read_bytes()


def test_endpoint_hides_invalid_provider_output(tmp_path):
    def handler(request):
        return httpx.Response(200, content=b"<html>SECRET-BODY</html>")

    config = settings(tmp_path, typesafe_api_key=KEY)
    with TestClient(create_app(config, jev_transport=httpx.MockTransport(handler))) as client:
        client.headers.update(ORIGIN)
        client.get("/api/session")
        response = client.post("/api/pain", json={"request_id": str(uuid.uuid4()), "text": "Left calf is burning.", "consent": True})
        assert response.status_code == 502
        assert "SECRET-BODY" not in response.text
        assert KEY not in response.text
        assert "place pins" in response.json()["detail"]


def test_suggestion_reservation_does_not_spend_an_activity(tmp_path):
    config = settings(tmp_path, typesafe_api_key=KEY, daily_budget_usd=Decimal("0.01"), jev_reservation_usd=Decimal("0.01"))

    def handler(request):
        return httpx.Response(200, json=answered())

    with TestClient(create_app(config, jev_transport=httpx.MockTransport(handler))) as client:
        client.headers.update(ORIGIN)
        client.get("/api/session")
        first = client.post("/api/pain", json={"request_id": str(uuid.uuid4()), "text": "Left shoulder feels sharp.", "consent": True})
        assert first.status_code == 200
        second = client.post("/api/pain", json={"request_id": str(uuid.uuid4()), "text": "Left shoulder feels sharp.", "consent": True})
        assert second.status_code == 429
        assert client.get("/api/session").json()["remaining"] == 3


def test_pain_level_bands_and_side_only():
    parsed = parse_payload(payload({
        "region:lower_back": noul(0.99),
        "side": choice("right", 0.93),
        "pain_level": choice("moderate", 0.72),
        "trigger:rest": noul(0.95),
    }))
    assert set(parsed) == {"side", "pain_level", "model"}
    assert parsed["side"]["id"] == "right"
    assert parsed["pain_level"]["value"] == 4
    assert parse_payload(payload({"pain_level": choice("6", 1)}))["pain_level"] is None
    assert parse_payload(payload({"pain_level": choice("8", 1)}))["pain_level"] is None
    mild = parse_payload(payload({"pain_level": choice("mild", 0.5)}))
    assert mild["pain_level"]["value"] == 2
    very = parse_payload(payload({"pain_level": choice("very_severe", 0.8)}))
    assert very["pain_level"]["value"] == 9


def test_jev_calls_share_the_visitor_daily_cap(tmp_path):
    config = settings(tmp_path, typesafe_api_key=KEY, activities_per_day=2, daily_budget_usd=Decimal("1.00"))

    def handler(request):
        return httpx.Response(200, json=answered())

    with TestClient(create_app(config, jev_transport=httpx.MockTransport(handler))) as client:
        client.headers.update(ORIGIN)
        client.get("/api/session")
        assert client.post("/api/pain", json={"request_id": str(uuid.uuid4()), "text": "Right knee aches.", "consent": True}).status_code == 200
        assert client.post("/api/pain", json={"request_id": str(uuid.uuid4()), "text": "Right knee aches.", "consent": True}).status_code == 200
        third = client.post("/api/pain", json={"request_id": str(uuid.uuid4()), "text": "Right knee aches.", "consent": True})
        assert third.status_code == 429
        # Map activities use a separate counter and are still available.
        assert client.get("/api/session").json()["remaining"] == 2


def test_sub_locations_are_an_optional_addition(tmp_path):
    source = catalog()
    assert {group.id for group in source.sub_groups} == {"shoulder", "back"}
    shoulder = next(group for group in source.sub_groups if group.id == "shoulder")
    assert {option.id for option in shoulder.options} == {"front", "back", "top"}
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    assert {item["id"] for item in data["regions"]} >= {"left_shoulder", "lower_back", "left_deltoid"}
    data.pop("sub_locations")
    for region in data["regions"]:
        region.pop("mentions", None)
    path = tmp_path / "pain-regions.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    assert load_catalog(path).sub_groups == ()
    data["sub_locations"] = [{
        "id": "shoulder",
        "label": "Shoulder",
        "anatomy_ids": ["not_a_region"],
        "options": [{"id": "front", "label": "Front", "description": "Front of the shoulder"}],
    }]
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError, match="anatomy"):
        load_catalog(path)


def test_production_typesafe_key_requires_turnstile():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            app_env="production",
            session_secret="x" * 40,
            allowed_origins=["https://ihurt.app"],
            typesafe_api_key="test-not-a-real-key",
        )


def test_jev_model_is_pinned_by_default():
    assert JEV_MODEL == "jev-1.13.0"

