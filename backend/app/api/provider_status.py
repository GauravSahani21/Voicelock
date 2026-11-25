from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import get_current_operator
from app.core.config import Settings, get_settings
from app.models.entities import OperatorAccount
from app.services.detectif_client import DetectifAPIError, DetectifClient

router = APIRouter(prefix="/api/providers", tags=["Providers"])


class ProviderStatusOut(BaseModel):
    provider_mode: str
    api_key_configured: bool
    detectif_base_url: str
    aletheia_enabled: bool
    eidos_enabled: bool
    whisper_model: str
    detectif_health: Dict[str, Any]
    detectif_credits: Optional[Dict[str, Any]] = None
    credits_error: Optional[str] = None


@router.get("/status", response_model=ProviderStatusOut)
async def get_provider_status(
    operator: OperatorAccount = Depends(get_current_operator),
    settings: Settings = Depends(get_settings),
) -> ProviderStatusOut:
    client = DetectifClient(settings=settings)
    health_payload: Dict[str, Any]
    try:
        health_payload = await client.get_health()
    except DetectifAPIError as exc:
        health_payload = {
            "status": "unavailable",
            "error_code": exc.error_code,
            "message": exc.message,
        }

    credits_payload: Optional[Dict[str, Any]] = None
    credits_error: Optional[str] = None
    if settings.detectif_api_key.strip():
        try:
            credits_payload = await client.get_credits()
        except DetectifAPIError as exc:
            credits_error = f"{exc.error_code}: {exc.message}"
    else:
        credits_error = "DETECTIF_API_KEY not configured in backend environment (mock dev adapter active)."

    return ProviderStatusOut(
        provider_mode=settings.active_provider_mode,
        api_key_configured=bool(settings.detectif_api_key.strip()),
        detectif_base_url=settings.detectif_base_url,
        aletheia_enabled=settings.aletheia_enabled,
        eidos_enabled=settings.eidos_enabled,
        whisper_model=settings.whisper_model,
        detectif_health=health_payload,
        detectif_credits=credits_payload,
        credits_error=credits_error,
    )
