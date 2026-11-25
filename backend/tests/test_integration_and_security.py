from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Optional

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import sha256_hex
from app.models.entities import AuthorizationToken, Challenge, EndUser, Tenant
from app.services.aletheia_service import NormalizedAletheiaResult
from app.services.eidos_service import NormalizedEidosVerifyResult
from app.services.transcription_service import ChallengeTranscriptionResult
from tests.conftest import make_wav_bytes


def login_as(client: TestClient, email: str, password: str) -> str:
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_authentication_and_tenant_isolation(client: TestClient, db_session: Session) -> None:
    # Unauthenticated request rejected
    assert client.get("/api/tenants").status_code == 401
    assert client.get("/api/auth/me").status_code == 401

    # Invalid login fails
    bad = client.post("/api/auth/login", json={"email": "admin@voicelock.demo", "password": "wrong-password"})
    assert bad.status_code == 401

    # Telecom operator login
    tel_token = login_as(client, "telecom.ops@voicelock.demo", "DemoTelecom!2026")
    me = client.get("/api/auth/me", headers=auth_headers(tel_token))
    assert me.status_code == 200
    assert me.json()["role"] == "operator"

    # Telecom operator sees ONLY Demo Telecom tenant
    tenants = client.get("/api/tenants", headers=auth_headers(tel_token)).json()
    assert len(tenants) == 1
    assert tenants[0]["slug"] == "demo-telecom"

    # Telecom operator cannot create a tenant (platform_admin only)
    create_resp = client.post(
        "/api/tenants",
        headers=auth_headers(tel_token),
        json={"slug": "rogue-tenant", "name": "Rogue", "industry": "telecom"},
    )
    assert create_resp.status_code == 403

    # Telecom operator CANNOT access Demo Enterprise tenant or users
    enterprise = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-enterprise"))
    assert enterprise is not None
    assert client.get(f"/api/tenants/{enterprise.id}", headers=auth_headers(tel_token)).status_code == 403
    assert client.get(f"/api/tenants/{enterprise.id}/users", headers=auth_headers(tel_token)).status_code == 403
    assert client.get(f"/api/enrollments?tenant_id={enterprise.id}", headers=auth_headers(tel_token)).status_code == 403

    # Logout revokes JWT immediately
    assert client.post("/api/auth/logout", headers=auth_headers(tel_token)).status_code == 200
    assert client.get("/api/auth/me", headers=auth_headers(tel_token)).status_code == 401


def test_enrollment_consent_duration_and_revocation(client: TestClient, db_session: Session) -> None:
    admin_token = login_as(client, "admin@voicelock.demo", "DemoAdmin!2026")
    telecom = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-telecom"))
    cust1 = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == telecom.id, EndUser.external_reference == "CUST-TEL-001")
    )

    # Consent missing -> 400
    short_wav = make_wav_bytes(5.0)
    resp_no_consent = client.post(
        "/api/enrollments",
        headers=auth_headers(admin_token),
        data={"tenant_id": telecom.id, "user_id": cust1.id, "consent_confirmed": "false"},
        files={"file": ("enroll.wav", short_wav, "audio/wav")},
    )
    assert resp_no_consent.status_code == 400

    # Audio shorter than 15s for Eidos enrollment -> 422
    resp_too_short = client.post(
        "/api/enrollments",
        headers=auth_headers(admin_token),
        data={"tenant_id": telecom.id, "user_id": cust1.id, "consent_confirmed": "true"},
        files={"file": ("enroll.wav", short_wav, "audio/wav")},
    )
    assert resp_too_short.status_code == 422
    assert resp_too_short.json()["error"]["code"] == "audio_too_short"

    # Valid 16s WAV enrollment succeeds (re_enroll=true ensures clean 1/5 sample count regardless of test order)
    enroll_wav = make_wav_bytes(16.0)
    resp_ok = client.post(
        "/api/enrollments",
        headers=auth_headers(admin_token),
        data={"tenant_id": telecom.id, "user_id": cust1.id, "consent_confirmed": "true", "re_enroll": "true"},
        files={"file": ("enroll.wav", enroll_wav, "audio/wav")},
    )
    assert resp_ok.status_code == 201, resp_ok.text
    enr_data = resp_ok.json()
    assert enr_data["enrollment_status"] == "enrolled"
    assert enr_data["sample_count"] == 1

    # Verify temporary files were cleaned up completely
    tmp_dir = get_settings().resolved_temp_audio_dir
    assert list(tmp_dir.iterdir()) == []

    # Revoke enrollment cleanly
    rev = client.delete(f"/api/enrollments/{enr_data['id']}", headers=auth_headers(admin_token))
    assert rev.status_code == 200
    assert rev.json()["enrollment_status"] == "revoked"


