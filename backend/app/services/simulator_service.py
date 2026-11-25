from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import VoiceLockError
from app.models.entities import (
    AuditEvent,
    Challenge,
    Decision,
    EndUser,
    Tenant,
    VerificationResult,
    VerificationSession,
)
from app.policies.registry import get_action_policy, get_policy_for_industry
from app.services.audit_service import record_audit_event
from app.services.authorization_service import (
    consume_authorization_token,
    issue_authorization_token,
)
from app.services.challenge_service import generate_challenge_phrase
from app.services.policy_engine import PolicyEngine, PolicyEvidence


@dataclass(frozen=True)
class SimulatorScenarioDef:
    scenario_id: str
    title: str
    category: str
    description: str
    default_industry: str
    default_action: str
    expected_outcome: str
    expected_security_behavior: str


SCENARIOS: List[SimulatorScenarioDef] = [
    SimulatorScenarioDef(
        scenario_id="genuine_enrolled_speaker",
        title="1. Genuine Enrolled Speaker",
        category="Legitimate Baseline",
        description="Legitimate enrolled caller reads the fresh challenge phrase clearly in natural speech.",
        default_industry="telecom",
        default_action="sim_replacement",
        expected_outcome="PASS",
        expected_security_behavior="Aletheia=REAL, Eidos=MATCH, Challenge=MATCH -> PASS with single-use action-bound token.",
    ),
    SimulatorScenarioDef(
        scenario_id="different_natural_speaker",
        title="2. Different Natural Speaker (Impersonation)",
        category="Human Impersonation",
        description="A live human scammer calls claiming to be the customer and reads the fresh challenge phrase.",
        default_industry="telecom",
        default_action="sim_replacement",
        expected_outcome="REJECT",
        expected_security_behavior="Aletheia=REAL, Challenge=MATCH, Eidos=NO_MATCH -> Policy rejects high-risk SIM replacement (or routes to REVIEW under low-risk actions).",
    ),
    SimulatorScenarioDef(
        scenario_id="synthetic_voice_sample",
        title="3. Synthetic Voice / Deepfake Audio",
        category="AI Voice Cloning",
        description="Attacker injects AI-synthesized / cloned speech matching the target victim's voice.",
        default_industry="telecom",
        default_action="sim_replacement",
        expected_outcome="REJECT",
        expected_security_behavior="Aletheia flags verdict=fake -> Policy immediately REJECTs (SYNTHETIC_VOICE_DETECTED).",
    ),
    SimulatorScenarioDef(
        scenario_id="old_voice_recording",
        title="4. Old Voice Recording Replay",
        category="Audio Replay",
        description="Attacker plays an authentic archived recording of the victim from an earlier call.",
        default_industry="helpdesk",
        default_action="mfa_reset",
        expected_outcome="REJECT",
        expected_security_behavior="Aletheia=REAL, Eidos=MATCH, but old phrase does not match fresh challenge -> REJECT (CHALLENGE_PHRASE_MISMATCH).",
    ),
    SimulatorScenarioDef(
        scenario_id="wrong_challenge_phrase",
        title="5. Wrong Challenge Phrase Spoken",
        category="Challenge Integrity",
        description="Caller submits audio speaking an unrelated sentence instead of the issued challenge phrase.",
        default_industry="banking",
        default_action="add_beneficiary",
        expected_outcome="REJECT",
        expected_security_behavior="Challenge transcription mismatch -> REJECT regardless of speaker match.",
    ),
    SimulatorScenarioDef(
        scenario_id="expired_challenge",
        title="6. Expired Challenge Submission",
        category="Time-Bound Replay",
        description="Audio is submitted after the challenge phrase TTL has expired.",
        default_industry="telecom",
        default_action="sim_replacement",
        expected_outcome="REJECT",
        expected_security_behavior="Server-side TTL check rejects expired challenge without calling AI providers.",
    ),
    SimulatorScenarioDef(
        scenario_id="reused_challenge",
        title="7. Reused Challenge Replay",
        category="Replay Protection",
        description="Attacker attempts to resubmit an already-consumed challenge ID.",
        default_industry="helpdesk",
        default_action="mfa_reset",
        expected_outcome="REJECT",
        expected_security_behavior="Single-use challenge lock blocks second submission (CHALLENGE_REUSED).",
    ),
    SimulatorScenarioDef(
        scenario_id="reused_authorization_token",
        title="8. Reused Authorization Token",
        category="Token Replay",
        description="Valid token is consumed once legitimately, then replayed on a second protected request.",
        default_industry="telecom",
        default_action="sim_replacement",
        expected_outcome="REJECT",
        expected_security_behavior="First consumption succeeds; replay attempt fails server-side with HTTP 409 TOKEN_ALREADY_CONSUMED.",
    ),
    SimulatorScenarioDef(
        scenario_id="provider_timeout",
        title="9. Provider Timeout / Outage",
        category="Fail-Safe Resilience",
        description="Detectif.ai inference API returns 504 inference_timeout during verification.",
        default_industry="telecom",
        default_action="sim_replacement",
        expected_outcome="REVIEW",
        expected_security_behavior="Provider failure NEVER becomes PASS; policy safely routes to human REVIEW.",
    ),
    SimulatorScenarioDef(
        scenario_id="missing_speaker_enrollment",
        title="10. Missing Speaker Enrollment",
        category="Enrollment Coverage",
        description="Caller requests a protected action requiring Eidos verification, but has no enrolled voice profile.",
        default_industry="helpdesk",
        default_action="mfa_reset",
        expected_outcome="STEP_UP",
        expected_security_behavior="Missing Eidos profile triggers STEP_UP requiring alternative out-of-band verification.",
    ),
    SimulatorScenarioDef(
        scenario_id="invalid_audio",
        title="11. Malformed / Invalid Audio Upload",
        category="Input Validation",
        description="Corrupt or silent audio payload is rejected before policy authorization.",
        default_industry="banking",
        default_action="change_registered_phone",
        expected_outcome="REJECT",
        expected_security_behavior="Audio validation rejects malformed/zero-speech input (422 corrupt_audio / silent_audio).",
    ),
    SimulatorScenarioDef(
        scenario_id="conflicting_model_results",
        title="12. Conflicting Model Signals (Fake + Speaker Match)",
        category="Signal Conflict",
        description="Advanced voice clone fools speaker identity (Eidos=MATCH), while Aletheia detects synthetic artifacts (verdict=fake).",
        default_industry="helpdesk",
        default_action="mfa_reset",
        expected_outcome="REJECT",
        expected_security_behavior="Critical synthetic verdict overrides speaker match -> REJECT with CONFLICTING_SIGNALS_SYNTHETIC_WITH_MATCH.",
    ),
]

