from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.database.session import get_db
from app.schemas.health import HealthResponse

router = APIRouter(prefix="/api", tags=["Health"])


@router.get("/health", response_model=HealthResponse)
def health_check(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    db_status = "connected"
    overall = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "unavailable"
        overall = "degraded"

    return HealthResponse(
        status=overall,
        app_name=settings.app_name,
        environment=settings.app_env,
        database=db_status,
        detectif_provider_mode=settings.active_provider_mode,
        aletheia_enabled=settings.aletheia_enabled,
        eidos_enabled=settings.eidos_enabled,
        whisper_model=settings.whisper_model,
    )
