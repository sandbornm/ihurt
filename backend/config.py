from decimal import Decimal
from pathlib import Path
from typing import Literal
import secrets
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    llm_provider: Literal["demo", "openai", "anthropic", "grok", "local"] = "demo"
    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    openai_transcription_model: str = "gpt-4o-mini-transcribe"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5"
    xai_api_key: str = ""
    xai_model: str = "grok-4.20-0309-non-reasoning"
    local_base_url: str = "http://127.0.0.1:11434/v1"
    local_model: str = ""
    local_api_key: str = "local"
    local_json_mode: bool = True
    app_env: Literal["development", "production"] = "development"
    session_secret: str = ""
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"]
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]
    database_path: Path = Path("data/ihurt.sqlite3")
    activities_per_day: int = Field(default=3, ge=1, le=10)
    turns_per_activity: int = Field(default=6, ge=1, le=10)
    requests_per_minute: int = Field(default=12, ge=1, le=60)
    sessions_per_ip_per_day: int = Field(default=12, ge=1, le=100)
    daily_budget_usd: Decimal = Field(default=Decimal("5.00"), ge=0)
    analysis_reservation_usd: Decimal = Field(default=Decimal("0.10"), ge=Decimal("0.01"))
    transcription_reservation_usd: Decimal = Field(default=Decimal("0.03"), ge=Decimal("0.01"))
    max_audio_seconds: int = Field(default=60, ge=1, le=60)
    max_audio_bytes: int = Field(default=3_000_000, ge=1024, le=3_000_000)
    turnstile_site_key: str = ""
    turnstile_secret_key: str = ""

    @model_validator(mode="after")
    def validate_deployment(self):
        if self.app_env == "production":
            if len(self.session_secret) < 32:
                raise ValueError("Production requires SESSION_SECRET with at least 32 characters.")
            if any(not origin.startswith("https://") for origin in self.allowed_origins) or "*" in self.allowed_hosts:
                raise ValueError("Production requires explicit HTTPS origins and hosts.")
            if (self.openai_api_key or self.anthropic_api_key or self.xai_api_key or self.local_model) and not (self.turnstile_site_key and self.turnstile_secret_key):
                raise ValueError("Public live mode requires both Turnstile keys.")
        if self.llm_provider == "openai" and not self.openai_api_key:
            raise ValueError("Set OPENAI_API_KEY or use LLM_PROVIDER=demo.")
        for name, key in (("anthropic", self.anthropic_api_key), ("grok", self.xai_api_key), ("local", self.local_model)):
            if self.llm_provider == name and not key:
                raise ValueError(f"Configure credentials or a model for {name}, or use LLM_PROVIDER=demo.")
        if not self.local_base_url.startswith(("http://", "https://")):
            raise ValueError("LOCAL_BASE_URL must be an HTTP(S) endpoint.")
        if not self.session_secret:
            self.session_secret = secrets.token_hex(32)
        return self