SCENARIO_MAP: Dict[str, SimulatorScenarioDef] = {s.scenario_id: s for s in SCENARIOS}


def run_simulated_scenario(
    db: Session,
    *,
    scenario_id: str,
    tenant: Tenant,
    user: EndUser,
    action: Optional[str],
    actor_reference: str,
) -> Dict[str, Any]:
    if scenario_id not in SCENARIO_MAP:
        raise VoiceLockError(
            code="unknown_simulator_scenario",
            message=f"Unknown attack scenario '{scenario_id}'.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    scenario = SCENARIO_MAP[scenario_id]
    policy = get_policy_for_industry(tenant.industry)
    selected_action = action if (action and action in policy.actions) else next(iter(policy.actions.keys()))
    action_policy = get_action_policy(tenant.industry, selected_action)

    now = datetime.now(timezone.utc)
    session = VerificationSession(
        tenant_id=tenant.id,
        user_id=user.id,
        external_request_id=f"SIM-{scenario_id.upper()}",
        requested_action=action_policy.action,
        resource_reference=f"SIM-RES-{user.external_reference}",
        policy_id=policy.policy_id,
        policy_version=policy.version,
        source_mode="SIMULATED_TEST_SCENARIO",
        status="CREATED",
        request_context={
            "simulation": True,
            "label": "SIMULATED TEST SCENARIO",
            "scenario_id": scenario_id,
            "scenario_title": scenario.title,
        },
        expires_at=now + timedelta(seconds=300),
    )
    db.add(session)
    db.flush()

    phrase = generate_challenge_phrase()
    challenge_exp = now - timedelta(seconds=30) if scenario_id == "expired_challenge" else now + timedelta(seconds=180)
    challenge = Challenge(
        session_id=session.id,
        challenge_text=phrase,
        status="EXPIRED" if scenario_id == "expired_challenge" else "CONSUMED",
        expires_at=challenge_exp,
        consumed_at=None if scenario_id == "expired_challenge" else now,
    )
    db.add(challenge)
    db.flush()

    record_audit_event(
        db,
        event_type="simulator.scenario_started",
        actor_reference=actor_reference,
        tenant_id=tenant.id,
        session_id=session.id,
        details={"label": "SIMULATED TEST SCENARIO", "scenario_id": scenario_id, "action": selected_action},
    )

    fixture = _build_fixture_evidence(scenario_id, phrase, user.role)
    for row in fixture["results"]:
        db.add(
            VerificationResult(
                session_id=session.id,
                provider=row["provider"],
                provider_mode="SIMULATED_TEST_SCENARIO",
                check_type=row["check_type"],
                normalized_result=row["normalized_result"],
                raw_verdict=row.get("raw_verdict"),
                score_or_similarity=row.get("score_or_similarity"),
                provider_reference=row.get("provider_reference"),
                error_code=row.get("error_code"),
                error_message=row.get("error_message"),
                details_json={"label": "SIMULATED TEST SCENARIO", **row.get("details", {})},
            )
        )

    evaluation = PolicyEngine.evaluate(
        policy=policy,
        action_policy=action_policy,
        evidence=fixture["evidence"],
    )

    extra_replay_note: Optional[str] = None
    token_replay_blocked = False

    status_map = {
        "PASS": "PASSED",
        "STEP_UP": "STEP_UP_REQUIRED",
        "REVIEW": "REVIEW_REQUIRED",
        "REJECT": "REJECTED",
    }
    session.status = status_map[evaluation.outcome]

    decision = Decision(
        session_id=session.id,
        outcome=evaluation.outcome,
        reason_codes=evaluation.reason_codes,
        explanation=evaluation.explanation,
        triggered_rules=evaluation.triggered_rules,
        policy_id=evaluation.policy_id,
        policy_version=evaluation.policy_version,
    )
    db.add(decision)
    db.flush()

    record_audit_event(
        db,
        event_type=f"simulator.decision_{evaluation.outcome.lower()}",
        actor_reference=actor_reference,
        tenant_id=tenant.id,
        session_id=session.id,
        details={
            "label": "SIMULATED TEST SCENARIO",
            "scenario_id": scenario_id,
            "outcome": evaluation.outcome,
            "reason_codes": evaluation.reason_codes,
        },
    )

    if scenario_id == "reused_authorization_token" and evaluation.outcome == "PASS":
        raw_token, _ = issue_authorization_token(
            db,
            session=session,
            ttl_seconds=180,
            actor_reference=actor_reference,
        )
        # First consumption succeeds
        consume_authorization_token(
            db,
            raw_token=raw_token,
            tenant_id=tenant.id,
            user_id=user.id,
            action=selected_action,
            resource_reference=session.resource_reference,
            actor_reference=actor_reference,
        )
        # Second consumption must fail with 409 TOKEN_ALREADY_CONSUMED
        try:
            consume_authorization_token(
                db,
                raw_token=raw_token,
                tenant_id=tenant.id,
                user_id=user.id,
                action=selected_action,
                resource_reference=session.resource_reference,
                actor_reference=actor_reference,
            )
        except VoiceLockError as exc:
            token_replay_blocked = True
            extra_replay_note = (
                f"Initial token consumption succeeded; replay attempt was blocked with "
                f"HTTP {exc.status_code} ({exc.code})."
            )
            decision.outcome = "REJECT"
            decision.reason_codes = ["TOKEN_ALREADY_CONSUMED", "REPLAY_PREVENTED"]
            decision.triggered_rules = [*decision.triggered_rules, "TOKEN_SINGLE_USE_REPLAY_REJECTED"]
            decision.explanation = extra_replay_note
            session.status = "REJECTED"

    db.commit()

    audit_events = list(
        db.scalars(
            select(AuditEvent)
            .where(AuditEvent.session_id == session.id)
            .order_by(AuditEvent.created_at.asc())
        ).all()
    )
    results = list(
        db.scalars(
            select(VerificationResult)
            .where(VerificationResult.session_id == session.id)
            .order_by(VerificationResult.created_at.asc())
        ).all()
    )

    return {
        "label": "SIMULATED TEST SCENARIO",
        "scenario": scenario,
        "session_id": session.id,
        "requested_action": selected_action,
        "industry": tenant.industry,
        "policy_id": evaluation.policy_id,
        "policy_version": evaluation.policy_version,
        "expected_outcome": scenario.expected_outcome,
        "actual_outcome": decision.outcome,
        "reason_codes": decision.reason_codes,
        "triggered_rules": decision.triggered_rules,
        "explanation": decision.explanation,
        "token_replay_blocked": token_replay_blocked,
        "results": results,
        "audit_events": audit_events,
    }


def _build_fixture_evidence(scenario_id: str, phrase: str, user_role: str) -> Dict[str, Any]:
    if scenario_id in ("genuine_enrolled_speaker", "reused_authorization_token"):
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="MATCH",
                aletheia_status="REAL",
                eidos_status="MATCH",
            ),
            "results": [
                {
                    "provider": "faster_whisper",
                    "check_type": "challenge_phrase",
                    "normalized_result": "MATCH",
                    "raw_verdict": "matched",
                    "score_or_similarity": 1.0,
                    "details": {"expected_phrase": phrase, "transcript": phrase, "fixture": True},
                },
                {
                    "provider": "detectif_aletheia",
                    "check_type": "voice_authenticity",
                    "normalized_result": "REAL",
                    "raw_verdict": "real",
                    "score_or_similarity": 0.04,
                    "provider_reference": "sim_aletheia_real",
                    "details": {"fixture": True, "note": "Simulated genuine speech fixture"},
                },
                {
                    "provider": "detectif_eidos",
                    "check_type": "speaker_verification",
                    "normalized_result": "MATCH",
                    "raw_verdict": "match",
                    "score_or_similarity": 0.81,
                    "provider_reference": "sim_eidos_match",
                    "details": {"fixture": True, "note": "Simulated enrolled speaker fixture"},
                },
            ],
        }

    if scenario_id == "different_natural_speaker":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="MATCH",
                aletheia_status="REAL",
                eidos_status="NO_MATCH",
            ),
            "results": [
                {
                    "provider": "faster_whisper",
                    "check_type": "challenge_phrase",
                    "normalized_result": "MATCH",
                    "raw_verdict": "matched",
                    "score_or_similarity": 1.0,
                    "details": {"expected_phrase": phrase, "transcript": phrase, "fixture": True},
                },
                {
                    "provider": "detectif_aletheia",
                    "check_type": "voice_authenticity",
                    "normalized_result": "REAL",
                    "raw_verdict": "real",
                    "score_or_similarity": 0.06,
                    "provider_reference": "sim_aletheia_real",
                    "details": {"fixture": True},
                },
                {
                    "provider": "detectif_eidos",
                    "check_type": "speaker_verification",
                    "normalized_result": "NO_MATCH",
                    "raw_verdict": "no_match",
                    "score_or_similarity": -0.18,
                    "provider_reference": "sim_eidos_nomatch",
                    "details": {"fixture": True, "note": "Different human voice impersonator"},
                },
            ],
        }

    if scenario_id == "synthetic_voice_sample":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="MATCH",
                aletheia_status="FAKE",
                eidos_status="NO_MATCH",
            ),
            "results": [
                {
                    "provider": "faster_whisper",
                    "check_type": "challenge_phrase",
                    "normalized_result": "MATCH",
                    "raw_verdict": "matched",
                    "score_or_similarity": 1.0,
                    "details": {"expected_phrase": phrase, "transcript": phrase, "fixture": True},
                },
                {
                    "provider": "detectif_aletheia",
                    "check_type": "voice_authenticity",
                    "normalized_result": "FAKE",
                    "raw_verdict": "fake",
                    "score_or_similarity": 0.94,
                    "provider_reference": "sim_aletheia_fake",
                    "details": {"fixture": True, "note": "Simulated synthetic TTS voice fixture"},
                },
                {
                    "provider": "detectif_eidos",
                    "check_type": "speaker_verification",
                    "normalized_result": "NO_MATCH",
                    "raw_verdict": "no_match",
                    "score_or_similarity": 0.12,
                    "provider_reference": "sim_eidos_nomatch",
                    "details": {"fixture": True},
                },
            ],
        }

    if scenario_id == "old_voice_recording":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="MISMATCH",
                aletheia_status="REAL",
                eidos_status="MATCH",
            ),
            "results": [
                {
                    "provider": "faster_whisper",
                    "check_type": "challenge_phrase",
                    "normalized_result": "MISMATCH",
                    "raw_verdict": "mismatch",
                    "score_or_similarity": 0.14,
                    "details": {
                        "expected_phrase": phrase,
                        "transcript": "Yes please confirm my account billing address",
                        "fixture": True,
                    },
                },
                {
                    "provider": "detectif_aletheia",
                    "check_type": "voice_authenticity",
                    "normalized_result": "REAL",
                    "raw_verdict": "real",
                    "score_or_similarity": 0.05,
                    "provider_reference": "sim_aletheia_real",
                    "details": {"fixture": True},
                },
                {
                    "provider": "detectif_eidos",
                    "check_type": "speaker_verification",
                    "normalized_result": "MATCH",
                    "raw_verdict": "match",
                    "score_or_similarity": 0.77,
                    "provider_reference": "sim_eidos_match",
                    "details": {"fixture": True},
                },
            ],
        }

    if scenario_id == "wrong_challenge_phrase":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="MISMATCH",
                aletheia_status="REAL",
                eidos_status="MATCH",
            ),
            "results": [
                {
                    "provider": "faster_whisper",
                    "check_type": "challenge_phrase",
                    "normalized_result": "MISMATCH",
                    "raw_verdict": "mismatch",
                    "score_or_similarity": 0.0,
                    "details": {
                        "expected_phrase": phrase,
                        "transcript": "Verify green ocean nine two marble eagle",
                        "fixture": True,
                    },
                }
            ],
        }

    if scenario_id == "expired_challenge":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="EXPIRED",
                aletheia_status="NOT_REQUIRED",
                eidos_status="NOT_REQUIRED",
            ),
            "results": [
                {
                    "provider": "voicelock_challenge",
                    "check_type": "challenge_validation",
                    "normalized_result": "EXPIRED",
                    "raw_verdict": "CHALLENGE_EXPIRED",
                    "error_code": "challenge_expired",
                    "error_message": "Challenge TTL elapsed before submission.",
                    "details": {"fixture": True},
                }
            ],
        }

    if scenario_id == "reused_challenge":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="REUSED",
                aletheia_status="NOT_REQUIRED",
                eidos_status="NOT_REQUIRED",
            ),
            "results": [
                {
                    "provider": "voicelock_challenge",
                    "check_type": "challenge_validation",
                    "normalized_result": "REUSED",
                    "raw_verdict": "CHALLENGE_REUSED",
                    "error_code": "challenge_reused",
                    "error_message": "Challenge was already consumed in an earlier attempt.",
                    "details": {"fixture": True},
                }
            ],
        }

    if scenario_id == "provider_timeout":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="MATCH",
                aletheia_status="PROVIDER_ERROR",
                eidos_status="MATCH",
                aletheia_error_code="inference_timeout",
            ),
            "results": [
                {
                    "provider": "faster_whisper",
                    "check_type": "challenge_phrase",
                    "normalized_result": "MATCH",
                    "raw_verdict": "matched",
                    "score_or_similarity": 1.0,
                    "details": {"expected_phrase": phrase, "transcript": phrase, "fixture": True},
                },
                {
                    "provider": "detectif_aletheia",
                    "check_type": "voice_authenticity",
                    "normalized_result": "PROVIDER_ERROR",
                    "error_code": "inference_timeout",
                    "error_message": "Simulated 504 inference_timeout from Detectif.ai Aletheia.",
                    "details": {"fixture": True},
                },
                {
                    "provider": "detectif_eidos",
                    "check_type": "speaker_verification",
                    "normalized_result": "MATCH",
                    "raw_verdict": "match",
                    "score_or_similarity": 0.72,
                    "provider_reference": "sim_eidos_match",
                    "details": {"fixture": True},
                },
            ],
        }

    if scenario_id == "missing_speaker_enrollment":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="MATCH",
                aletheia_status="REAL",
                eidos_status="ENROLLMENT_MISSING",
            ),
            "results": [
                {
                    "provider": "faster_whisper",
                    "check_type": "challenge_phrase",
                    "normalized_result": "MATCH",
                    "raw_verdict": "matched",
                    "score_or_similarity": 1.0,
                    "details": {"expected_phrase": phrase, "transcript": phrase, "fixture": True},
                },
                {
                    "provider": "detectif_aletheia",
                    "check_type": "voice_authenticity",
                    "normalized_result": "REAL",
                    "raw_verdict": "real",
                    "score_or_similarity": 0.08,
                    "provider_reference": "sim_aletheia_real",
                    "details": {"fixture": True},
                },
                {
                    "provider": "detectif_eidos",
                    "check_type": "speaker_verification",
                    "normalized_result": "ENROLLMENT_MISSING",
                    "raw_verdict": "not_enrolled",
                    "error_code": "enrollment_missing",
                    "error_message": "No enrolled speaker profile found.",
                    "details": {"fixture": True},
                },
            ],
        }

    if scenario_id == "invalid_audio":
        return {
            "evidence": PolicyEvidence(
                user_role=user_role,
                challenge_status="MISMATCH",
                aletheia_status="PROVIDER_ERROR",
                eidos_status="PROVIDER_ERROR",
                aletheia_error_code="corrupt_audio",
                eidos_error_code="corrupt_audio",
            ),
            "results": [
                {
                    "provider": "voicelock_audio_validator",
                    "check_type": "audio_validation",
                    "normalized_result": "FAILED",
                    "error_code": "corrupt_audio",
                    "error_message": "Simulated malformed or zero-duration audio input (HTTP 422).",
                    "details": {"fixture": True},
                }
            ],
        }

    # conflicting_model_results
    return {
        "evidence": PolicyEvidence(
            user_role=user_role,
            challenge_status="MATCH",
            aletheia_status="FAKE",
            eidos_status="MATCH",
        ),
        "results": [
            {
                "provider": "faster_whisper",
                "check_type": "challenge_phrase",
                "normalized_result": "MATCH",
                "raw_verdict": "matched",
                "score_or_similarity": 1.0,
                "details": {"expected_phrase": phrase, "transcript": phrase, "fixture": True},
            },
            {
                "provider": "detectif_aletheia",
                "check_type": "voice_authenticity",
                "normalized_result": "FAKE",
                "raw_verdict": "fake",
                "score_or_similarity": 0.91,
                "provider_reference": "sim_aletheia_fake",
                "details": {"fixture": True},
            },
            {
                "provider": "detectif_eidos",
                "check_type": "speaker_verification",
                "normalized_result": "MATCH",
                "raw_verdict": "match",
                "score_or_similarity": 0.79,
                "provider_reference": "sim_eidos_match",
                "details": {"fixture": True, "note": "Voice clone matched victim timbre, caught by Aletheia"},
            },
        ],
    }
