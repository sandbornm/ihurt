"""Optional speech providers. Audio stays in memory for the request."""

import httpx

from .config import Settings


class ElevenLabsTranscriber:
    name = "ElevenLabs"

    def __init__(self, settings: Settings):
        self.key = settings.elevenlabs_api_key

    async def transcribe(self, audio: bytes) -> str:
        async with httpx.AsyncClient(timeout=35, follow_redirects=False) as client:
            response = await client.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": self.key},
                data={"model_id": "scribe_v2", "tag_audio_events": "false", "diarize": "false"},
                files={"file": ("note.wav", audio, "audio/wav")},
            )
            response.raise_for_status()
            text = response.json().get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 3000:
                raise ValueError("Invalid transcription response")
            return text.strip()


def create_transcriber(settings: Settings, providers):
    if settings.transcription_provider == "elevenlabs" and settings.elevenlabs_api_key:
        return ElevenLabsTranscriber(settings), "ElevenLabs"
    if settings.transcription_provider == "openai" and "openai" in providers:
        return providers["openai"], "OpenAI"
    return None, None
