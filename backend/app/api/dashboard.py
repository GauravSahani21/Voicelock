from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator
from app.api.sessions import build_session_detail
from app.database.session import get_db
from app.models.entities import (
    AuditEvent,
    Decision,
    OperatorAccount,
    SpeakerEnrollment,
    Tenant,
    VerificationResult,
    VerificationSession,
)
from app.schemas.gateway import AuditEventOut, SessionDetailOut
from app.services.verification_service import reconcile_expired_sessions

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


class OverviewMetricsOut(BaseModel):
    total_requests: int
    evaluated_requests: int
    pending_requests: int
    expired_or_cancelled_requests: int
    live_workflow_requests: int
    simulated_scenario_requests: int
    approved_requests: int
    rejected_requests: int
    review_requests: int
    step_up_requests: int
    failed_provider_checks: int
    active_enrollments: int
    decision_distribution: Dict[str, int]
    industry_activity: Dict[str, int]
    recent_suspicious_requests: List[SessionDetailOut]
    recent_activity: List[AuditEventOut]
    generated_at: datetime


@router.get("/overview", response_model=OverviewMetricsOut)
def get_dashboard_overview(
    tenant_id: Optional[str] = Query(default=None),
    include_simulated: bool = Query(default=True),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> OverviewMetricsOut:
    scoped_tenant_id: Optional[str] = None
    if operator.role != "platform_admin":
        if tenant_id and tenant_id != operator.tenant_id:
            assert_tenant_access(operator, tenant_id)
        scoped_tenant_id = operator.tenant_id
    elif tenant_id:
        scoped_tenant_id = tenant_id

    reconcile_expired_sessions(db, tenant_id=scoped_tenant_id)

    sess_stmt = select(VerificationSession).order_by(VerificationSession.created_at.desc())
    if scoped_tenant_id:
        sess_stmt = sess_stmt.where(VerificationSession.tenant_id == scoped_tenant_id)
    if not include_simulated:
        sess_stmt = sess_stmt.where(VerificationSession.source_mode != "SIMULATED_TEST_SCENARIO")

    sessions = list(db.scalars(sess_stmt).all())
    session_ids = [s.id for s in sessions]

    tenant_map = {t.id: t for t in db.scalars(select(Tenant)).all()}

    decision_by_session: Dict[str, Decision] = {}
    if session_ids:
        decisions = list(
            db.scalars(select(Decision).where(Decision.session_id.in_(session_ids))).all()
        )
        decision_by_session = {d.session_id: d for d in decisions}

    outcome_counts: Counter[str] = Counter()
    pending_requests = 0
    expired_or_cancelled_requests = 0
    live_workflow_requests = 0
    simulated_scenario_requests = 0

    for s in sessions:
        if s.source_mode == "SIMULATED_TEST_SCENARIO":
            simulated_scenario_requests += 1
        else:
            live_workflow_requests += 1

        if s.status == "HUMAN_APPROVED":
            outcome_counts["PASS"] += 1
        elif s.status == "HUMAN_REJECTED":
            outcome_counts["REJECT"] += 1
        elif s.id in decision_by_session:
            outcome_counts[decision_by_session[s.id].outcome] += 1
        elif s.status in ("CREATED", "CHALLENGE_ISSUED"):
            pending_requests += 1
        else:
            expired_or_cancelled_requests += 1

    evaluated_requests = (
        outcome_counts.get("PASS", 0)
        + outcome_counts.get("REJECT", 0)
        + outcome_counts.get("REVIEW", 0)
        + outcome_counts.get("STEP_UP", 0)
    )

    failed_provider_checks = 0
    if session_ids:
        failed_results = list(
            db.scalars(
                select(VerificationResult).where(
                    VerificationResult.session_id.in_(session_ids),
                    VerificationResult.normalized_result.in_(["PROVIDER_ERROR", "TRANSCRIPTION_ERROR"]),
                )
            ).all()
        )
        failed_provider_checks = len(failed_results)

    enr_stmt = select(SpeakerEnrollment).where(SpeakerEnrollment.enrollment_status == "enrolled")
    if scoped_tenant_id:
        enr_stmt = enr_stmt.where(SpeakerEnrollment.tenant_id == scoped_tenant_id)
    active_enrollments = len({(e.tenant_id, e.user_id) for e in db.scalars(enr_stmt).all()})

    industry_counter = Counter(
        tenant_map[s.tenant_id].industry for s in sessions if s.tenant_id in tenant_map
    )

    suspicious_sessions = [
        s
        for s in sessions
        if s.status in ("REJECTED", "REVIEW_REQUIRED", "STEP_UP_REQUIRED", "HUMAN_REJECTED")
    ][:6]

    audit_stmt = select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(12)
    if scoped_tenant_id:
        audit_stmt = audit_stmt.where(AuditEvent.tenant_id == scoped_tenant_id)
    recent_audit = list(db.scalars(audit_stmt).all())

    return OverviewMetricsOut(
        total_requests=len(sessions),
        evaluated_requests=evaluated_requests,
        pending_requests=pending_requests,
        expired_or_cancelled_requests=expired_or_cancelled_requests,
        live_workflow_requests=live_workflow_requests,
        simulated_scenario_requests=simulated_scenario_requests,
        approved_requests=outcome_counts.get("PASS", 0),
        rejected_requests=outcome_counts.get("REJECT", 0),
        review_requests=outcome_counts.get("REVIEW", 0),
        step_up_requests=outcome_counts.get("STEP_UP", 0),
        failed_provider_checks=failed_provider_checks,
        active_enrollments=active_enrollments,
        decision_distribution={
            "PASS": outcome_counts.get("PASS", 0),
            "STEP_UP": outcome_counts.get("STEP_UP", 0),
            "REVIEW": outcome_counts.get("REVIEW", 0),
            "REJECT": outcome_counts.get("REJECT", 0),
        },
        industry_activity={
            "telecom": industry_counter.get("telecom", 0),
            "helpdesk": industry_counter.get("helpdesk", 0),
            "banking": industry_counter.get("banking", 0),
            "education": industry_counter.get("education", 0),
        },
        recent_suspicious_requests=[build_session_detail(db, s) for s in suspicious_sessions],
        recent_activity=[
            AuditEventOut(
                id=ev.id,
                tenant_id=ev.tenant_id,
                tenant_name=tenant_map[ev.tenant_id].name if ev.tenant_id in tenant_map else None,
                actor_reference=ev.actor_reference,
                session_id=ev.session_id,
                event_type=ev.event_type,
                event_details=ev.event_details,
                created_at=ev.created_at,
            )
            for ev in recent_audit
        ],
        generated_at=datetime.now(timezone.utc),
    )
