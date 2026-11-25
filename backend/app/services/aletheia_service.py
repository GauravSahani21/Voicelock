from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import Settings, get_settings
from app.services.detectif_client import DetectifAPIError, DetectifClient


@dataclass
class NormalizedAletheiaResult:
    provider: str
    provider_mode: str  # LIVE_PROVIDER_CHECK | MOCK_DEV_ADAPTER
    status: str  # COMPLETED | FAILED
    normalized_result: str  # REAL | FAKE | PROVIDER_ERROR
    verdict: Optional[str] = None  # documented: real | fake
    label: Optional[str] = None  # documented: genuine | synthetic
    is_synthetic: Optional[bool] = None
    score: Optional[float] = None  # documented 0..1
    score_semantics: Optional[str] = None
    duration_seconds: Optional[float] = None
    scored_seconds: Optional[float] = None
    segments: List[Dict[str, Any]] = field(default_factory=list)
    operation_id: Optional[str] = None
    request_id: Optional[str] = None
    model_name: Optional[str] = None
    model_version: Optional[str] = None
    latency_ms: Optional[float] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    raw_metadata: Dict[str, Any] = field(default_factory=dict)


class AletheiaService:
    """Deepfake voice authenticity service backed by Detectif.ai Aletheia (or labelled dev mock)."""

    def __init__(
        self,
        client: Optional[DetectifClient] = None,
        settings: Optional[Settings] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.client = client or DetectifClient(settings=self.settings)

    async def check_audio(
        self,
        *,
        file_path: Path,
        duration_seconds: Optional[float] = None,
        idempotency_key: Optional[str] = None,
    ) -> NormalizedAletheiaResult:
        if not self.settings.aletheia_enabled:
            return NormalizedAletheiaResult(
                provider="detectif_aletheia",
                provider_mode="DISABLED",
                status="FAILED",
                normalized_result="PROVIDER_ERROR",
                error_code="aletheia_disabled",
                error_message="Aletheia deepfake detection is disabled in configuration.",
            )

        if self.settings.active_provider_mode == "mock":
            # Explicitly labelled development mock adapter when DETECTIF_API_KEY is not configured.
            return NormalizedAletheiaResult(
                provider="detectif_aletheia",
                provider_mode="MOCK_DEV_ADAPTER",
                status="COMPLETED",
                normalized_result="REAL",
                verdict="real",
                label="genuine",
                is_synthetic=False,
                score=None,
                score_semantics="MOCK_DEV_ADAPTER: No live Detectif.ai inference executed (API key not configured).",
                duration_seconds=duration_seconds,
                scored_seconds=duration_seconds,
                segments=[],
                operation_id=f"mock_op_{uuid.uuid4().hex[:20]}",
                request_id=f"mock_req_{uuid.uuid4().hex[:16]}",
                model_name="aletheia-mock-dev",
                model_version="dev-mock",
                raw_metadata={"mock": True, "notice": "Configure DETECTIF_API_KEY for live Aletheia checks."},
            )

        try:
            payload = await self.client.detect_deepfake(
                file_path=file_path,
                idempotency_key=idempotency_key,
            )
            return self.normalize_response(payload)
        except DetectifAPIError as exc:
            return NormalizedAletheiaResult(
                provider="detectif_aletheia",
                provider_mode="LIVE_PROVIDER_CHECK",
                status="FAILED",
                normalized_result="PROVIDER_ERROR",
                request_id=exc.request_id,
                error_code=exc.error_code,
                error_message=exc.message,
                raw_metadata={"http_status": exc.status_code, "error_type": exc.error_type},
            )

    @staticmethod
    def normalize_response(payload: Dict[str, Any]) -> NormalizedAletheiaResult:
        result = payload.get("result") or {}
        model = payload.get("model") or {}
        verdict = result.get("verdict")
        if verdict == "real":
            normalized = "REAL"
        elif verdict == "fake":
            normalized = "FAKE"
        else:
            normalized = "UNCERTAIN"

        return NormalizedAletheiaResult(
            provider="detectif_aletheia",
            provider_mode="LIVE_PROVIDER_CHECK",
            status="COMPLETED",
            normalized_result=normalized,
            verdict=verdict,
            label=result.get("label"),
            is_synthetic=result.get("is_synthetic"),
            score=result.get("score"),
            score_semantics=result.get("score_semantics"),
            duration_seconds=result.get("duration_seconds"),
            scored_seconds=result.get("scored_seconds"),
            segments=result.get("segments") or [],
            operation_id=payload.get("operation_id"),
            request_id=payload.get("request_id"),
            model_name=model.get("name"),
            model_version=model.get("version"),
            latency_ms=payload.get("latency_ms"),
            raw_metadata={
                "object": payload.get("object"),
                "credits": payload.get("credits"),
                "idempotent_replay": payload.get("idempotent_replay"),
            },
        )
