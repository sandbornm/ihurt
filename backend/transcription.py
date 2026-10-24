"""Optional speech providers. Audio stays in memory for the request."""

from .config import Settings
from .spend_gate import SpendGate


class ElevenLabsTranscriber:
    name = "ElevenLabs"

    def __init__(self, gate: SpendGate):
        self.gate = gate

    async def transcribe(self, audio: bytes) -> str:
        response = await self.gate.elevenlabs_speech(audio)
        response.raise_for_status()
        text = response.json().get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 3000:
            raise ValueError("Invalid transcription response")
        return text.strip()


def create_transcriber(settings: Settings, providers, gate: SpendGate):
    if settings.transcription_provider == "elevenlabs" and settings.elevenlabs_api_key:
        return ElevenLabsTranscriber(gate), "ElevenLabs"
    if settings.transcription_provider == "openai" and "openai" in providers:
        return providers["openai"], "OpenAI"
    return None, None
