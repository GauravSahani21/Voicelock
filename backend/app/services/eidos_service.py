from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

from app.core.config import Settings, get_settings
from app.services.detectif_client import DetectifAPIError, DetectifClient


def build_provider_speaker_id(tenant_id: str, user_id: str) -> str:
    """
    Generate a tenant-isolated Eidos speaker_id matching Detectif.ai's required pattern:
    ^[A-Za-z0-9_.:-]{1,64}$
    """
    t_part = tenant_id.replace("-", "")[:12]
    u_part = user_id.replace("-", "")[:12]
    return f"vl_{t_part}_{u_part}"


@dataclass
class NormalizedEidosEnrollmentResult:
    provider: str
    provider_mode: str  # LIVE_PROVIDER_CHECK | MOCK_DEV_ADAPTER
    status: str  # COMPLETED | FAILED
    speaker_id: str
    samples: int = 0
    speech_seconds: Optional[float] = None
    duration_seconds: Optional[float] = None
    operation_id: Optional[str] = None
    request_id: Optional[str] = None
    model_name: Optional[str] = None
    model_version: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    raw_metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class NormalizedEidosVerifyResult:
    provider: str
    provider_mode: str  # LIVE_PROVIDER_CHECK | MOCK_DEV_ADAPTER
    status: str  # COMPLETED | FAILED
    normalized_result: str  # MATCH | NO_MATCH | PROVIDER_ERROR
    decision: Optional[str] = None  # documented: match | no_match
    similarity: Optional[float] = None  # documented -1..1 (not a percentage)
    similarity_semantics: Optional[str] = None
    duration_seconds: Optional[float] = None
    speaker_id: Optional[str] = None
    operation_id: Optional[str] = None
    request_id: Optional[str] = None
    model_name: Optional[str] = None
    model_version: Optional[str] = None
    latency_ms: Optional[float] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    raw_metadata: Dict[str, Any] = field(default_factory=dict)


