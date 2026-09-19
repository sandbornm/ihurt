from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import io
import uuid
import wave
import pytest
import httpx
from openai import APIStatusError
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from backend.app import create_app
from backend.config import Settings
from backend.limits import Limits
from backend.providers import DemoProvider


ORIGIN = {"Origin": "http://localhost:5173"}


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, database_path=tmp_path / "quota.sqlite3", session_secret="test-secret-" * 4, requests_per_minute=60)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        client.headers.update(ORIGIN)
        client.get("/api/session")
        yield client


def note(**kwargs):
    return {"request_id": str(uuid.uuid4()), "note": "My right knee aches after running.", **kwargs}


def test_guided_map_and_reported_region(client):
    response = client.post("/api/map", json=note())
    assert response.status_code == 200
    result = response.json()
    assert result["map"]["regions"] == ["right_knee"]
    assert result["map"]["intensity"] is None
    assert result["map"]["question"] is None
    updated = client.post("/api/map", json=note(activity_id=result["activity_id"], answers=[{"key": "quality", "text": "Dull ache"}, {"key": "intensity", "text": "5 / 10"}]))
    assert updated.status_code == 200
    assert updated.json()["map"]["intensity"] == 5
    assert updated.json()["remaining"] == 2


def test_ambiguous_side_requires_clarification(client):
    result = client.post("/api/map", json=note(note="My knee hurts when walking.")).json()["map"]
    assert result["regions"] == []
    assert result["question"]["key"] == "location"


def test_no_invented_heat_and_urgent_notice(client):
    result = client.post("/api/map", json=note(note="I have sudden chest pain and trouble breathing.")).json()["map"]
    assert result["urgent"] is True
    assert result["question"] is None
    assert "emergency" in result["safety_message"]


def test_three_activity_limit_survives_new_cookie_and_forwarded_header(client):
    for _ in range(3):
        assert client.post("/api/map", json=note()).status_code == 200
    client.cookies.clear()
    client.headers["X-Forwarded-For"] = "192.0.2.123"
    assert client.get("/api/session").json()["remaining"] == 0
    response = client.post("/api/map", json=note())
    assert response.status_code == 429
    assert "Retry-After" in response.headers


def test_duplicate_request_and_ownership(client):
    payload = note()
    result = client.post("/api/map", json=payload).json()
    assert client.post("/api/map", json=payload).status_code == 409
    assert client.get("/api/session").json()["remaining"] == 2
    client.cookies.clear()
    client.get("/api/session")
    assert client.post("/api/map", json=note(activity_id=result["activity_id"])).status_code == 404


def test_origin_session_input_and_provider_validation(client):
    assert client.post("/api/map", json=note(), headers={"Origin": "https://unrelated.example"}).status_code == 403
    assert client.post("/api/map", content=b"x"*24001).status_code == 413
    assert client.post("/api/map", json=note(selected_region="imaginary_region")).status_code == 422
    assert client.post("/api/map", json=note(provider="openai")).status_code == 400
    client.cookies.clear()
    assert client.post("/api/map", json=note()).status_code == 401


def test_turn_limit_and_no_symptom_storage(client, settings):
    result = client.post("/api/map", json=note(note="SECRET-SYMPTOM-1948 right knee aches")).json()
    for _ in range(settings.turns_per_activity - 1):
        response = client.post("/api/map", json=note(activity_id=result["activity_id"]))
        assert response.status_code == 200
    assert response.json()["map"]["question"] is None
    assert client.post("/api/map", json=note(activity_id=result["activity_id"])).status_code == 429
    assert b"SECRET-SYMPTOM-1948" not in settings.database_path.read_bytes()
    assert client.get("/api/session").headers["cache-control"] == "no-store"


def test_budget_reservations_are_atomic_and_survive_restart(settings):
    settings.daily_budget_usd = Decimal("0.20")
    settings.analysis_reservation_usd = Decimal("0.10")
    limits = Limits(settings)
    def reserve(i):
        try:
            return bool(limits.reserve(f"owner-{i}", f"ip-{i}", str(uuid.uuid4()), None, paid=True))
        except HTTPException as error:
            assert error.status_code == 429
            return False
    with ThreadPoolExecutor(max_workers=6) as pool:
        assert sum(pool.map(reserve, range(6))) == 2
    restarted = Limits(settings)
    with pytest.raises(HTTPException) as e:
        restarted.reserve("new-owner", "new-ip", str(uuid.uuid4()), None, paid=True)
    assert e.value.status_code == 429


def test_failed_provider_preserves_activity_and_counts_attempt(settings):
    class FailedProvider:
        async def map(self, request):
            raise RuntimeError("private error with sensitive content")
    with TestClient(create_app(settings, FailedProvider())) as client:
        client.headers.update(ORIGIN)
        client.get("/api/session")
        response = client.post("/api/map", json=note())
        assert response.status_code == 502
        assert response.json()["activity_id"]
        assert response.json()["remaining"] == 2
        assert "sensitive" not in response.text
        retry = client.post("/api/map", json=note(activity_id=response.json()["activity_id"]))
        assert retry.status_code == 502
        assert retry.json()["remaining"] == 2


def test_request_rate_limit(settings):
    settings.requests_per_minute = 2
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/session").status_code == 200
        assert client.get("/api/session").status_code == 200
        assert client.get("/api/session").status_code == 429


