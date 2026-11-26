from __future__ import annotations

import asyncio
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import SandboxSession, WebhookDelivery
from app.services.n8n_service import (
    deliver_webhook_record,
    enqueue_webhook_event,
    sign_webhook_payload,
)
from app.services.transcription_service import ChallengeTranscriptionResult
from tests.conftest import make_wav_bytes


def _login(client: TestClient, role_mode: str = "admin") -> str:
    res = client.post("/api/demo/bootstrap", json={"role_mode": role_mode})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_sandbox_environments_and_overview(client: TestClient) -> None:
    token = _login(client, "admin")
    envs_res = client.get("/api/sandbox/environments", headers=_auth_headers(token))
    assert envs_res.status_code == 200
    envs = envs_res.json()
    industries = {e["industry"] for e in envs}
    assert industries == {"telecom", "banking", "helpdesk", "education"}

    ov_res = client.get("/api/sandbox/overview", headers=_auth_headers(token))
    assert ov_res.status_code == 200
    assert "total_tests" in ov_res.json()


def test_sandbox_tenant_isolation_and_unauthorized(client: TestClient) -> None:
    # Unauthenticated request rejected
    unauth = client.get("/api/sandbox/environments")
    assert unauth.status_code == 401

    # Telecom operator cannot create a banking sandbox session
    telecom_token = _login(client, "telecom")
    admin_token = _login(client, "admin")
    envs = client.get("/api/sandbox/environments", headers=_auth_headers(admin_token)).json()
    banking_env = next(e for e in envs if e["industry"] == "banking")

    forbidden = client.post(
        "/api/sandbox/sessions",
        headers=_auth_headers(telecom_token),
        json={
            "industry": "banking",
            "scenario_id": banking_env["scenario_id"],
            "tenant_id": banking_env["tenant_id"],
            "user_id": banking_env["users"][0]["id"],
        },
    )
    assert forbidden.status_code == 403


def test_sandbox_e2e_verification_replay_and_corrupt_audio(client: TestClient, db_session: Session) -> None:
    token = _login(client, "admin")
    envs = client.get("/api/sandbox/environments", headers=_auth_headers(token)).json()
    telecom_env = next(e for e in envs if e["industry"] == "telecom")
    enrolled_user = next(u for u in telecom_env["users"] if u["enrolled"])

    # 1. Create Telecom Sandbox Session
    create_res = client.post(
        "/api/sandbox/sessions",
        headers=_auth_headers(token),
        json={
            "industry": "telecom",
            "scenario_id": "telecom_sim_replacement",
            "tenant_id": telecom_env["tenant_id"],
            "user_id": enrolled_user["id"],
            "attack_type": "genuine_speaker",
        },
    )
    assert create_res.status_code == 201, create_res.text
    sb = create_res.json()
    challenge = sb["verification_session"]["latest_challenge"]
    assert challenge is not None

    # 2. Verify with mocked Whisper returning exact challenge phrase + mock Detectif adapter
    wav = make_wav_bytes(3.5)
    stt_ok = ChallengeTranscriptionResult(
        provider="faster_whisper",
        status="COMPLETED",
        normalized_result="MATCH",
        matched=True,
        transcript=challenge["challenge_text"],
        normalized_expected=challenge["challenge_text"].lower(),
        normalized_transcript=challenge["challenge_text"].lower(),
        matched_tokens=challenge["challenge_text"].lower().split(),
        missing_tokens=[],
        match_ratio=1.0,
        language="en",
    )
    with patch("app.services.transcription_service.TranscriptionService.verify_challenge", return_value=stt_ok):
        verify_res = client.post(
            f"/api/sandbox/sessions/{sb['id']}/verify",
            headers=_auth_headers(token),
            data={"challenge_id": challenge["id"], "attack_type": "genuine_speaker", "input_type": "microphone"},
            files={"file": ("sample.wav", wav, "audio/wav")},
        )
    assert verify_res.status_code == 200, verify_res.text
    vdata = verify_res.json()
    assert vdata["sandbox_session"]["decision_outcome"] == "APPROVED"
    assert vdata["sandbox_session"]["challenge_valid"] is True
    assert vdata["sandbox_session"]["audit_event_id"] is not None

    # Verify WebhookDelivery outbox records were created
    deliveries = db_session.query(WebhookDelivery).filter(WebhookDelivery.session_id == sb["verification_session_id"]).all()
    assert len(deliveries) >= 1

    # 3. Replay Attack: submit a new sandbox session using the ALREADY-CONSUMED challenge ID
    replay_create = client.post(
        "/api/sandbox/sessions",
        headers=_auth_headers(token),
        json={
            "industry": "telecom",
            "scenario_id": "telecom_sim_replacement",
            "tenant_id": telecom_env["tenant_id"],
            "user_id": enrolled_user["id"],
            "attack_type": "replay_attack",
        },
    ).json()
    replay_res = client.post(
        f"/api/sandbox/sessions/{replay_create['id']}/verify",
        headers=_auth_headers(token),
        data={"challenge_id": challenge["id"], "attack_type": "replay_attack", "input_type": "upload"},
        files={"file": ("replay.wav", wav, "audio/wav")},
    )
    assert replay_res.status_code in (200, 400, 404, 409)
    if replay_res.status_code == 200:
        assert replay_res.json()["sandbox_session"]["decision_outcome"] == "REJECTED"

    # 4. Corrupt / Poor Audio Quality rejected safely
    bad_create = client.post(
        "/api/sandbox/sessions",
        headers=_auth_headers(token),
        json={
            "industry": "telecom",
            "scenario_id": "telecom_sim_replacement",
            "tenant_id": telecom_env["tenant_id"],
            "user_id": enrolled_user["id"],
            "attack_type": "poor_audio_quality",
        },
    ).json()
    bad_ch = bad_create["verification_session"]["latest_challenge"]["id"]
    corrupt_res = client.post(
        f"/api/sandbox/sessions/{bad_create['id']}/verify",
        headers=_auth_headers(token),
        data={"challenge_id": bad_ch, "attack_type": "poor_audio_quality", "input_type": "upload"},
        files={"file": ("corrupt.wav", b"not-a-valid-wav", "audio/wav")},
    )
    assert corrupt_res.status_code == 422

    # 5. History filtering & Analytics
    hist = client.get("/api/sandbox/sessions?industry=telecom&limit=5&offset=0", headers=_auth_headers(token))
    assert hist.status_code == 200
    assert hist.json()["total"] >= 2

    analytics = client.get("/api/sandbox/analytics", headers=_auth_headers(token))
    assert analytics.status_code == 200
    assert analytics.json()["summary"]["total_sandbox_tests"] >= 2


