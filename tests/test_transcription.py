import asyncio
import io
import uuid
import wave
from decimal import Decimal

import httpx
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.config import Settings
from backend.limits import Limits
from backend.spend_gate import SpendGate
from backend.transcription import ElevenLabsTranscriber


def test_elevenlabs_request_uses_only_speech_endpoint_and_validates_response(monkeypatch, tmp_path):
    actual_client = httpx.AsyncClient
    def handler(request):
        assert str(request.url) == "https://api.elevenlabs.io/v1/speech-to-text"
        assert request.headers["xi-api-key"] == "test-not-a-real-key"
        assert b"scribe_v2" in request.content
        assert b"note.wav" in request.content
        return httpx.Response(200, json={"text": "My left calf feels tight."})
    monkeypatch.setattr("backend.spend_gate.httpx.AsyncClient", lambda **kwargs: actual_client(transport=httpx.MockTransport(handler), **kwargs))
    settings = Settings(_env_file=None, database_path=tmp_path / "usage.sqlite3", session_secret="test-" * 10, elevenlabs_api_key="test-not-a-real-key")
    gate = SpendGate(settings, Limits(settings))

    async def transcribe():
        with gate.guard(owner="owner", ip="ip", request_id=str(uuid.uuid4()), activity_id=None, kind="audio", paid=True):
            return await ElevenLabsTranscriber(gate).transcribe(b"synthetic-audio")

    assert asyncio.run(transcribe()) == "My left calf feels tight."


def test_transcription_consent_limits_and_errors_do_not_expose_content(tmp_path, monkeypatch):
    settings = Settings(_env_file=None, database_path=tmp_path / "usage.sqlite3", session_secret="test-" * 10,
                        elevenlabs_api_key="test-not-a-real-key", daily_budget_usd=Decimal("0.03"))
    calls = []
    async def transcribe(self, audio):
        calls.append(audio)
        raise ValueError("PRIVATE PROVIDER ERROR")
    monkeypatch.setattr(ElevenLabsTranscriber, "transcribe", transcribe)
    data = io.BytesIO()
    with wave.open(data, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b"\0" * 32000)
    with TestClient(create_app(settings)) as client:
        client.headers["Origin"] = "http://localhost:5173"
        session = client.get("/api/session").json()
        assert session["transcription_provider"] == "ElevenLabs"
        assert session["transcription_available"] is True
        assert "test-not-a-real-key" not in str(session)
        fields = {"request_id": str(uuid.uuid4()), "consent": "false"}
        files = {"audio": ("note.wav", data.getvalue(), "audio/wav")}
        assert client.post("/api/transcribe", data=fields, files=files).status_code == 400
        assert not calls
        fields["consent"] = "true"
        result = client.post("/api/transcribe", data=fields, files=files)
        assert result.status_code == 502
        assert "PRIVATE" not in result.text
        assert len(calls) == 1
        fields["request_id"] = str(uuid.uuid4())
        assert client.post("/api/transcribe", data=fields, files=files).status_code == 429
        assert len(calls) == 1
        assert b"PRIVATE" not in settings.database_path.read_bytes()
