"""Reserve daily caps, then construct and call paid provider clients.

This is the only module that may construct those clients or call them.
Visitor and global caps are the values already enforced by Limits.
"""

from contextlib import contextmanager
from dataclasses import dataclass
import contextvars

import httpx
from anthropic import AsyncAnthropic
from fastapi import HTTPException
from openai import AsyncOpenAI

from .config import Settings
from .limits import Limits

# Pinned hosts. Other modules must not name these or build the clients.
ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text"
XAI_BASE_URL = "https://api.x.ai/v1"

_current: contextvars.ContextVar["_Permit | None"] = contextvars.ContextVar("ihurt_spend_permit", default=None)


@dataclass(frozen=True)
class _Permit:
    kind: str
    paid: bool


class SpendGate:
    def __init__(self, settings: Settings, limits: Limits):
        self.settings = settings
        self.limits = limits
        self._openai: AsyncOpenAI | None = None
        self._anthropic: AsyncAnthropic | None = None
        self._grok: AsyncOpenAI | None = None
        self._local: AsyncOpenAI | None = None

    @contextmanager
    def guard(self, owner: str, ip: str, request_id: str, activity_id: str | None, kind="analysis", paid=False):
        """Reserve the visitor and global caps, then allow one provider call."""
        reserved = self.limits.reserve(owner, ip, request_id, activity_id, kind=kind, paid=paid)
        token = _current.set(_Permit(kind=kind, paid=bool(paid)))
        try:
            yield reserved
        finally:
            _current.reset(token)

    def _require(self, *, kind: str, paid: bool) -> None:
        permit = _current.get()
        if permit is None or permit.kind != kind or permit.paid != paid:
            raise HTTPException(403, "This provider call was not reserved.")

    def openai_client(self) -> AsyncOpenAI:
        if self._openai is None:
            self._openai = AsyncOpenAI(api_key=self.settings.openai_api_key, timeout=35, max_retries=0)
        return self._openai

    def anthropic_client(self) -> AsyncAnthropic:
        if self._anthropic is None:
            self._anthropic = AsyncAnthropic(api_key=self.settings.anthropic_api_key, timeout=35, max_retries=0)
        return self._anthropic

    def grok_client(self) -> AsyncOpenAI:
        if self._grok is None:
            self._grok = AsyncOpenAI(api_key=self.settings.xai_api_key, base_url=XAI_BASE_URL, timeout=35, max_retries=0)
        return self._grok

    def local_client(self) -> AsyncOpenAI:
        if self._local is None:
            self._local = AsyncOpenAI(api_key=self.settings.local_api_key, base_url=self.settings.local_base_url, timeout=110, max_retries=0)
        return self._local

    async def openai_responses_parse(self, **kwargs):
        self._require(kind="analysis", paid=True)
        return await self.openai_client().responses.parse(**kwargs)

    async def openai_transcription(self, **kwargs):
        self._require(kind="audio", paid=True)
        return await self.openai_client().audio.transcriptions.create(**kwargs)

    async def anthropic_messages_parse(self, **kwargs):
        self._require(kind="analysis", paid=True)
        return await self.anthropic_client().messages.parse(**kwargs)

    async def compatible_chat(self, *, local: bool, **kwargs):
        self._require(kind="analysis", paid=not local)
        client = self.local_client() if local else self.grok_client()
        return await client.chat.completions.create(**kwargs)

    async def elevenlabs_speech(self, audio: bytes):
        self._require(kind="audio", paid=True)
        async with httpx.AsyncClient(timeout=35, follow_redirects=False) as client:
            return await client.post(
                ELEVENLABS_URL,
                headers={"xi-api-key": self.settings.elevenlabs_api_key},
                data={"model_id": "scribe_v2", "tag_audio_events": "false", "diarize": "false"},
                files={"file": ("note.wav", audio, "audio/wav")},
            )

    async def aclose(self):
        for client in (self._openai, self._anthropic, self._grok, self._local):
            if client is not None:
                await client.close()