def test_audio_validation_rejects_malformed_and_oversized(client: TestClient, db_session: Session) -> None:
    admin_token = login_as(client, "admin@voicelock.demo", "DemoAdmin!2026")
    telecom = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-telecom"))
    cust1 = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == telecom.id, EndUser.external_reference == "CUST-TEL-001")
    )

    sess = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust1.id,
            "requested_action": "sim_replacement",
            "resource_reference": "SIM-BAD-AUDIO-1",
        },
    ).json()
    ch = client.post(f"/api/sessions/{sess['id']}/challenge", headers=auth_headers(admin_token)).json()

    # Corrupt / malformed audio
    bad_audio = client.post(
        f"/api/sessions/{sess['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": ch["id"]},
        files={"file": ("corrupt.wav", b"not-a-valid-wav-file", "audio/wav")},
    )
    assert bad_audio.status_code == 422

    # Unsupported extension
    bad_ext = client.post(
        f"/api/sessions/{sess['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": ch["id"]},
        files={"file": ("script.exe", b"MZ...", "application/octet-stream")},
    )
    assert bad_ext.status_code == 415

    # Oversized upload (>25MB)
    oversized = b"0" * (26 * 1024 * 1024)
    big_resp = client.post(
        f"/api/sessions/{sess['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": ch["id"]},
        files={"file": ("huge.wav", oversized, "audio/wav")},
    )
    assert big_resp.status_code == 413
    assert list(get_settings().resolved_temp_audio_dir.iterdir()) == []


