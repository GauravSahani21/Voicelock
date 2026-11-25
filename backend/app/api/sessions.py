from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator, require_roles
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.middleware.rate_limit import rate_limit
from app.models.entities import (
    AuthorizationToken,
    Challenge,
    Decision,
    EndUser,
    OperatorAccount,
    Tenant,
    VerificationResult,
    VerificationSession,
)
from app.schemas.gateway import (
    ChallengeOut,
    DecisionOut,
    SessionCreateRequest,
    SessionDetailOut,
    TokenSummaryOut,
    VerificationResultOut,
    VerifySubmissionResponse,
)
from app.services.challenge_service import issue_challenge
from app.services.audit_service import record_audit_event
from app.services.verification_service import (
    create_verification_session,
    execute_verification,
    reconcile_expired_sessions,
)

router = APIRouter(prefix="/api/sessions", tags=["Verification Sessions"])


def build_session_detail(db: Session, session: VerificationSession) -> SessionDetailOut:
    tenant = db.get(Tenant, session.tenant_id)
    user = db.get(EndUser, session.user_id)

    challenges = list(
        db.scalars(
            select(Challenge)
            .where(Challenge.session_id == session.id)
            .order_by(Challenge.created_at.desc())
        ).all()
    )
    latest_challenge = challenges[0] if challenges else None

    results = list(
        db.scalars(
            select(VerificationResult)
            .where(VerificationResult.session_id == session.id)
            .order_by(VerificationResult.created_at.asc())
        ).all()
    )

    decision = db.scalar(select(Decision).where(Decision.session_id == session.id))
    token_rec = db.scalar(
        select(AuthorizationToken)
        .where(AuthorizationToken.session_id == session.id)
        .order_by(AuthorizationToken.created_at.desc())
    )

    return SessionDetailOut(
        id=session.id,
        tenant_id=session.tenant_id,
        tenant_name=tenant.name if tenant else "Unknown Tenant",
        industry=tenant.industry if tenant else "unknown",
        user_id=session.user_id,
        user_name=user.name if user else "Unknown User",
        user_external_reference=user.external_reference if user else "unknown",
        user_role=user.role if user else "unknown",
        external_request_id=session.external_request_id,
        requested_action=session.requested_action,
        resource_reference=session.resource_reference,
        policy_id=session.policy_id,
        policy_version=session.policy_version,
        source_mode=session.source_mode,
        status=session.status,
        step_up_satisfied=session.step_up_satisfied,
        request_context=session.request_context,
        created_at=session.created_at,
        expires_at=session.expires_at,
        latest_challenge=ChallengeOut(
            id=latest_challenge.id,
            session_id=latest_challenge.session_id,
            challenge_text=latest_challenge.challenge_text,
            status=latest_challenge.status,
            created_at=latest_challenge.created_at,
            expires_at=latest_challenge.expires_at,
            consumed_at=latest_challenge.consumed_at,
        )
        if latest_challenge
        else None,
        verification_results=[
            VerificationResultOut(
                id=r.id,
                provider=r.provider,
                provider_mode=r.provider_mode,
                check_type=r.check_type,
                normalized_result=r.normalized_result,
                raw_verdict=r.raw_verdict,
                score_or_similarity=r.score_or_similarity,
                provider_reference=r.provider_reference,
                error_code=r.error_code,
                error_message=r.error_message,
                details_json=r.details_json,
                created_at=r.created_at,
            )
            for r in results
        ],
        decision=DecisionOut(
            id=decision.id,
            session_id=decision.session_id,
            outcome=decision.outcome,
            reason_codes=decision.reason_codes,
            explanation=decision.explanation,
            triggered_rules=decision.triggered_rules,
            policy_id=decision.policy_id,
            policy_version=decision.policy_version,
            created_at=decision.created_at,
        )
        if decision
        else None,
        token_summary=TokenSummaryOut(
            id=token_rec.id,
            session_id=token_rec.session_id,
            tenant_id=token_rec.tenant_id,
            user_id=token_rec.user_id,
            action=token_rec.action,
            resource_reference=token_rec.resource_reference,
            status=token_rec.status,
            created_at=token_rec.created_at,
            expires_at=token_rec.expires_at,
            consumed_at=token_rec.consumed_at,
        )
        if token_rec
        else None,
    )


