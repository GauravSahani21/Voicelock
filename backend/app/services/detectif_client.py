from __future__ import annotations

import asyncio
import mimetypes
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from app.core.config import Settings, get_settings
from app.core.logging import get_logger

logger = get_logger("voicelock.detectif")

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


@dataclass
class DetectifAPIError(Exception):
    """Structured error raised when Detectif.ai returns a non-2xx response or fails."""

    status_code: Optional[int]
    error_code: str
    error_type: str
    message: str
    request_id: Optional[str] = None
    param: Optional[str] = None
    retryable: bool = False

    def __str__(self) -> str:
        return f"DetectifAPIError(status={self.status_code}, code={self.error_code}, message={self.message})"


class DetectifClient:
    """Async HTTP client wrapping the documented Detectif.ai v1 REST API."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.base_url = self.settings.detectif_base_url
        self.api_key = self.settings.detectif_api_key.strip()
        self.timeout = self.settings.detectif_timeout_seconds
        self.max_retries = self.settings.detectif_max_retries
        self.transport = transport

    def _headers(self, idempotency_key: Optional[str] = None, include_auth: bool = True) -> Dict[str, str]:
        headers: Dict[str, str] = {"Accept": "application/json"}
        if include_auth and self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _parse_error(self, response: httpx.Response) -> DetectifAPIError:
        request_id = response.headers.get("X-Request-Id")
        try:
            body = response.json()
        except Exception:
            body = {}
        err = body.get("error") if isinstance(body, dict) else None
        request_id = body.get("request_id", request_id) if isinstance(body, dict) else request_id
        if isinstance(err, dict):
            return DetectifAPIError(
                status_code=response.status_code,
                error_code=str(err.get("code") or f"http_{response.status_code}"),
                error_type=str(err.get("type") or "provider_error"),
                message=str(err.get("message") or f"Detectif.ai returned HTTP {response.status_code}."),
                request_id=request_id,
                param=err.get("param"),
                retryable=response.status_code in RETRYABLE_STATUS_CODES,
            )
        return DetectifAPIError(
            status_code=response.status_code,
            error_code=f"http_{response.status_code}",
            error_type="provider_error",
            message=f"Detectif.ai returned HTTP {response.status_code}.",
            request_id=request_id,
            retryable=response.status_code in RETRYABLE_STATUS_CODES,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        include_auth: bool = True,
        idempotency_key: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        file_path: Optional[Path] = None,
        file_bytes: Optional[bytes] = None,
        filename: Optional[str] = None,
    ) -> Dict[str, Any]:
        if include_auth and not self.api_key:
            raise DetectifAPIError(
                status_code=None,
                error_code="missing_api_key",
                error_type="authentication",
                message="DETECTIF_API_KEY is not configured in backend environment.",
                retryable=False,
            )

        idem = idempotency_key or (str(uuid.uuid4()) if method.upper() == "POST" else None)
        headers = self._headers(idempotency_key=idem, include_auth=include_auth)

        # Read audio bytes once so safe retries with identical Idempotency-Key can resend cleanly
        payload_bytes: Optional[bytes] = file_bytes
        upload_name: str = filename or (file_path.name if file_path else "audio.wav")
        if payload_bytes is None and file_path is not None:
            payload_bytes = file_path.read_bytes()
        mime_type = mimetypes.guess_type(upload_name)[0] or "application/octet-stream"

        client_kwargs: Dict[str, Any] = {
            "base_url": self.base_url,
            "timeout": httpx.Timeout(self.timeout),
        }
        if self.transport is not None:
            client_kwargs["transport"] = self.transport

        async with httpx.AsyncClient(**client_kwargs) as client:
            for attempt in range(self.max_retries + 1):
                files = {"file": (upload_name, payload_bytes, mime_type)} if payload_bytes is not None else None
                try:
                    response = await client.request(
                        method=method,
                        url=path,
                        headers=headers,
                        data=data,
                        files=files,
                    )
                except httpx.TimeoutException as exc:
                    if attempt < self.max_retries:
                        await asyncio.sleep(0.5 * (attempt + 1))
                        continue
                    raise DetectifAPIError(
                        status_code=504,
                        error_code="provider_timeout",
                        error_type="timeout",
                        message="Detectif.ai request timed out.",
                        retryable=True,
                    ) from exc
                except httpx.HTTPError as exc:
                    if attempt < self.max_retries:
                        await asyncio.sleep(0.5 * (attempt + 1))
                        continue
                    raise DetectifAPIError(
                        status_code=503,
                        error_code="provider_unreachable",
                        error_type="network_error",
                        message=f"Unable to reach Detectif.ai API ({type(exc).__name__}).",
                        retryable=True,
                    ) from exc

                if 200 <= response.status_code < 300:
                    return response.json()

                api_err = self._parse_error(response)
                if api_err.retryable and attempt < self.max_retries:
                    retry_after_raw = response.headers.get("Retry-After")
                    try:
                        delay = min(float(retry_after_raw), 5.0) if retry_after_raw else 0.75 * (attempt + 1)
                    except ValueError:
                        delay = 0.75 * (attempt + 1)
                    logger.warning(
                        "Detectif transient error path=%s status=%s code=%s retry_in=%.2fs",
                        path,
                        response.status_code,
                        api_err.error_code,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    continue

                raise api_err

        raise DetectifAPIError(
            status_code=503,
            error_code="provider_unavailable",
            error_type="internal",
            message="Detectif.ai request exhausted retries.",
            retryable=True,
        )

    async def get_health(self) -> Dict[str, Any]:
        """GET /v1/health (unauthenticated service status)."""
        return await self._request("GET", "/v1/health", include_auth=False)

    async def get_credits(self) -> Dict[str, Any]:
        """GET /v1/credits (authenticated account credit balance)."""
        return await self._request("GET", "/v1/credits")

    async def get_operation(self, operation_id: str) -> Dict[str, Any]:
        """GET /v1/operations/{operation_id}."""
        return await self._request("GET", f"/v1/operations/{operation_id}")

    async def detect_deepfake(
        self,
        *,
        file_path: Optional[Path] = None,
        file_bytes: Optional[bytes] = None,
        filename: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """POST /v1/deepfake/detect (Aletheia)."""
        return await self._request(
            "POST",
            "/v1/deepfake/detect",
            file_path=file_path,
            file_bytes=file_bytes,
            filename=filename,
            idempotency_key=idempotency_key,
        )

    async def enroll_speaker(
        self,
        *,
        speaker_id: str,
        display_name: Optional[str] = None,
        file_path: Optional[Path] = None,
        file_bytes: Optional[bytes] = None,
        filename: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """POST /v1/speakers/enroll (Eidos)."""
        form_data: Dict[str, Any] = {"speaker_id": speaker_id}
        if display_name:
            form_data["display_name"] = display_name[:128]
        return await self._request(
            "POST",
            "/v1/speakers/enroll",
            data=form_data,
            file_path=file_path,
            file_bytes=file_bytes,
            filename=filename,
            idempotency_key=idempotency_key,
        )

    async def verify_speaker(
        self,
        *,
        speaker_id: str,
        detect_deepfake: bool = False,
        file_path: Optional[Path] = None,
        file_bytes: Optional[bytes] = None,
        filename: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """POST /v1/speakers/verify (Eidos)."""
        form_data: Dict[str, Any] = {
            "speaker_id": speaker_id,
            "detect_deepfake": "true" if detect_deepfake else "false",
        }
        return await self._request(
            "POST",
            "/v1/speakers/verify",
            data=form_data,
            file_path=file_path,
            file_bytes=file_bytes,
            filename=filename,
            idempotency_key=idempotency_key,
        )

    async def get_speaker(self, speaker_id: str) -> Dict[str, Any]:
        """GET /v1/speakers/{speaker_id}."""
        return await self._request("GET", f"/v1/speakers/{speaker_id}")

    async def delete_speaker(self, speaker_id: str) -> Dict[str, Any]:
        """DELETE /v1/speakers/{speaker_id}."""
        return await self._request("DELETE", f"/v1/speakers/{speaker_id}")