class EidosService:
    """Speaker enrollment & verification service backed by Detectif.ai Eidos (or labelled dev mock)."""

    def __init__(
        self,
        client: Optional[DetectifClient] = None,
        settings: Optional[Settings] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.client = client or DetectifClient(settings=self.settings)

    async def enroll_speaker(
        self,
        *,
        speaker_id: str,
        display_name: Optional[str],
        file_path: Path,
        duration_seconds: Optional[float] = None,
        existing_sample_count: int = 0,
        idempotency_key: Optional[str] = None,
    ) -> NormalizedEidosEnrollmentResult:
        if not self.settings.eidos_enabled:
            return NormalizedEidosEnrollmentResult(
                provider="detectif_eidos",
                provider_mode="DISABLED",
                status="FAILED",
                speaker_id=speaker_id,
                error_code="eidos_disabled",
                error_message="Eidos speaker verification is disabled in configuration.",
            )

        if self.settings.active_provider_mode == "mock":
            if existing_sample_count >= 5:
                return NormalizedEidosEnrollmentResult(
                    provider="detectif_eidos",
                    provider_mode="MOCK_DEV_ADAPTER",
                    status="FAILED",
                    speaker_id=speaker_id,
                    error_code="too_many_samples",
                    error_message="Speaker already has maximum 5 enrollment samples.",
                )
            return NormalizedEidosEnrollmentResult(
                provider="detectif_eidos",
                provider_mode="MOCK_DEV_ADAPTER",
                status="COMPLETED",
                speaker_id=speaker_id,
                samples=existing_sample_count + 1,
                speech_seconds=duration_seconds,
                duration_seconds=duration_seconds,
                operation_id=f"mock_op_{uuid.uuid4().hex[:20]}",
                request_id=f"mock_req_{uuid.uuid4().hex[:16]}",
                model_name="eidos-mock-dev",
                model_version="dev-mock",
                raw_metadata={
                    "mock": True,
                    "notice": "MOCK_DEV_ADAPTER: Configure DETECTIF_API_KEY for live Eidos speaker enrollment.",
                },
            )

        try:
            payload = await self.client.enroll_speaker(
                speaker_id=speaker_id,
                display_name=display_name,
                file_path=file_path,
                idempotency_key=idempotency_key,
            )
            speaker = payload.get("speaker") or {}
            quality = payload.get("quality") or {}
            model = payload.get("model") or {}
            return NormalizedEidosEnrollmentResult(
                provider="detectif_eidos",
                provider_mode="LIVE_PROVIDER_CHECK",
                status="COMPLETED",
                speaker_id=speaker.get("speaker_id", speaker_id),
                samples=int(speaker.get("samples", existing_sample_count + 1)),
                speech_seconds=quality.get("speech_seconds"),
                duration_seconds=quality.get("duration_seconds"),
                operation_id=payload.get("operation_id"),
                request_id=payload.get("request_id"),
                model_name=model.get("name"),
                model_version=model.get("version"),
                raw_metadata={
                    "object": payload.get("object"),
                    "speaker": speaker,
                    "credits": payload.get("credits"),
                },
            )
        except DetectifAPIError as exc:
            return NormalizedEidosEnrollmentResult(
                provider="detectif_eidos",
                provider_mode="LIVE_PROVIDER_CHECK",
                status="FAILED",
                speaker_id=speaker_id,
                request_id=exc.request_id,
                error_code=exc.error_code,
                error_message=exc.message,
                raw_metadata={"http_status": exc.status_code, "error_type": exc.error_type},
            )

    async def verify_speaker(
        self,
        *,
        speaker_id: str,
        file_path: Path,
        duration_seconds: Optional[float] = None,
        idempotency_key: Optional[str] = None,
    ) -> NormalizedEidosVerifyResult:
        if not self.settings.eidos_enabled:
            return NormalizedEidosVerifyResult(
                provider="detectif_eidos",
                provider_mode="DISABLED",
                status="FAILED",
                normalized_result="PROVIDER_ERROR",
                speaker_id=speaker_id,
                error_code="eidos_disabled",
                error_message="Eidos speaker verification is disabled in configuration.",
            )

        if self.settings.active_provider_mode == "mock":
            return NormalizedEidosVerifyResult(
                provider="detectif_eidos",
                provider_mode="MOCK_DEV_ADAPTER",
                status="COMPLETED",
                normalized_result="MATCH",
                decision="match",
                similarity=None,
                similarity_semantics="MOCK_DEV_ADAPTER: No live Detectif.ai comparison executed (API key not configured).",
                duration_seconds=duration_seconds,
                speaker_id=speaker_id,
                operation_id=f"mock_op_{uuid.uuid4().hex[:20]}",
                request_id=f"mock_req_{uuid.uuid4().hex[:16]}",
                model_name="eidos-mock-dev",
                model_version="dev-mock",
                raw_metadata={"mock": True, "notice": "Configure DETECTIF_API_KEY for live Eidos verification."},
            )

        try:
            payload = await self.client.verify_speaker(
                speaker_id=speaker_id,
                detect_deepfake=False,
                file_path=file_path,
                idempotency_key=idempotency_key,
            )
            return self.normalize_verify_response(payload)
        except DetectifAPIError as exc:
            return NormalizedEidosVerifyResult(
                provider="detectif_eidos",
                provider_mode="LIVE_PROVIDER_CHECK",
                status="FAILED",
                normalized_result="PROVIDER_ERROR",
                speaker_id=speaker_id,
                request_id=exc.request_id,
                error_code=exc.error_code,
                error_message=exc.message,
                raw_metadata={"http_status": exc.status_code, "error_type": exc.error_type},
            )

    async def delete_speaker(self, speaker_id: str) -> tuple[bool, Optional[str], Optional[str]]:
        """Delete a speaker profile at Detectif.ai (or mock). Returns (deleted, error_code, error_message)."""
        if self.settings.active_provider_mode == "mock":
            return True, None, None
        try:
            resp = await self.client.delete_speaker(speaker_id)
            return bool(resp.get("deleted", True)), None, None
        except DetectifAPIError as exc:
            if exc.error_code == "speaker_not_found":
                # Already absent on provider; safe to complete local revocation cleanly
                return True, None, None
            return False, exc.error_code, exc.message

    @staticmethod
    def normalize_verify_response(payload: Dict[str, Any]) -> NormalizedEidosVerifyResult:
        result = payload.get("result") or {}
        model = payload.get("model") or {}
        decision = result.get("decision")
        if decision == "match":
            normalized = "MATCH"
        elif decision == "no_match":
            normalized = "NO_MATCH"
        else:
            normalized = "PROVIDER_ERROR"

        return NormalizedEidosVerifyResult(
            provider="detectif_eidos",
            provider_mode="LIVE_PROVIDER_CHECK",
            status="COMPLETED",
            normalized_result=normalized,
            decision=decision,
            similarity=result.get("similarity"),
            similarity_semantics=result.get("similarity_semantics"),
            duration_seconds=result.get("duration_seconds"),
            speaker_id=payload.get("speaker_id"),
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