@router.get("", response_model=List[SessionDetailOut])
def list_sessions(
    tenant_id: Optional[str] = Query(default=None),
    industry: Optional[str] = Query(default=None),
    outcome: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    source_mode: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[SessionDetailOut]:
    stmt = select(VerificationSession).order_by(VerificationSession.created_at.desc()).limit(limit)
    if operator.role != "platform_admin":
        if not operator.tenant_id:
            return []
        if tenant_id and tenant_id != operator.tenant_id:
            assert_tenant_access(operator, tenant_id)
        stmt = stmt.where(VerificationSession.tenant_id == operator.tenant_id)
    elif tenant_id:
        stmt = stmt.where(VerificationSession.tenant_id == tenant_id)

    if action:
        stmt = stmt.where(VerificationSession.requested_action == action)
    if source_mode:
        stmt = stmt.where(VerificationSession.source_mode == source_mode)

    scoped_tid = operator.tenant_id if operator.role != "platform_admin" else tenant_id
    reconcile_expired_sessions(db, tenant_id=scoped_tid)

    sessions = list(db.scalars(stmt).all())
    details = [build_session_detail(db, s) for s in sessions]
    if industry:
        details = [d for d in details if d.industry == industry]
    if outcome:
        details = [d for d in details if d.decision and d.decision.outcome == outcome]
    return details


@router.post("", response_model=SessionDetailOut, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreateRequest,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> SessionDetailOut:
    assert_tenant_access(operator, payload.tenant_id)
    tenant = db.get(Tenant, payload.tenant_id)
    user = db.get(EndUser, payload.user_id)
    if not tenant or not user or user.tenant_id != tenant.id:
        raise VoiceLockError(
            code="user_not_found_in_tenant",
            message="Target user was not found in the specified tenant.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    session = create_verification_session(
        db,
        tenant=tenant,
        user=user,
        requested_action=payload.requested_action,
        resource_reference=payload.resource_reference,
        actor_reference=operator.email,
        external_request_id=payload.external_request_id,
        request_context=payload.request_context,
        step_up_satisfied=payload.step_up_satisfied,
    )
    return build_session_detail(db, session)


@router.get("/{session_id}", response_model=SessionDetailOut)
def get_session(
    session_id: str,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> SessionDetailOut:
    session = db.get(VerificationSession, session_id)
    if not session:
        raise VoiceLockError(
            code="session_not_found",
            message="Verification session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, session.tenant_id)
    reconcile_expired_sessions(db, tenant_id=session.tenant_id)
    db.refresh(session)
    return build_session_detail(db, session)


@router.post("/{session_id}/cancel", response_model=SessionDetailOut)
def cancel_session(
    session_id: str,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> SessionDetailOut:
    session = db.get(VerificationSession, session_id)
    if not session:
        raise VoiceLockError(
            code="session_not_found",
            message="Verification session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, session.tenant_id)

    if session.status in ("CREATED", "CHALLENGE_ISSUED"):
        session.status = "CANCELLED"
        open_challenges = list(
            db.scalars(
                select(Challenge).where(
                    Challenge.session_id == session.id,
                    Challenge.status == "ISSUED",
                )
            ).all()
        )
        for ch in open_challenges:
            ch.status = "EXPIRED"
        record_audit_event(
            db,
            event_type="verification_session.cancelled",
            actor_reference=operator.email,
            tenant_id=session.tenant_id,
            session_id=session.id,
            details={"requested_action": session.requested_action},
        )
        db.commit()
        db.refresh(session)

    return build_session_detail(db, session)


@router.post("/{session_id}/challenge", response_model=ChallengeOut, status_code=status.HTTP_201_CREATED)
def create_session_challenge(
    session_id: str,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> ChallengeOut:
    session = db.get(VerificationSession, session_id)
    if not session:
        raise VoiceLockError(
            code="session_not_found",
            message="Verification session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, session.tenant_id)
    challenge = issue_challenge(db, session=session, actor_reference=operator.email)
    return ChallengeOut(
        id=challenge.id,
        session_id=challenge.session_id,
        challenge_text=challenge.challenge_text,
        status=challenge.status,
        created_at=challenge.created_at,
        expires_at=challenge.expires_at,
        consumed_at=challenge.consumed_at,
    )


@router.post(
    "/{session_id}/verify",
    response_model=VerifySubmissionResponse,
    dependencies=[Depends(rate_limit("verify_audio", max_requests=40, window_seconds=60))],
)
async def verify_session_audio(
    session_id: str,
    challenge_id: str = Form(...),
    file: UploadFile = File(...),
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> VerifySubmissionResponse:
    session = db.get(VerificationSession, session_id)
    if not session:
        raise VoiceLockError(
            code="session_not_found",
            message="Verification session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, session.tenant_id)

    decision, raw_token, token_expires_at, token_rec = await execute_verification(
        db,
        session=session,
        challenge_id=challenge_id,
        audio_file=file,
        actor_reference=operator.email,
    )

    detail = build_session_detail(db, session)
    return VerifySubmissionResponse(
        session=detail,
        decision=detail.decision,  # type: ignore[arg-type]
        authorization_token=raw_token,
        token_expires_at=token_expires_at,
        token_summary=detail.token_summary,
    )


@router.get("/{session_id}/result", response_model=SessionDetailOut)
def get_session_result(
    session_id: str,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> SessionDetailOut:
    session = db.get(VerificationSession, session_id)
    if not session:
        raise VoiceLockError(
            code="session_not_found",
            message="Verification session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, session.tenant_id)
    return build_session_detail(db, session)
