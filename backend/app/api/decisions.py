from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator, require_roles
from app.api.sessions import build_session_detail
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.models.entities import Decision, OperatorAccount, VerificationSession
from app.policies.registry import get_action_policy
from app.schemas.gateway import SessionDetailOut
from app.services.audit_service import record_audit_event
from app.services.authorization_service import issue_authorization_token

router = APIRouter(prefix="/api/decisions", tags=["Decisions"])


class HumanReviewRequest(BaseModel):
    resolution: Literal["APPROVE", "REJECT"]
    reviewer_note: str = Field(min_length=4, max_length=500)


class HumanReviewResponse(BaseModel):
    session: SessionDetailOut
    resolution: str
    authorization_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None


@router.get("", response_model=List[SessionDetailOut])
def list_decisions(
    tenant_id: Optional[str] = Query(default=None),
    outcome: Optional[str] = Query(default=None),
    industry: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[SessionDetailOut]:
    stmt = (
        select(Decision)
        .join(VerificationSession, Decision.session_id == VerificationSession.id)
        .order_by(Decision.created_at.desc())
        .limit(limit)
    )
    if operator.role != "platform_admin":
        if not operator.tenant_id:
            return []
        if tenant_id and tenant_id != operator.tenant_id:
            assert_tenant_access(operator, tenant_id)
        stmt = stmt.where(VerificationSession.tenant_id == operator.tenant_id)
    elif tenant_id:
        stmt = stmt.where(VerificationSession.tenant_id == tenant_id)

    if outcome:
        stmt = stmt.where(Decision.outcome == outcome)

    decisions = list(db.scalars(stmt).all())
    details: List[SessionDetailOut] = []
    for d in decisions:
        sess = db.get(VerificationSession, d.session_id)
        if sess:
            details.append(build_session_detail(db, sess))
    if industry:
        details = [d for d in details if d.industry == industry]
    return details


@router.get("/{decision_id}", response_model=SessionDetailOut)
def get_decision_detail(
    decision_id: str,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> SessionDetailOut:
    decision = db.get(Decision, decision_id)
    if not decision:
        decision = db.scalar(select(Decision).where(Decision.session_id == decision_id))
    if not decision:
        raise VoiceLockError(
            code="decision_not_found",
            message="Decision not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    session = db.get(VerificationSession, decision.session_id)
    if not session:
        raise VoiceLockError(
            code="session_not_found",
            message="Associated verification session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, session.tenant_id)
    return build_session_detail(db, session)


@router.post("/{decision_id}/review", response_model=HumanReviewResponse)
def submit_human_review(
    decision_id: str,
    payload: HumanReviewRequest,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> HumanReviewResponse:
    """Allow an authorized operator to resolve a REVIEW or STEP_UP session with audit logging."""
    decision = db.get(Decision, decision_id) or db.scalar(
        select(Decision).where(Decision.session_id == decision_id)
    )
    if not decision:
        raise VoiceLockError(
            code="decision_not_found",
            message="Decision not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    session = db.get(VerificationSession, decision.session_id)
    if not session:
        raise VoiceLockError(
            code="session_not_found",
            message="Verification session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, session.tenant_id)

    if decision.outcome not in ("REVIEW", "STEP_UP"):
        raise VoiceLockError(
            code="review_not_applicable",
            message=f"Human review override applies only to REVIEW or STEP_UP decisions (got {decision.outcome}).",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    raw_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None

    ctx = dict(session.request_context or {})
    ctx["human_review"] = {
        "resolution": payload.resolution,
        "reviewer": operator.email,
        "note": payload.reviewer_note,
    }
    session.request_context = ctx

    if payload.resolution == "APPROVE":
        session.status = "HUMAN_APPROVED"
        action_policy = get_action_policy(session.policy_id.split("_")[0], session.requested_action)
        raw_token, token_rec = issue_authorization_token(
            db,
            session=session,
            ttl_seconds=action_policy.token_ttl_seconds,
            actor_reference=operator.email,
        )
        token_expires_at = token_rec.expires_at
    else:
        session.status = "HUMAN_REJECTED"

    record_audit_event(
        db,
        event_type=f"decision.human_review_{payload.resolution.lower()}",
        actor_reference=operator.email,
        tenant_id=session.tenant_id,
        session_id=session.id,
        details={
            "decision_id": decision.id,
            "original_outcome": decision.outcome,
            "resolution": payload.resolution,
            "note": payload.reviewer_note,
        },
    )
    db.commit()
    db.refresh(session)

    return HumanReviewResponse(
        session=build_session_detail(db, session),
        resolution=payload.resolution,
        authorization_token=raw_token,
        token_expires_at=token_expires_at,
    )