def test_grok_billing_error_is_actionable_without_exposing_account_data(settings, monkeypatch):
    class UnfundedProvider:
        async def map(self, request):
            body = {"error": "Team PRIVATE-ACCOUNT has used all available credits. PRIVATE-NOTE"}
            raise APIStatusError("private provider response", response=httpx.Response(403, request=httpx.Request("POST", "https://api.x.ai/v1/chat/completions")), body=body)
    monkeypatch.setattr("backend.app.create_providers", lambda _: {"grok": UnfundedProvider()})
    with TestClient(create_app(settings)) as client:
        client.headers.update(ORIGIN)
        client.get("/api/session")
        response = client.post("/api/map", json=note(provider="grok", consent=True))
        assert response.status_code == 502
        assert "billing" in response.json()["detail"]
        assert "xAI / Grok" in response.json()["detail"]
        assert "PRIVATE" not in response.text
        assert response.json()["activity_id"]


def test_production_fails_without_secure_configuration(settings):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", session_secret="short")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", session_secret="x"*40, allowed_origins=["https://ihurt.app"], openai_api_key="test-not-a-real-key")


def test_audio_is_validated_before_provider_call(settings, monkeypatch):
    settings.transcription_provider = "openai"
    class AudioProvider(DemoProvider):
        calls = 0
        async def transcribe(self, audio):
            self.calls += 1
            return "My shoulder feels tight."
    provider = AudioProvider()
    monkeypatch.setattr("backend.app.create_providers", lambda _: {"demo": DemoProvider(), "openai": provider})
    with TestClient(create_app(settings)) as client:
        client.headers.update(ORIGIN)
        client.get("/api/session")
        fields = {"request_id": str(uuid.uuid4()), "consent": "true"}
        bad = client.post("/api/transcribe", data=fields, files={"audio": ("bad.wav", b"not audio", "audio/wav")})
        assert bad.status_code == 422
        assert provider.calls == 0
        data = io.BytesIO()
        with wave.open(data, "wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b"\0" * 32000)
        result = client.post("/api/transcribe", data=fields, files={"audio": ("note.wav", data.getvalue(), "audio/wav")})
        assert result.status_code == 200
        assert provider.calls == 1
        assert result.json()["text"] == "My shoulder feels tight."


def test_clear_notes_finish_without_routine_questions(client):
    for description in ["I woke up with a crick in my neck after sleeping awkwardly.", "My right shoulder feels tight when serving in tennis."]:
        mapped = client.post("/api/map", json=note(note=description)).json()["map"]
        assert mapped["question"] is None
        assert mapped["intensity"] is None
        assert mapped["regions"]


@pytest.mark.parametrize("posture", ["slept on my side and stomach", "sleep on my stomach", "lying on my stomach or side"])
def test_sleeping_position_does_not_add_abdominal_discomfort(client, posture):
    mapped = client.post("/api/map", json=note(note=f"My neck feels stiff after I {posture}.")).json()["map"]
    assert mapped["regions"] == ["neck"]


def test_abdominal_discomfort_is_kept_after_a_sleeping_position(client):
    mapped = client.post("/api/map", json=note(note="I slept on my stomach. My stomach aches today.")).json()["map"]
    assert mapped["regions"] == ["abdomen"]


def test_demo_uses_pins_instead_of_regions_mentioned_in_movements(client):
    pin = {"id": str(uuid.uuid4()), "region": "neck", "position": [0.1, 2.5, -0.1], "structure": "Selected surface"}
    mapped = client.post("/api/map", json=note(note="The pinned spot feels stiff when moving my chin toward my chest after sleeping on my stomach.", points=[pin])).json()["map"]
    assert mapped["regions"] == ["neck"]


@pytest.mark.parametrize("description,quality", [
    ("My shoulder feels tight when reaching overhead.", "tight"),
    ("I notice stiffness and numbness in my right shoulder when lifting.", "numb, stiff"),
    ("My right shoulder aches when lifting.", "ache"),
])
def test_demo_matches_reported_feelings_as_words(client, description, quality):
    mapped = client.post("/api/map", json=note(note=description)).json()["map"]
    assert mapped["quality"] == quality


def test_surface_pins_anchor_region_and_validate_coordinates(client):
    pin = {"id": str(uuid.uuid4()), "region": "right_shoulder", "position": [-0.6, 2.1, -0.2], "structure": "Infraspinatus muscle"}
    second = {**pin, "id": str(uuid.uuid4()), "region": "left_shoulder", "position": [0.6, 2.1, -0.2]}
    result = client.post("/api/map", json=note(note="Tight in both pinned spots when serving in tennis.", points=[pin, second]))
    assert result.status_code == 200
    assert result.json()["map"]["regions"] == ["right_shoulder", "left_shoulder"]
    assert result.json()["map"]["question"] is None
    assert client.post("/api/map", json=note(points=[{**pin, "position": [0, 900, 0]}])).status_code == 422
    assert client.post("/api/map", json=note(points=[pin, pin])).status_code == 422


def test_two_answer_limit_stops_further_questions(client):
    mapped = client.post("/api/map", json=note(note="Something feels off", answers=[{"key": "location", "text": "I cannot localize it"}, {"key": "activity", "text": "Unsure"}])).json()["map"]
    assert mapped["question"] is None


def test_surface_area_validation():
    from backend.models import PointObservation
    data = dict(id=str(uuid.uuid4()), region="neck", position=(0, 2, 0), structure="Area on neck", area={"path": [(0, 2, 0), (0.1, 2, 0)], "radius": 0.12})
    assert len(PointObservation(**data).area.path) == 2
    for area in ({"path": [(0, 2, 0)] * 49, "radius": .12}, {"path": [(0, 2, 0), (3, 3, 3)], "radius": .12}, {"path": [(0, 2, 0), (.1, 2, 0)], "radius": float("nan")}):
        with pytest.raises(ValidationError):
            PointObservation(**{**data, "area": area})