def test_n8n_outbox_idempotency_hmac_retry_and_reporting(client: TestClient, db_session: Session) -> None:
    token = _login(client, "admin")

    # 1. HMAC signature determinism
    sig1 = sign_webhook_payload("sec", "2026-11-25T00:00:00Z", "evt_1", b'{"a":1}')
    sig2 = sign_webhook_payload("sec", "2026-11-25T00:00:00Z", "evt_1", b'{"a":1}')
    assert sig1.startswith("sha256=") and sig1 == sig2

    # 2. Idempotency: enqueueing same event_id twice returns same record
    cfg = Settings(n8n_enabled=True, n8n_webhook_url="http://n8n.local/webhook/test", n8n_webhook_secret="sec", n8n_max_retries=2)
    payload = {"event_id": "evt_idempotent_001", "event_type": "VOICE_VERIFICATION_COMPLETED", "decision": "REJECTED"}
    d1 = enqueue_webhook_event(db_session, payload=payload, settings=cfg)
    d2 = enqueue_webhook_event(db_session, payload=payload, settings=cfg)
    assert d1 is not None and d2 is not None and d1.id == d2.id
    db_session.commit()

    # 3. Bounded retry on n8n unavailable -> DEAD_LETTER
    def fail_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="n8n unavailable")

    async def _run_fail():
        return await deliver_webhook_record(
            db_session, d1, settings=cfg, transport=httpx.MockTransport(fail_handler)
        )

    res_fail = asyncio.run(_run_fail())
    assert res_fail.status == "DEAD_LETTER"
    assert res_fail.attempt_count == 2

    # 4. Successful delivery on retry
    def ok_handler(request: httpx.Request) -> httpx.Response:
        assert "X-VoiceSuraksha-Signature" in request.headers
        return httpx.Response(200, json={"ok": True})

    d1.status = "PENDING"
    d1.attempt_count = 0
    db_session.commit()

    async def _run_ok():
        return await deliver_webhook_record(
            db_session, d1, settings=cfg, transport=httpx.MockTransport(ok_handler)
        )

    res_ok = asyncio.run(_run_ok())
    assert res_ok.status == "DELIVERED"

    # 5. Automation Center API endpoints
    st = client.get("/api/automation/status", headers=_auth_headers(token))
    assert st.status_code == 200
    assert "workflows" in st.json()

    tog = client.post("/api/automation/toggle", headers=_auth_headers(token), json={"enabled": True})
    assert tog.status_code == 200
    assert tog.json()["n8n_enabled"] is True

    delivs = client.get("/api/automation/deliveries", headers=_auth_headers(token))
    assert delivs.status_code == 200

    # 6. Daily reporting endpoint requires auth
    unauth_rep = client.get("/api/automation/reporting/daily")
    assert unauth_rep.status_code == 401
    auth_rep = client.get("/api/automation/reporting/daily", headers=_auth_headers(token))
    assert auth_rep.status_code == 200
    assert "total_verifications" in auth_rep.json()