def test_e2e_workflows_security_tokens_and_outages(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """
    Tests end-to-end flows across Telecom, Helpdesk, Banking, and Education,
    plus token action/resource/tenant binding, replay prevention, challenge expiry/replay,
    and Detectif outage safe-fail.
    """
    admin_token = login_as(client, "admin@voicelock.demo", "DemoAdmin!2026")

    telecom = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-telecom"))
    enterprise = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-enterprise"))
    bank = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-bank"))
    university = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-university"))

    cust_tel = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == telecom.id, EndUser.external_reference == "CUST-TEL-001")
    )
    emp_ent = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == enterprise.id, EndUser.external_reference == "EMP-ENT-001")
    )
    cust_bnk = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == bank.id, EndUser.external_reference == "BNK-CUST-001")
    )
    stu_uni = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == university.id, EndUser.external_reference == "STU-UNI-001")
    )

    # Enroll cust_tel, emp_ent, cust_bnk, stu_uni
    enroll_wav = make_wav_bytes(16.0)
    for tid, uid in [
        (telecom.id, cust_tel.id),
        (enterprise.id, emp_ent.id),
        (bank.id, cust_bnk.id),
        (university.id, stu_uni.id),
    ]:
        r = client.post(
            "/api/enrollments",
            headers=auth_headers(admin_token),
            data={"tenant_id": tid, "user_id": uid, "consent_confirmed": "true"},
            files={"file": ("enroll.wav", enroll_wav, "audio/wav")},
        )
        assert r.status_code == 201

    # Helper to patch STT + Aletheia + Eidos cleanly per test scenario (no real Whisper model download needed in CI)
    from app.services.aletheia_service import AletheiaService
    from app.services.eidos_service import EidosService
    from app.services.transcription_service import TranscriptionService

    state = {
        "stt_matched": True,
        "aletheia": "REAL",
        "eidos": "MATCH",
    }

    def fake_verify_challenge(self, *, audio_path: Path, expected_phrase: str) -> ChallengeTranscriptionResult:
        return ChallengeTranscriptionResult(
            provider="faster_whisper_test_stub",
            status="COMPLETED",
            matched=state["stt_matched"],
            normalized_result="MATCH" if state["stt_matched"] else "MISMATCH",
            transcript=expected_phrase if state["stt_matched"] else "wrong spoken words",
            normalized_expected=expected_phrase.lower(),
            normalized_transcript=expected_phrase.lower() if state["stt_matched"] else "wrong spoken words",
            match_ratio=1.0 if state["stt_matched"] else 0.0,
        )

    async def fake_check_audio(self, *, file_path: Path, duration_seconds: Optional[float] = None, idempotency_key=None):
        if state["aletheia"] == "TIMEOUT":
            return NormalizedAletheiaResult(
                provider="detectif_aletheia",
                provider_mode="LIVE_PROVIDER_CHECK",
                status="FAILED",
                normalized_result="PROVIDER_ERROR",
                error_code="inference_timeout",
                error_message="Provider timeout",
            )
        is_fake = state["aletheia"] == "FAKE"
        return NormalizedAletheiaResult(
            provider="detectif_aletheia",
            provider_mode="LIVE_PROVIDER_CHECK",
            status="COMPLETED",
            normalized_result="FAKE" if is_fake else "REAL",
            verdict="fake" if is_fake else "real",
            score=0.95 if is_fake else 0.04,
            operation_id="op_test_aletheia",
        )

    async def fake_verify_speaker(self, *, speaker_id: str, file_path: Path, duration_seconds: Optional[float] = None, idempotency_key=None):
        is_match = state["eidos"] == "MATCH"
        return NormalizedEidosVerifyResult(
            provider="detectif_eidos",
            provider_mode="LIVE_PROVIDER_CHECK",
            status="COMPLETED",
            normalized_result="MATCH" if is_match else "NO_MATCH",
            decision="match" if is_match else "no_match",
            similarity=0.78 if is_match else -0.15,
            speaker_id=speaker_id,
            operation_id="op_test_eidos",
        )

    monkeypatch.setattr(TranscriptionService, "verify_challenge", fake_verify_challenge)
    monkeypatch.setattr(AletheiaService, "check_audio", fake_check_audio)
    monkeypatch.setattr(EidosService, "verify_speaker", fake_verify_speaker)

    verify_wav = make_wav_bytes(4.5)

    # 1. Genuine customer SIM replacement -> PASS -> Telecom executes -> Replay blocked
    s1 = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "requested_action": "sim_replacement",
            "resource_reference": "SIM-SWAP-101",
        },
    ).json()
    c1 = client.post(f"/api/sessions/{s1['id']}/challenge", headers=auth_headers(admin_token)).json()
    v1 = client.post(
        f"/api/sessions/{s1['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c1["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    )
    assert v1.status_code == 200, v1.text
    v1_json = v1.json()
    assert v1_json["decision"]["outcome"] == "PASS"
    sim_token = v1_json["authorization_token"]
    assert sim_token.startswith("vl_tok_")

    # Cannot execute with wrong action or wrong resource or wrong tenant
    wrong_act = client.post(
        "/api/workflows/telecom/execute",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "action": "billing_inquiry",
            "resource_reference": "SIM-SWAP-101",
            "authorization_token": sim_token,
        },
    )
    assert wrong_act.status_code == 403
    assert wrong_act.json()["error"]["code"] == "token_action_mismatch"

    wrong_res = client.post(
        "/api/workflows/telecom/execute",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "action": "sim_replacement",
            "resource_reference": "SIM-SWAP-999",
            "authorization_token": sim_token,
        },
    )
    assert wrong_res.status_code == 403
    assert wrong_res.json()["error"]["code"] == "token_resource_mismatch"

    # Correct execution succeeds
    exec_ok = client.post(
        "/api/workflows/telecom/execute",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "action": "sim_replacement",
            "resource_reference": "SIM-SWAP-101",
            "authorization_token": sim_token,
        },
    )
    assert exec_ok.status_code == 201

    # Reusing the same token MUST fail (409)
    replay_tok = client.post(
        "/api/workflows/telecom/execute",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "action": "sim_replacement",
            "resource_reference": "SIM-SWAP-101",
            "authorization_token": sim_token,
        },
    )
    assert replay_tok.status_code == 409
    assert replay_tok.json()["error"]["code"] == "token_already_consumed"

    # Reusing the same challenge in a new verification attempt MUST fail
    # (Try verifying session s1 again -> already evaluated 409)
    assert (
        client.post(
            f"/api/sessions/{s1['id']}/verify",
            headers=auth_headers(admin_token),
            data={"challenge_id": c1["id"]},
            files={"file": ("verify.wav", verify_wav, "audio/wav")},
        ).status_code
        == 409
    )

    # 2. Impersonator attempts SIM replacement -> REJECT
    state["eidos"] = "NO_MATCH"
    s2 = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "requested_action": "sim_replacement",
            "resource_reference": "SIM-SWAP-102",
        },
    ).json()
    c2 = client.post(f"/api/sessions/{s2['id']}/challenge", headers=auth_headers(admin_token)).json()
    v2 = client.post(
        f"/api/sessions/{s2['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c2["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    assert v2["decision"]["outcome"] == "REJECT"
    assert v2["authorization_token"] is None

    # 3 & 4. Employee requests MFA reset (PASS) vs different speaker attempts MFA reset (REJECT)
    state["eidos"] = "MATCH"
    s3 = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": enterprise.id,
            "user_id": emp_ent.id,
            "requested_action": "mfa_reset",
            "resource_reference": "INC-5001",
        },
    ).json()
    c3 = client.post(f"/api/sessions/{s3['id']}/challenge", headers=auth_headers(admin_token)).json()
    v3 = client.post(
        f"/api/sessions/{s3['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c3["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    assert v3["decision"]["outcome"] == "PASS"
    mfa_tok = v3["authorization_token"]
    # Execute Helpdesk MFA reset
    exec_mfa = client.post(
        "/api/workflows/helpdesk/execute",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": enterprise.id,
            "user_id": emp_ent.id,
            "action": "mfa_reset",
            "resource_reference": "INC-5001",
            "authorization_token": mfa_tok,
        },
    )
    assert exec_mfa.status_code == 201

    state["eidos"] = "NO_MATCH"
    s4 = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": enterprise.id,
            "user_id": emp_ent.id,
            "requested_action": "mfa_reset",
            "resource_reference": "INC-5002",
        },
    ).json()
    c4 = client.post(f"/api/sessions/{s4['id']}/challenge", headers=auth_headers(admin_token)).json()
    v4 = client.post(
        f"/api/sessions/{s4['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c4["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    assert v4["decision"]["outcome"] == "REJECT"

    # 5. Banking account change request
    state["eidos"] = "MATCH"
    s5 = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": bank.id,
            "user_id": cust_bnk.id,
            "requested_action": "change_registered_phone",
            "resource_reference": "BNK-PHN-77",
        },
    ).json()
    c5 = client.post(f"/api/sessions/{s5['id']}/challenge", headers=auth_headers(admin_token)).json()
    v5 = client.post(
        f"/api/sessions/{s5['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c5["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    assert v5["decision"]["outcome"] == "PASS"
    assert (
        client.post(
            "/api/workflows/banking/execute",
            headers=auth_headers(admin_token),
            json={
                "tenant_id": bank.id,
                "user_id": cust_bnk.id,
                "action": "change_registered_phone",
                "resource_reference": "BNK-PHN-77",
                "authorization_token": v5["authorization_token"],
            },
        ).status_code
        == 201
    )

    # 6. Education student confidential record access (PASS) vs student attempting faculty records (REJECT by RBAC)
    s6_ok = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": university.id,
            "user_id": stu_uni.id,
            "requested_action": "view_academic_records",
            "resource_reference": "TRN-2026-01",
        },
    ).json()
    c6_ok = client.post(f"/api/sessions/{s6_ok['id']}/challenge", headers=auth_headers(admin_token)).json()
    v6_ok = client.post(
        f"/api/sessions/{s6_ok['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c6_ok["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    assert v6_ok["decision"]["outcome"] == "PASS"
    assert (
        client.post(
            "/api/workflows/education/execute",
            headers=auth_headers(admin_token),
            json={
                "tenant_id": university.id,
                "user_id": stu_uni.id,
                "action": "view_academic_records",
                "resource_reference": "TRN-2026-01",
                "authorization_token": v6_ok["authorization_token"],
            },
        ).status_code
        == 201
    )

    s6_deny = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": university.id,
            "user_id": stu_uni.id,
            "requested_action": "access_faculty_records",
            "resource_reference": "FAC-PRIV-01",
        },
    ).json()
    c6_deny = client.post(f"/api/sessions/{s6_deny['id']}/challenge", headers=auth_headers(admin_token)).json()
    v6_deny = client.post(
        f"/api/sessions/{s6_deny['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c6_deny["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    assert v6_deny["decision"]["outcome"] == "REJECT"
    assert "ROLE_NOT_PERMITTED_FOR_ACTION" in v6_deny["decision"]["reason_codes"]

    # 7. Provider outage during verification -> REVIEW (never PASS)
    state["aletheia"] = "TIMEOUT"
    s7 = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "requested_action": "sim_replacement",
            "resource_reference": "SIM-OUTAGE-1",
        },
    ).json()
    c7 = client.post(f"/api/sessions/{s7['id']}/challenge", headers=auth_headers(admin_token)).json()
    v7 = client.post(
        f"/api/sessions/{s7['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c7["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    assert v7["decision"]["outcome"] == "REVIEW"
    assert v7["authorization_token"] is None

    # 8. Expired challenge submission -> REJECT
    state["aletheia"] = "REAL"
    s8 = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "requested_action": "sim_replacement",
            "resource_reference": "SIM-EXP-1",
        },
    ).json()
    c8 = client.post(f"/api/sessions/{s8['id']}/challenge", headers=auth_headers(admin_token)).json()
    ch_row = db_session.get(Challenge, c8["id"])
    ch_row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=10)
    db_session.commit()

    v8 = client.post(
        f"/api/sessions/{s8['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c8["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    assert v8["decision"]["outcome"] == "REJECT"
    assert "CHALLENGE_EXPIRED" in v8["decision"]["reason_codes"]

    # Expired token test
    s9 = client.post(
        "/api/sessions",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "requested_action": "sim_replacement",
            "resource_reference": "SIM-TOK-EXP-1",
        },
    ).json()
    c9 = client.post(f"/api/sessions/{s9['id']}/challenge", headers=auth_headers(admin_token)).json()
    v9 = client.post(
        f"/api/sessions/{s9['id']}/verify",
        headers=auth_headers(admin_token),
        data={"challenge_id": c9["id"]},
        files={"file": ("verify.wav", verify_wav, "audio/wav")},
    ).json()
    exp_tok = v9["authorization_token"]
    tok_row = db_session.scalar(
        select(AuthorizationToken).where(AuthorizationToken.token_hash == sha256_hex(exp_tok))
    )
    tok_row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    db_session.commit()

    exp_exec = client.post(
        "/api/workflows/telecom/execute",
        headers=auth_headers(admin_token),
        json={
            "tenant_id": telecom.id,
            "user_id": cust_tel.id,
            "action": "sim_replacement",
            "resource_reference": "SIM-TOK-EXP-1",
            "authorization_token": exp_tok,
        },
    )
    assert exp_exec.status_code == 403
    assert exp_exec.json()["error"]["code"] == "token_expired"


def test_attack_simulator_all_12_scenarios(client: TestClient, db_session: Session) -> None:
    admin_token = login_as(client, "admin@voicelock.demo", "DemoAdmin!2026")
    scenarios = client.get("/api/simulator/scenarios", headers=auth_headers(admin_token)).json()
    assert len(scenarios) == 12

    telecom = db_session.scalar(select(Tenant).where(Tenant.slug == "demo-telecom"))
    cust1 = db_session.scalar(
        select(EndUser).where(EndUser.tenant_id == telecom.id, EndUser.external_reference == "CUST-TEL-001")
    )

    for sc in scenarios:
        res = client.post(
            "/api/simulator/run",
            headers=auth_headers(admin_token),
            json={
                "scenario_id": sc["scenario_id"],
                "tenant_id": telecom.id,
                "user_id": cust1.id,
                "action": "sim_replacement",
            },
        )
        assert res.status_code == 200, res.text
        payload = res.json()
        assert payload["label"] == "SIMULATED TEST SCENARIO"
        assert payload["actual_outcome"] == sc["expected_outcome"]
        if sc["scenario_id"] == "reused_authorization_token":
            assert payload["token_replay_blocked"] is True
