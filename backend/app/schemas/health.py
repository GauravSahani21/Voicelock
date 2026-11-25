from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    app_name: str
    environment: str
    database: str
    detectif_provider_mode: str
    aletheia_enabled: bool
    eidos_enabled: bool
    whisper_model: str
