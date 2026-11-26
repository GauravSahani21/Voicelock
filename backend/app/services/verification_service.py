from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import anyio
from fastapi import UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import VoiceLockError
from app.models.entities import (
    Challenge,
    Decision,
    EndUser,
    SpeakerEnrollment,
    Tenant,
    VerificationResult,
    VerificationSession,
)
from app.policies.registry import get_action_policy, get_policy_for_industry
from app.services.aletheia_service import AletheiaService, NormalizedAletheiaResult
from app.services.audio_service import temporary_audio_upload
from app.services.audit_service import record_audit_event
from app.services.authorization_service import issue_authorization_token
from app.services.challenge_service import validate_and_consume_challenge
from app.services.eidos_service import EidosService, NormalizedEidosVerifyResult
from app.services.policy_engine import PolicyEngine, PolicyEvaluation, PolicyEvidence
from app.services.transcription_service import ChallengeTranscriptionResult, TranscriptionService


def create_verification_session(
    db: Session,
    *,
    tenant: Tenant,
    user: EndUser,
    requested_action: str,
    resource_reference: str,
    actor_reference: str,
    external_request_id: Optional[str] = None,
    request_context: Optional[dict] = None,
    step_up_satisfied: bool = False,
    source_mode: str = "LIVE_WORKFLOW",
) -> VerificationSession:
    try:
        policy = get_policy_for_industry(tenant.industry)
        action_policy = get_action_policy(tenant.industry, requested_action)
    except KeyError as exc:
        raise VoiceLockError(
            code="unsupported_action_or_policy",
            message=str(exc),
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from exc

    now = datetime.now(timezone.utc)
    session_ttl = max(get_settings().challenge_ttl_seconds + 120, 300)

    session = VerificationSession(
        tenant_id=tenant.id,
        user_id=user.id,
        external_request_id=external_request_id,
        requested_action=action_policy.action,
        resource_reference=resource_reference,
        policy_id=policy.policy_id,
        policy_version=policy.version,
        source_mode=source_mode,
        status="CREATED",
        step_up_satisfied=step_up_satisfied,
        request_context=request_context or {},
        expires_at=now + timedelta(seconds=session_ttl),
    )
    db.add(session)
    db.flush()

    record_audit_event(
        db,
        event_type="verification_session.created",
        actor_reference=actor_reference,
        tenant_id=tenant.id,
        session_id=session.id,
        details={
            "user_id": user.id,
            "user_external_reference": user.external_reference,
            "requested_action": session.requested_action,
            "resource_reference": session.resource_reference,
            "policy_id": policy.policy_id,
            "policy_version": policy.version,
            "source_mode": source_mode,
        },
    )
    db.commit()
    db.refresh(session)
    return session


async def execute_verification(
    db: Session,
    *,
    session: VerificationSession,
    challenge_id: str,
    audio_file: UploadFile,
    actor_reference: str,
    aletheia_service: Optional[AletheiaService] = None,
    eidos_service: Optional[EidosService] = None,
    transcription_service: Optional[TranscriptionService] = None,
) -> tuple[Decision, Optional[str], Optional[datetime], Optional[object]]:
    """
    Central verification orchestration:
    1. Validate session & policy
    2. Validate & temporarily store audio (auto-cleaned on exit)
    3. Validate & atomically consume challenge
    4. Run faster-whisper, Aletheia, and Eidos per policy configuration
    5. Normalize results & persist VerificationResult records
    6. Evaluate deterministic PolicyEngine & persist Decision
    7. Issue single-use action-bound AuthorizationToken on PASS
    8. Record comprehensive audit events
    """
    if session.decision is not None:
        raise VoiceLockError(
            code="session_already_evaluated",
            message="This verification session has already produced a decision. Create a new session to re-verify.",
            status_code=status.HTTP_409_CONFLICT,
        )

    tenant = db.get(Tenant, session.tenant_id)
    user = db.get(EndUser, session.user_id)
    if not tenant or not user:
        raise VoiceLockError(
            code="session_context_missing",
            message="Session tenant or user no longer exists.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    now = datetime.now(timezone.utc)
    sess_exp = session.expires_at if session.expires_at.tzinfo else session.expires_at.replace(tzinfo=timezone.utc)
    if sess_exp <= now:
        session.status = "EXPIRED"
        db.commit()
        raise VoiceLockError(
            code="session_expired",
            message="Verification session has expired.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    policy = get_policy_for_industry(tenant.industry)
    action_policy = get_action_policy(tenant.industry, session.requested_action)
    settings = get_settings()

    min_dur = (
        settings.verification_min_duration_seconds
        if action_policy.require_eidos
        else 2.0
    )
    max_dur = (
        settings.verification_max_duration_seconds
        if action_policy.require_eidos
        else 300.0
    )

    aletheia = aletheia_service or AletheiaService()
    eidos = eidos_service or EidosService()
    stt = transcription_service or TranscriptionService()

    with temporary_audio_upload(
        audio_file,
        min_duration_seconds=min_dur,
        max_duration_seconds=max_dur,
    ) as (temp_path, audio_meta):
        record_audit_event(
            db,
            event_type="verification.audio_submitted",
            actor_reference=actor_reference,
            tenant_id=session.tenant_id,
            session_id=session.id,
            details={
                "filename": audio_meta.filename,
                "size_bytes": audio_meta.size_bytes,
                "duration_seconds": audio_meta.duration_seconds,
                "codec": audio_meta.codec,
            },
        )

        # Validate & consume challenge atomically
        challenge_ok, challenge_fail_code, challenge = validate_and_consume_challenge(
            db,
            session=session,
            challenge_id=challenge_id,
            actor_reference=actor_reference,
        )

        if not challenge_ok:
            challenge_status_map = {
                "CHALLENGE_EXPIRED": "EXPIRED",
                "CHALLENGE_REUSED": "REUSED",
                "CHALLENGE_SUPERSEDED": "SUPERSEDED",
            }
            mapped_status = challenge_status_map.get(challenge_fail_code, "EXPIRED")
            db.add(
                VerificationResult(
                    session_id=session.id,
                    provider="voicelock_challenge",
                    provider_mode="SYSTEM_CHECK",
                    check_type="challenge_validation",
                    normalized_result=mapped_status,
                    raw_verdict=challenge_fail_code,
                    details_json={"challenge_id": challenge.id},
                )
            )
            evaluation = PolicyEngine.evaluate(
                policy=policy,
                action_policy=action_policy,
                evidence=PolicyEvidence(
                    user_role=user.role,
                    challenge_status=mapped_status,
                    aletheia_status="NOT_REQUIRED",
                    eidos_status="NOT_REQUIRED",
                    step_up_satisfied=session.step_up_satisfied,
                ),
            )
            return _finalize_decision(
                db=db,
                session=session,
                evaluation=evaluation,
                actor_reference=actor_reference,
            )

        # Check enrollment record if Eidos is required
        active_enrollment: Optional[SpeakerEnrollment] = None
        if action_policy.require_eidos:
            active_enrollment = db.scalar(
                select(SpeakerEnrollment)
                .where(
                    SpeakerEnrollment.tenant_id == session.tenant_id,
                    SpeakerEnrollment.user_id == session.user_id,
                    SpeakerEnrollment.enrollment_status == "enrolled",
                )
                .order_by(SpeakerEnrollment.created_at.desc())
            )

        # Execute STT + Aletheia + Eidos checks concurrently
        stt_task = anyio.to_thread.run_sync(
            lambda: stt.verify_challenge(
                audio_path=temp_path,
                expected_phrase=challenge.challenge_text,
            )
        )

        async def _skip_aletheia() -> Optional[NormalizedAletheiaResult]:
            return None

        async def _skip_eidos() -> Optional[NormalizedEidosVerifyResult]:
            return None

        aletheia_coro = (
            aletheia.check_audio(
                file_path=temp_path,
                duration_seconds=audio_meta.duration_seconds,
            )
            if action_policy.require_aletheia
            else _skip_aletheia()
        )
        eidos_coro = (
            eidos.verify_speaker(
                speaker_id=active_enrollment.provider_speaker_reference,
                file_path=temp_path,
                duration_seconds=audio_meta.duration_seconds,
            )
            if (action_policy.require_eidos and active_enrollment is not None)
            else _skip_eidos()
        )

        stt_res, aletheia_res, eidos_res = await asyncio.gather(
            stt_task, aletheia_coro, eidos_coro
        )

        # Persist STT / Challenge phrase check
        _persist_stt_result(db, session, challenge, stt_res, actor_reference)

        # Persist Aletheia result
        if action_policy.require_aletheia and aletheia_res is not None:
            _persist_aletheia_result(db, session, aletheia_res, actor_reference)
            aletheia_evidence = aletheia_res.normalized_result
            aletheia_err = aletheia_res.error_code
        else:
            aletheia_evidence = "NOT_REQUIRED"
            aletheia_err = None

        # Persist Eidos result (or missing enrollment)
        if action_policy.require_eidos:
            if active_enrollment is None:
                db.add(
                    VerificationResult(
                        session_id=session.id,
                        provider="detectif_eidos",
                        provider_mode="SYSTEM_CHECK",
                        check_type="speaker_verification",
                        normalized_result="ENROLLMENT_MISSING",
                        raw_verdict="not_enrolled",
                        error_code="enrollment_missing",
                        error_message="User does not have an active Eidos voice enrollment.",
                    )
                )
                eidos_evidence = "ENROLLMENT_MISSING"
                eidos_err = "enrollment_missing"
            elif eidos_res is not None:
                _persist_eidos_result(db, session, eidos_res, actor_reference)
                eidos_evidence = eidos_res.normalized_result
                eidos_err = eidos_res.error_code
            else:
                eidos_evidence = "PROVIDER_ERROR"
                eidos_err = "missing_eidos_result"
        else:
            eidos_evidence = "NOT_REQUIRED"
            eidos_err = None

        evaluation = PolicyEngine.evaluate(
            policy=policy,
            action_policy=action_policy,
            evidence=PolicyEvidence(
                user_role=user.role,
                challenge_status=stt_res.normalized_result,
                aletheia_status=aletheia_evidence,
                eidos_status=eidos_evidence,
                step_up_satisfied=session.step_up_satisfied,
                aletheia_error_code=aletheia_err,
                eidos_error_code=eidos_err,
            ),
        )

        return _finalize_decision(
            db=db,
            session=session,
            evaluation=evaluation,
            actor_reference=actor_reference,
        )


def _persist_stt_result(
    db: Session,
    session: VerificationSession,
    challenge: Challenge,
    stt_res: ChallengeTranscriptionResult,
    actor_reference: str,
) -> None:
    db.add(
        VerificationResult(
            session_id=session.id,
            provider=stt_res.provider,
            provider_mode="LOCAL_STT_CHECK",
            check_type="challenge_phrase",
            normalized_result=stt_res.normalized_result,
            raw_verdict="matched" if stt_res.matched else "mismatch",
            score_or_similarity=stt_res.match_ratio,
            error_code=stt_res.error_code,
            error_message=stt_res.error_message,
            details_json={
                "challenge_id": challenge.id,
                "expected_phrase": challenge.challenge_text,
                "transcript": stt_res.transcript,
                "normalized_expected": stt_res.normalized_expected,
                "normalized_transcript": stt_res.normalized_transcript,
                "matched_tokens": stt_res.matched_tokens,
                "missing_tokens": stt_res.missing_tokens,
                "match_ratio": stt_res.match_ratio,
                "language": stt_res.language,
                "disclaimer": stt_res.disclaimer,
            },
        )
    )
    record_audit_event(
        db,
        event_type="verification.challenge_checked",
        actor_reference=actor_reference,
        tenant_id=session.tenant_id,
        session_id=session.id,
        details={
            "result": stt_res.normalized_result,
            "match_ratio": stt_res.match_ratio,
            "error_code": stt_res.error_code,
        },
    )


def _persist_aletheia_result(
    db: Session,
    session: VerificationSession,
    res: NormalizedAletheiaResult,
    actor_reference: str,
) -> None:
    db.add(
        VerificationResult(
            session_id=session.id,
            provider=res.provider,
            provider_mode=res.provider_mode,
            check_type="voice_authenticity",
            normalized_result=res.normalized_result,
            raw_verdict=res.verdict,
            score_or_similarity=res.score,
            provider_reference=res.operation_id or res.request_id,
            error_code=res.error_code,
            error_message=res.error_message,
            details_json={
                "label": res.label,
                "is_synthetic": res.is_synthetic,
                "score_semantics": res.score_semantics,
                "duration_seconds": res.duration_seconds,
                "scored_seconds": res.scored_seconds,
                "segments": res.segments,
                "model_name": res.model_name,
                "model_version": res.model_version,
                "request_id": res.request_id,
                "operation_id": res.operation_id,
                "latency_ms": res.latency_ms,
                **res.raw_metadata,
            },
        )
    )
    record_audit_event(
        db,
        event_type="provider.aletheia_checked",
        actor_reference=actor_reference,
        tenant_id=session.tenant_id,
        session_id=session.id,
        details={
            "provider_mode": res.provider_mode,
            "normalized_result": res.normalized_result,
            "verdict": res.verdict,
            "operation_id": res.operation_id,
            "error_code": res.error_code,
        },
    )


def _persist_eidos_result(
    db: Session,
    session: VerificationSession,
    res: NormalizedEidosVerifyResult,
    actor_reference: str,
) -> None:
    db.add(
        VerificationResult(
            session_id=session.id,
            provider=res.provider,
            provider_mode=res.provider_mode,
            check_type="speaker_verification",
            normalized_result=res.normalized_result,
            raw_verdict=res.decision,
            score_or_similarity=res.similarity,
            provider_reference=res.operation_id or res.request_id,
            error_code=res.error_code,
            error_message=res.error_message,
            details_json={
                "similarity_semantics": res.similarity_semantics,
                "duration_seconds": res.duration_seconds,
                "model_name": res.model_name,
                "model_version": res.model_version,
                "request_id": res.request_id,
                "operation_id": res.operation_id,
                "latency_ms": res.latency_ms,
                **res.raw_metadata,
            },
        )
    )
    record_audit_event(
        db,
        event_type="provider.eidos_checked",
        actor_reference=actor_reference,
        tenant_id=session.tenant_id,
        session_id=session.id,
        details={
            "provider_mode": res.provider_mode,
            "normalized_result": res.normalized_result,
            "decision": res.decision,
            "operation_id": res.operation_id,
            "error_code": res.error_code,
        },
    )


def _finalize_decision(
    *,
    db: Session,
    session: VerificationSession,
    evaluation: PolicyEvaluation,
    actor_reference: str,
):
    status_by_outcome = {
        "PASS": "PASSED",
        "STEP_UP": "STEP_UP_REQUIRED",
        "REVIEW": "REVIEW_REQUIRED",
        "REJECT": "REJECTED",
    }
    session.status = status_by_outcome.get(evaluation.outcome, "REVIEW_REQUIRED")

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
        event_type=f"decision.{evaluation.outcome.lower()}",
        actor_reference=actor_reference,
        tenant_id=session.tenant_id,
        session_id=session.id,
        details={
            "decision_id": decision.id,
            "outcome": decision.outcome,
            "reason_codes": decision.reason_codes,
            "policy_id": decision.policy_id,
            "policy_version": decision.policy_version,
        },
    )

    raw_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    token_record = None
    if evaluation.outcome == "PASS":
        raw_token, token_record = issue_authorization_token(
            db,
            session=session,
            ttl_seconds=evaluation.token_ttl_seconds,
            actor_reference=actor_reference,
        )
        token_expires_at = token_record.expires_at

    db.commit()
    db.refresh(decision)
    db.refresh(session)
    if token_record:
        db.refresh(token_record)

    # Enqueue durable n8n webhook outbox event (never blocks or alters decision)
    try:
        from app.services.n8n_service import (
            build_verification_event_payload,
            dispatch_delivery_background,
            enqueue_webhook_event,
        )

        tenant_obj = db.get(Tenant, session.tenant_id)
        payload = build_verification_event_payload(
            db=db,
            session=session,
            decision=decision,
            event_type="VOICE_VERIFICATION_COMPLETED",
        )
        delivery = enqueue_webhook_event(
            db,
            payload=payload,
            session_id=session.id,
            tenant_id=session.tenant_id,
            industry=tenant_obj.industry if tenant_obj else None,
        )
        db.commit()
        if delivery and delivery.status == "PENDING":
            dispatch_delivery_background(delivery.id)
    except Exception:
        db.rollback()

    return decision, raw_token, token_expires_at, token_record


def reconcile_expired_sessions(db: Session, *, tenant_id: Optional[str] = None) -> int:
    """Transition expired unsubmitted verification sessions and challenges to EXPIRED."""
    now = datetime.now(timezone.utc)
    stmt = select(VerificationSession).where(
        VerificationSession.status.in_(["CREATED", "CHALLENGE_ISSUED"]),
        VerificationSession.expires_at <= now,
    )
    if tenant_id:
        stmt = stmt.where(VerificationSession.tenant_id == tenant_id)
    stale_sessions = list(db.scalars(stmt).all())
    if not stale_sessions:
        return 0

    stale_ids = [s.id for s in stale_sessions]
    for sess in stale_sessions:
        sess.status = "EXPIRED"

    stale_challenges = list(
        db.scalars(
            select(Challenge).where(
                Challenge.session_id.in_(stale_ids),
                Challenge.status == "ISSUED",
            )
        ).all()
    )
    for ch in stale_challenges:
        ch.status = "EXPIRED"

    db.commit()
    return len(stale_sessions)
