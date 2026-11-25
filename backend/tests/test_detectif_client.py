from __future__ import annotations

from pathlib import Path
from typing import List

import httpx
import pytest

from app.core.config import Settings
from app.services.aletheia_service import AletheiaService
from app.services.detectif_client import DetectifClient
from app.services.eidos_service import EidosService


@pytest.mark.asyncio
async def test_detectif_aletheia_live_client_with_retry_and_idempotency(tmp_path: Path) -> None:
    audio_file = tmp_path / "sample.wav"
    audio_file.write_bytes(b"RIFFtestwavbytes")

    seen_keys: List[str] = []
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        assert request.headers["Authorization"] == "Bearer dtf_test_key"
        assert request.url.path == "/v1/deepfake/detect"
        seen_keys.append(request.headers["Idempotency-Key"])
        if attempts == 1:
            return httpx.Response(
                503,
                headers={"Retry-After": "0.01"},
                json={
                    "error": {"type": "overloaded", "code": "server_busy", "message": "Busy"},
                    "request_id": "req_retry_1",
                },
            )
        return httpx.Response(
            200,
            json={
                "request_id": "req_ok_2",
                "operation_id": "op_live_aletheia",
                "object": "deepfake.detection",
                "result": {
                    "verdict": "real",
                    "label": "genuine",
                    "is_synthetic": False,
                    "score": 0.05,
                    "score_semantics": "Higher means more likely AI-generated.",
                    "duration_seconds": 5.2,
                    "segments": [],
                },
                "model": {"name": "aletheia", "version": "2026.10"},
                "latency_ms": 210.0,
            },
        )

    settings = Settings(
        detectif_api_key="dtf_test_key",
        detectif_provider_mode="live",
        detectif_max_retries=2,
    )
    client = DetectifClient(settings=settings, transport=httpx.MockTransport(handler))
    service = AletheiaService(client=client, settings=settings)

    res = await service.check_audio(file_path=audio_file, duration_seconds=5.2)
    assert attempts == 2
    # Must reuse exact same Idempotency-Key across retries
    assert len(seen_keys) == 2
    assert seen_keys[0] == seen_keys[1]
    assert res.status == "COMPLETED"
    assert res.provider_mode == "LIVE_PROVIDER_CHECK"
    assert res.normalized_result == "REAL"
    assert res.operation_id == "op_live_aletheia"


@pytest.mark.asyncio
async def test_detectif_eidos_enroll_verify_delete_and_error_handling(tmp_path: Path) -> None:
    audio_file = tmp_path / "voice.wav"
    audio_file.write_bytes(b"RIFFtestwavbytes")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/speakers/enroll":
            return httpx.Response(
                200,
                json={
                    "request_id": "req_enr",
                    "operation_id": "op_enr_1",
                    "object": "speaker.enrollment",
                    "speaker": {"speaker_id": "vl_t1_u1", "display_name": "Test", "samples": 1},
                    "quality": {"speech_seconds": 16.5, "duration_seconds": 18.0},
                    "model": {"name": "eidos", "version": "2026.10"},
                },
            )
        if request.url.path == "/v1/speakers/verify":
            return httpx.Response(
                401,
                json={
                    "error": {"type": "authentication", "code": "invalid_api_key", "message": "Invalid API key"},
                    "request_id": "req_auth_err",
                },
            )
        if request.url.path == "/v1/speakers/vl_t1_u1" and request.method == "DELETE":
            return httpx.Response(
                200,
                json={"request_id": "req_del", "object": "speaker.deleted", "speaker_id": "vl_t1_u1", "deleted": True},
            )
        return httpx.Response(404)

    settings = Settings(detectif_api_key="dtf_test_key", detectif_provider_mode="live", detectif_max_retries=0)
    client = DetectifClient(settings=settings, transport=httpx.MockTransport(handler))
    eidos = EidosService(client=client, settings=settings)

    enr = await eidos.enroll_speaker(speaker_id="vl_t1_u1", display_name="Test", file_path=audio_file)
    assert enr.status == "COMPLETED"
    assert enr.operation_id == "op_enr_1"
    assert enr.samples == 1

    ver = await eidos.verify_speaker(speaker_id="vl_t1_u1", file_path=audio_file)
    assert ver.status == "FAILED"
    assert ver.normalized_result == "PROVIDER_ERROR"
    assert ver.error_code == "invalid_api_key"

    deleted, err_code, _ = await eidos.delete_speaker("vl_t1_u1")
    assert deleted is True
    assert err_code is None
