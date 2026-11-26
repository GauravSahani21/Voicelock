from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env files."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "VoiceLock Gateway"
    app_env: str = "development"
    app_secret_key: str = Field(default_factory=lambda: secrets.token_hex(32))
    access_token_expire_minutes: int = 480

    database_url: str = "postgresql+psycopg://voicelock:voicelock@localhost:5432/voicelock"

    detectif_api_key: str = ""
    detectif_base_url: str = "https://platform.detectif.ai"
    detectif_timeout_seconds: float = 60.0
    detectif_max_retries: int = 2
    detectif_provider_mode: str = "auto"  # auto | live | mock
    aletheia_enabled: bool = True
    eidos_enabled: bool = True

    whisper_model: str = "base.en"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"

    max_audio_size_mb: int = 25
    temp_audio_dir: str = "./tmp_audio"
    enrollment_min_duration_seconds: float = 15.0
    enrollment_max_duration_seconds: float = 60.0
    verification_min_duration_seconds: float = 3.0
    verification_max_duration_seconds: float = 60.0
    challenge_ttl_seconds: int = 180
    decision_token_ttl_seconds: int = 180

    frontend_url: str = "http://localhost:5173"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    rate_limit_requests_per_minute: int = 120

    # n8n Security Automation Engine
    n8n_enabled: bool = False
    n8n_base_url: str = "http://localhost:5678"
    n8n_webhook_url: str = ""
    n8n_webhook_secret: str = ""
    n8n_timeout_seconds: float = 8.0
    n8n_max_retries: int = 3
    n8n_reporting_api_key: str = ""

    @field_validator("detectif_base_url", "n8n_base_url")
    @classmethod
    def strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def max_audio_bytes(self) -> int:
        return self.max_audio_size_mb * 1024 * 1024

    @property
    def resolved_temp_audio_dir(self) -> Path:
        path = Path(self.temp_audio_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def active_provider_mode(self) -> str:
        mode = self.detectif_provider_mode.lower().strip()
        if mode == "mock":
            return "mock"
        if mode == "live":
            return "live"
        return "live" if bool(self.detectif_api_key.strip()) else "mock"


@lru_cache
def get_settings() -> Settings:
    return Settings()
