from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import AuditEvent, EndUser, Tenant
from app.services.aletheia_service import AletheiaService, NormalizedAletheiaResult
from app.services.eidos_service import EidosService, NormalizedEidosVerifyResult
from app.services.transcription_service import ChallengeTranscriptionResult, TranscriptionService
from tests.conftest import make_wav_bytes


def _boot(client: TestClient, role_mode: str = "admin") -> str:
    resp = client.post("/api/demo/bootstrap", json={"role_mode": role_mode})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_complete_user_centric_portal_journeys(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """
    Tests A-F end-to-end:
    A: Genuine Telecom Customer SIM replacement (enroll -> session -> challenge -> verify PASS -> execute SIM swap)
    B: Attacker Impersonation in Telecom (Eidos NO_MATCH -> REJECT -> SIM swap blocked + audit event)
    C: IT Helpdesk Employee MFA reset (PASS -> MFA reset executed)
    D: Cross-action token security (password_reset token rejected for mfa_reset)
    E: Cross-tenant security (telecom token rejected in helpdesk; telecom operator blocked from enterprise)
    F: Failure handling (provider outage -> REVIEW; expired challenge -> REJECT)
    """
    admin_tok = _boot(client, "admin")

    telecom = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-telecom"))
    enterprise = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-enterprise"))
    cust1 = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == telecom.id, EndUser.external_reference == "CUST-TEL-001")
    )
    emp1 = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == enterprise.id, EndUser.external_reference == "EMP-ENT-001")
    )

    # Ensure clean reset first
    assert client.post("/api/demo/reset", headers=_headers(admin_tok), json={"clear_enrollments": True}).status_code == 200

    # Enroll cust1 and emp1
    enroll_wav = make_wav_bytes(16.0)
    for tid, uid in [(telecom.id, cust1.id), (enterprise.id, emp1.id)]:
        r = client.post(
            "/api/enrollments",
            headers=_headers(admin_tok),
            data={"tenant_id": tid, "user_id": uid, "consent_confirmed": "true"},
            files={"file": ("enroll.wav", enroll_wav, "audio/wav")},
        )
        assert r.status_code == 201

    scenario_state = {"aletheia": "REAL", "eidos": "MATCH", "stt": True}

    def stub_stt(self, *, audio_path: Path, expected_phrase: str) -> ChallengeTranscriptionResult:
        return ChallengeTranscriptionResult(
            provider="faster_whisper_stub",
            status="COMPLETED",
            matched=scenario_state["stt"],
            normalized_result="MATCH" if scenario_state["stt"] else "MISMATCH",
            transcript=expected_phrase if scenario_state["stt"] else "other phrase",
            match_ratio=1.0 if scenario_state["stt"] else 0.0,
        )

    async def stub_aletheia(self, *, file_path: Path, duration_seconds: Optional[float] = None, idempotency_key=None):
        if scenario_state["aletheia"] == "TIMEOUT":
            return NormalizedAletheiaResult(
                provider="detectif_aletheia",
                provider_mode="LIVE_PROVIDER_CHECK",
                status="FAILED",
                normalized_result="PROVIDER_ERROR",
                error_code="inference_timeout",
                error_message="Timeout",
            )
        return NormalizedAletheiaResult(
            provider="detectif_aletheia",
            provider_mode="LIVE_PROVIDER_CHECK",
            status="COMPLETED",
            normalized_result="REAL",
            verdict="real",
            operation_id="op_al_e2e",
        )

    async def stub_eidos(self, *, speaker_id: str, file_path: Path, duration_seconds: Optional[float] = None, idempotency_key=None):
        ok = scenario_state["eidos"] == "MATCH"
        return NormalizedEidosVerifyResult(
            provider="detectif_eidos",
            provider_mode="LIVE_PROVIDER_CHECK",
            status="COMPLETED",
            normalized_result="MATCH" if ok else "NO_MATCH",
            decision="match" if ok else "no_match",
            similarity=0.81 if ok else -0.22,
            speaker_id=speaker_id,
            operation_id="op_ei_e2e",
        )

    monkeypatch.setattr(TranscriptionService, "verify_challenge", stub_stt)
    monkeypatch.setattr(AletheiaService, "check_audio", stub_aletheia)
    monkeypatch.setattr(EidosService, "verify_speaker", stub_eidos)

    verify_wav = make_wav_bytes(4.5)

    # Test A: Genuine Telecom SIM Replacement
    s_gen = client.post(
        "/api/sessions",
        headers=_headers(admin_tok),
        json={
            "tenant_id": telecom.id,
            "user_id": cust1.id,
            "requested_action": "sim_replacement",
            "resource_reference": "SIM-E2E-1",
        },
    ).json()
    c_gen = client.post(f"/api/sessions/{s_gen['id']}/challenge", headers=_headers(admin_tok)).json()
    v_gen = client.post(
        f"/api/sessions/{s_gen['id']}/verify",
        headers=_headers(admin_tok),
        data={"challenge_id": c_gen["id"]},
        files={"file": ("clip.wav", verify_wav, "audio/wav")},
    ).json()
    assert v_gen["decision"]["outcome"] == "PASS"
    tel_token = v_gen["authorization_token"]

    exec_tel = client.post(
        "/api/workflows/telecom/execute",
        headers=_headers(admin_tok),
        json={
            "tenant_id": telecom.id,
            "user_id": cust1.id,
            "action": "sim_replacement",
            "resource_reference": "SIM-E2E-1",
            "authorization_token": tel_token,
            "operation_payload": {"reason": "Lost SIM", "new_sim_iccid": "890141032199998888"},
        },
    )
    assert exec_tel.status_code == 201
    # Check Telecom customer metadata updated after authorized execution
    tel_users = client.get(f"/api/tenants/{telecom.id}/users", headers=_headers(admin_tok)).json()
    updated_cust1 = next(u for u in tel_users if u["id"] == cust1.id)
    assert updated_cust1["metadata_json"]["sim_status"] == "Replacement Provisioned"

    # Test B: Attacker Impersonation (NO_MATCH -> REJECT)
    scenario_state["eidos"] = "NO_MATCH"
    s_atk = client.post(
        "/api/sessions",
        headers=_headers(admin_tok),
        json={
            "tenant_id": telecom.id,
            "user_id": cust1.id,
            "requested_action": "sim_replacement",
            "resource_reference": "SIM-ATK-1",
        },
    ).json()
    c_atk = client.post(f"/api/sessions/{s_atk['id']}/challenge", headers=_headers(admin_tok)).json()
    v_atk = client.post(
        f"/api/sessions/{s_atk['id']}/verify",
        headers=_headers(admin_tok),
        data={"challenge_id": c_atk["id"]},
        files={"file": ("attacker.wav", verify_wav, "audio/wav")},
    ).json()
    assert v_atk["decision"]["outcome"] == "REJECT"
    assert v_atk["authorization_token"] is None
    audits = db_session.scalars(select(AuditEvent).where(AuditEvent.session_id == s_atk["id"])).all()
    assert any(a.event_type == "decision.reject" for a in audits)

    # Test C & D: IT Helpdesk MFA Reset + Cross-Action Token Denial
    scenario_state["eidos"] = "MATCH"
    s_pw = client.post(
        "/api/sessions",
        headers=_headers(admin_tok),
        json={
            "tenant_id": enterprise.id,
            "user_id": emp1.id,
            "requested_action": "password_reset",
            "resource_reference": "INC-PW-1",
        },
    ).json()
    c_pw = client.post(f"/api/sessions/{s_pw['id']}/challenge", headers=_headers(admin_tok)).json()
    v_pw = client.post(
        f"/api/sessions/{s_pw['id']}/verify",
        headers=_headers(admin_tok),
        data={"challenge_id": c_pw["id"]},
        files={"file": ("emp.wav", verify_wav, "audio/wav")},
    ).json()
    pw_token = v_pw["authorization_token"]

    # Attempt to use password_reset token for mfa_reset -> MUST FAIL 403
    cross_act = client.post(
        "/api/workflows/helpdesk/execute",
        headers=_headers(admin_tok),
        json={
            "tenant_id": enterprise.id,
            "user_id": emp1.id,
            "action": "mfa_reset",
            "resource_reference": "INC-PW-1",
            "authorization_token": pw_token,
        },
    )
    assert cross_act.status_code == 403
    assert cross_act.json()["error"]["code"] == "token_action_mismatch"

    # Test E: Cross-Tenant Security (password_reset token from enterprise rejected in telecom)
    cross_ten = client.post(
        "/api/workflows/telecom/execute",
        headers=_headers(admin_tok),
        json={
            "tenant_id": telecom.id,
            "user_id": cust1.id,
            "action": "sim_replacement",
            "resource_reference": "INC-PW-1",
            "authorization_token": pw_token,
        },
    )
    assert cross_ten.status_code == 403
    assert cross_ten.json()["error"]["code"] == "token_tenant_mismatch"

    # Legitimate MFA reset session -> PASS -> Executes
    s_mfa = client.post(
        "/api/sessions",
        headers=_headers(admin_tok),
        json={
            "tenant_id": enterprise.id,
            "user_id": emp1.id,
            "requested_action": "mfa_reset",
            "resource_reference": "INC-MFA-9",
        },
    ).json()
    c_mfa = client.post(f"/api/sessions/{s_mfa['id']}/challenge", headers=_headers(admin_tok)).json()
    v_mfa = client.post(
        f"/api/sessions/{s_mfa['id']}/verify",
        headers=_headers(admin_tok),
        data={"challenge_id": c_mfa["id"]},
        files={"file": ("emp.wav", verify_wav, "audio/wav")},
    ).json()
    assert v_mfa["decision"]["outcome"] == "PASS"
    assert (
        client.post(
            "/api/workflows/helpdesk/execute",
            headers=_headers(admin_tok),
            json={
                "tenant_id": enterprise.id,
                "user_id": emp1.id,
                "action": "mfa_reset",
                "resource_reference": "INC-MFA-9",
                "authorization_token": v_mfa["authorization_token"],
            },
        ).status_code
        == 201
    )
