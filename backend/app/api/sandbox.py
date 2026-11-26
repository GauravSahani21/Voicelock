from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator, require_roles
from app.api.sessions import build_session_detail
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.middleware.rate_limit import rate_limit
from app.models.entities import (
    AuditEvent,
    Challenge,
    EndUser,
    OperatorAccount,
    SandboxSession,
    SpeakerEnrollment,
    Tenant,
    VerificationResult,
    VerificationSession,
    WebhookDelivery,
)
from app.schemas.gateway import SessionDetailOut, VerifySubmissionResponse
from app.services.audit_service import record_audit_event
from app.services.challenge_service import issue_challenge
from app.services.n8n_service import (
    build_verification_event_payload,
    dispatch_delivery_background,
    enqueue_webhook_event,
)
from app.services.verification_service import (
    create_verification_session,
    execute_verification,
)

router = APIRouter(prefix="/api/sandbox", tags=["Security Sandbox"])


INDUSTRY_ENVIRONMENTS: List[Dict[str, Any]] = [
    {
        "industry": "telecom",
        "industry_name": "Telecom",
        "scenario_id": "telecom_sim_replacement",
        "scenario_name": "SIM Replacement Request",
        "short_description": "A customer contacts telecom support requesting a replacement physical SIM or eSIM.",
        "sensitivity_level": "HIGH",
        "requested_action": "sim_replacement",
        "attempt_summary": "Swap active subscriber SIM to a new device/ICCID",
        "reference_label": "SIM Replacement Request ID",
        "default_resource_prefix": "SIM-REQ",
    },
    {
        "industry": "banking",
        "industry_name": "Banking",
        "scenario_id": "banking_sensitive_modification",
        "scenario_name": "Sensitive Account Modification",
        "short_description": "A customer requests a registered mobile number change, beneficiary addition, or account recovery.",
        "sensitivity_level": "CRITICAL",
        "requested_action": "change_registered_phone",
        "attempt_summary": "Modify registered mobile number on retail bank account",
        "reference_label": "Account Modification Ref",
        "default_resource_prefix": "BNK-MOD",
    },
    {
        "industry": "helpdesk",
        "industry_name": "IT Helpdesk",
        "scenario_id": "helpdesk_mfa_reset",
        "scenario_name": "MFA Reset Request",
        "short_description": "An employee contacts IT helpdesk requesting an urgent multi-factor authentication reset.",
        "sensitivity_level": "HIGH",
        "requested_action": "mfa_reset",
        "attempt_summary": "Reset corporate SSO/MFA authenticator binding",
        "reference_label": "Helpdesk Ticket ID",
        "default_resource_prefix": "IT-MFA",
    },
    {
        "industry": "education",
        "industry_name": "Education",
        "scenario_id": "education_student_record_access",
        "scenario_name": "Restricted Student Record Access",
        "short_description": "A user requests access to restricted student academic or examination records.",
        "sensitivity_level": "MEDIUM",
        "requested_action": "view_academic_records",
        "attempt_summary": "Access restricted student transcript and exam records",
        "reference_label": "Student Record Ref",
        "default_resource_prefix": "EDU-REC",
    },
]

ENV_BY_ID = {e["scenario_id"]: e for e in INDUSTRY_ENVIRONMENTS}


class SandboxUserOption(BaseModel):
    id: str
    name: str
    external_reference: str
    role: str
    enrolled: bool


class SandboxEnvironmentOut(BaseModel):
    industry: str
    industry_name: str
    scenario_id: str
    scenario_name: str
    short_description: str
    sensitivity_level: str
    requested_action: str
    attempt_summary: str
    reference_label: str
    tenant_id: Optional[str]
    tenant_name: Optional[str]
    users: List[SandboxUserOption]


class SandboxCreateRequest(BaseModel):
    industry: str
    scenario_id: Optional[str] = None
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None
    requested_action: Optional[str] = None
    resource_reference: Optional[str] = None
    attack_type: str = "genuine_speaker"
    input_type: str = "microphone"


class SandboxSessionOut(BaseModel):
    id: str
    verification_session_id: str
    tenant_id: str
    tenant_name: str
    user_id: str
    user_name: str
    user_external_reference: str
    industry: str
    scenario_id: str
    scenario_title: str
    requested_action: str
    resource_reference: str
    attack_type: str
    input_type: str
    decision_outcome: Optional[str]
    challenge_valid: Optional[bool]
    aletheia_summary: Optional[str]
    eidos_summary: Optional[str]
    failure_reason: Optional[str]
    audit_event_id: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    verification_session: Optional[SessionDetailOut] = None


class SandboxSessionListOut(BaseModel):
    items: List[SandboxSessionOut]
    total: int
    limit: int
    offset: int


class SandboxOverviewOut(BaseModel):
    total_tests: int
    approved_attempts: int
    rejected_attempts: int
    review_attempts: int
    step_up_attempts: int
    recent_sessions: List[SandboxSessionOut]
    latest_incidents: List[SandboxSessionOut]


class SandboxVerifyResponse(BaseModel):
    sandbox_session: SandboxSessionOut
    verification: VerifySubmissionResponse


def _map_decision_label(outcome: Optional[str]) -> Optional[str]:
    if not outcome:
        return None
    return {
        "PASS": "APPROVED",
        "REJECT": "REJECTED",
        "REVIEW": "REVIEW",
        "STEP_UP": "STEP_UP",
    }.get(outcome, outcome)


def _to_sandbox_out(
    db: Session,
    sb: SandboxSession,
    *,
    include_verification: bool = False,
) -> SandboxSessionOut:
    tenant = db.get(Tenant, sb.tenant_id)
    user = db.get(EndUser, sb.user_id)
    ver_detail: Optional[SessionDetailOut] = None
    if include_verification:
        vs = db.get(VerificationSession, sb.verification_session_id)
        if vs:
            ver_detail = build_session_detail(db, vs)
    return SandboxSessionOut(
        id=sb.id,
        verification_session_id=sb.verification_session_id,
        tenant_id=sb.tenant_id,
        tenant_name=tenant.name if tenant else "Unknown Tenant",
        user_id=sb.user_id,
        user_name=user.name if user else "Unknown User",
        user_external_reference=user.external_reference if user else "unknown",
        industry=sb.industry,
        scenario_id=sb.scenario_id,
        scenario_title=sb.scenario_title,
        requested_action=sb.requested_action,
        resource_reference=sb.resource_reference,
        attack_type=sb.attack_type,
        input_type=sb.input_type,
        decision_outcome=sb.decision_outcome,
        challenge_valid=sb.challenge_valid,
        aletheia_summary=sb.aletheia_summary,
        eidos_summary=sb.eidos_summary,
        failure_reason=sb.failure_reason,
        audit_event_id=sb.audit_event_id,
        created_at=sb.created_at,
        completed_at=sb.completed_at,
        verification_session=ver_detail,
    )


def _scoped_sandbox_query(operator: OperatorAccount, tenant_id: Optional[str] = None):
    stmt = select(SandboxSession).order_by(SandboxSession.created_at.desc())
    if operator.role != "platform_admin":
        if tenant_id and tenant_id != operator.tenant_id:
            assert_tenant_access(operator, tenant_id)
        stmt = stmt.where(SandboxSession.tenant_id == operator.tenant_id)
    elif tenant_id:
        stmt = stmt.where(SandboxSession.tenant_id == tenant_id)
    return stmt


@router.get("/environments", response_model=List[SandboxEnvironmentOut])
def get_sandbox_environments(
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[SandboxEnvironmentOut]:
    tenants = list(db.scalars(select(Tenant).order_by(Tenant.created_at.asc())).all())
    if operator.role != "platform_admin" and operator.tenant_id:
        tenants = [t for t in tenants if t.id == operator.tenant_id]

    tenant_by_industry: Dict[str, Tenant] = {}
    for t in tenants:
        if t.industry not in tenant_by_industry:
            tenant_by_industry[t.industry] = t

    out: List[SandboxEnvironmentOut] = []
    for env in INDUSTRY_ENVIRONMENTS:
        t = tenant_by_industry.get(env["industry"])
        users_out: List[SandboxUserOption] = []
        if t:
            users = list(db.scalars(select(EndUser).where(EndUser.tenant_id == t.id)).all())
            enrolled_ids = {
                e.user_id
                for e in db.scalars(
                    select(SpeakerEnrollment).where(
                        SpeakerEnrollment.tenant_id == t.id,
                        SpeakerEnrollment.enrollment_status == "enrolled",
                    )
                ).all()
            }
            users_out = [
                SandboxUserOption(
                    id=u.id,
                    name=u.name,
                    external_reference=u.external_reference,
                    role=u.role,
                    enrolled=u.id in enrolled_ids,
                )
                for u in users
            ]
        out.append(
            SandboxEnvironmentOut(
                industry=env["industry"],
                industry_name=env["industry_name"],
                scenario_id=env["scenario_id"],
                scenario_name=env["scenario_name"],
                short_description=env["short_description"],
                sensitivity_level=env["sensitivity_level"],
                requested_action=env["requested_action"],
                attempt_summary=env["attempt_summary"],
                reference_label=env["reference_label"],
                tenant_id=t.id if t else None,
                tenant_name=t.name if t else None,
                users=users_out,
            )
        )
    return out


@router.get("/overview", response_model=SandboxOverviewOut)
def get_sandbox_overview(
    tenant_id: Optional[str] = Query(default=None),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> SandboxOverviewOut:
    rows = list(db.scalars(_scoped_sandbox_query(operator, tenant_id)).all())
    approved = sum(1 for r in rows if r.decision_outcome == "APPROVED")
    rejected = sum(1 for r in rows if r.decision_outcome == "REJECTED")
    review = sum(1 for r in rows if r.decision_outcome == "REVIEW")
    step_up = sum(1 for r in rows if r.decision_outcome == "STEP_UP")

    incidents = [r for r in rows if r.decision_outcome in ("REJECTED", "REVIEW")][:6]
    return SandboxOverviewOut(
        total_tests=len(rows),
        approved_attempts=approved,
        rejected_attempts=rejected,
        review_attempts=review,
        step_up_attempts=step_up,
        recent_sessions=[_to_sandbox_out(db, r) for r in rows[:8]],
        latest_incidents=[_to_sandbox_out(db, r) for r in incidents],
    )


@router.get("/sessions", response_model=SandboxSessionListOut)
def list_sandbox_sessions(
    industry: Optional[str] = Query(default=None),
    decision: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> SandboxSessionListOut:
    stmt = _scoped_sandbox_query(operator)
    if industry:
        stmt = stmt.where(SandboxSession.industry == industry.lower().strip())
    if decision:
        stmt = stmt.where(SandboxSession.decision_outcome == decision.upper().strip())

    rows = list(db.scalars(stmt).all())

    if date_from:
        try:
            df = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            if df.tzinfo is None:
                df = df.replace(tzinfo=timezone.utc)
            rows = [r for r in rows if (r.created_at.replace(tzinfo=timezone.utc) if r.created_at.tzinfo is None else r.created_at) >= df]
        except ValueError:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            rows = [r for r in rows if (r.created_at.replace(tzinfo=timezone.utc) if r.created_at.tzinfo is None else r.created_at) <= dt]
        except ValueError:
            pass

    if q and q.strip():
        needle = q.strip().lower()
        filtered: List[SandboxSession] = []
        for r in rows:
            u = db.get(EndUser, r.user_id)
            haystack = " ".join(
                [
                    r.id,
                    r.industry,
                    r.scenario_title,
                    r.requested_action,
                    r.resource_reference,
                    r.attack_type,
                    u.name if u else "",
                    u.external_reference if u else "",
                ]
            ).lower()
            if needle in haystack:
                filtered.append(r)
        rows = filtered

    total = len(rows)
    page = rows[offset : offset + limit]
    return SandboxSessionListOut(
        items=[_to_sandbox_out(db, r) for r in page],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/sessions", response_model=SandboxSessionOut, status_code=status.HTTP_201_CREATED)
def create_sandbox_session(
    payload: SandboxCreateRequest,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> SandboxSessionOut:
    ind = payload.industry.lower().strip()
    env = ENV_BY_ID.get(payload.scenario_id or "") or next(
        (e for e in INDUSTRY_ENVIRONMENTS if e["industry"] == ind), None
    )
    if not env:
        raise VoiceLockError(
            code="unsupported_sandbox_industry",
            message=f"Unsupported sandbox industry '{payload.industry}'.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    tenant: Optional[Tenant] = None
    if payload.tenant_id:
        tenant = db.get(Tenant, payload.tenant_id)
    else:
        tenant = db.scalar(select(Tenant).where(Tenant.industry == ind).order_by(Tenant.created_at.asc()))
    if not tenant:
        raise VoiceLockError(
            code="sandbox_tenant_not_found",
            message=f"No tenant configured for industry '{ind}'.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, tenant.id)

    user: Optional[EndUser] = None
    if payload.user_id:
        user = db.get(EndUser, payload.user_id)
    else:
        user = db.scalar(select(EndUser).where(EndUser.tenant_id == tenant.id).order_by(EndUser.created_at.asc()))
    if not user or user.tenant_id != tenant.id:
        raise VoiceLockError(
            code="sandbox_user_not_found",
            message="Target user not found in sandbox tenant.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    action = payload.requested_action or env["requested_action"]
    ref = payload.resource_reference or f"{env['default_resource_prefix']}-{datetime.now(timezone.utc).strftime('%H%M%S')}"

    ver_session = create_verification_session(
        db,
        tenant=tenant,
        user=user,
        requested_action=action,
        resource_reference=ref,
        actor_reference=operator.email,
        external_request_id=f"SBX-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        request_context={
            "sandbox": True,
            "scenario_id": env["scenario_id"],
            "attack_type": payload.attack_type,
            "input_type": payload.input_type,
        },
        source_mode="SANDBOX",
    )
    issue_challenge(db, session=ver_session, actor_reference=operator.email)

    sandbox_session = SandboxSession(
        verification_session_id=ver_session.id,
        tenant_id=tenant.id,
        user_id=user.id,
        operator_id=operator.id,
        actor_reference=operator.email,
        industry=ind,
        scenario_id=env["scenario_id"],
        scenario_title=env["scenario_name"],
        requested_action=action,
        resource_reference=ref,
        attack_type=payload.attack_type,
        input_type=payload.input_type,
    )
    db.add(sandbox_session)
    db.flush()

    ev = record_audit_event(
        db,
        event_type="sandbox.session_created",
        actor_reference=operator.email,
        tenant_id=tenant.id,
        session_id=ver_session.id,
        details={
            "sandbox_session_id": sandbox_session.id,
            "industry": ind,
            "scenario_id": env["scenario_id"],
            "attack_type": payload.attack_type,
        },
    )
    sandbox_session.audit_event_id = ev.id
    db.commit()
    db.refresh(sandbox_session)

    return _to_sandbox_out(db, sandbox_session, include_verification=True)


@router.get("/sessions/{sandbox_session_id}", response_model=SandboxSessionOut)
def get_sandbox_session(
    sandbox_session_id: str,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> SandboxSessionOut:
    sb = db.get(SandboxSession, sandbox_session_id)
    if not sb:
        raise VoiceLockError(
            code="sandbox_session_not_found",
            message="Sandbox session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, sb.tenant_id)
    return _to_sandbox_out(db, sb, include_verification=True)


@router.post(
    "/sessions/{sandbox_session_id}/verify",
    response_model=SandboxVerifyResponse,
    dependencies=[Depends(rate_limit("sandbox_verify", max_requests=40, window_seconds=60))],
)
async def verify_sandbox_session(
    sandbox_session_id: str,
    challenge_id: str = Form(...),
    attack_type: str = Form(default="genuine_speaker"),
    input_type: str = Form(default="microphone"),
    file: UploadFile = File(...),
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> SandboxVerifyResponse:
    sb = db.get(SandboxSession, sandbox_session_id)
    if not sb:
        raise VoiceLockError(
            code="sandbox_session_not_found",
            message="Sandbox session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, sb.tenant_id)
    ver_session = db.get(VerificationSession, sb.verification_session_id)
    if not ver_session:
        raise VoiceLockError(
            code="session_not_found",
            message="Linked verification session not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    sb.attack_type = attack_type
    sb.input_type = input_type
    db.commit()

    try:
        decision, raw_token, token_expires_at, _ = await execute_verification(
            db,
            session=ver_session,
            challenge_id=challenge_id,
            audio_file=file,
            actor_reference=operator.email,
        )
    except VoiceLockError as exc:
        # Record audio/challenge validation failure on the sandbox session safely
        sb.decision_outcome = "REJECTED"
        sb.failure_reason = f"{exc.code}: {exc.message}"
        sb.completed_at = datetime.now(timezone.utc)
        ev = record_audit_event(
            db,
            event_type="sandbox.verification_failed",
            actor_reference=operator.email,
            tenant_id=sb.tenant_id,
            session_id=ver_session.id,
            details={"sandbox_session_id": sb.id, "error_code": exc.code, "message": exc.message},
            commit=True,
        )
        sb.audit_event_id = ev.id
        db.commit()
        raise

    results = list(
        db.scalars(
            select(VerificationResult).where(VerificationResult.session_id == ver_session.id)
        ).all()
    )
    aletheia_res = next((r for r in results if r.check_type == "voice_authenticity"), None)
    eidos_res = next((r for r in results if r.check_type == "speaker_verification"), None)
    challenge_res = next(
        (r for r in results if r.check_type in ("challenge_phrase", "challenge_validation")), None
    )

    latest_audit = db.scalar(
        select(AuditEvent)
        .where(AuditEvent.session_id == ver_session.id)
        .order_by(AuditEvent.created_at.desc())
    )

    sb.decision_outcome = _map_decision_label(decision.outcome)
    sb.challenge_valid = (challenge_res.normalized_result == "MATCH") if challenge_res else None
    sb.aletheia_summary = (
        f"{aletheia_res.normalized_result} ({aletheia_res.provider_mode})"
        if aletheia_res
        else "NOT_REQUIRED"
    )
    sb.eidos_summary = (
        f"{eidos_res.normalized_result} ({eidos_res.provider_mode})"
        if eidos_res
        else "NOT_REQUIRED"
    )
    sb.failure_reason = None if decision.outcome == "PASS" else decision.explanation
    sb.audit_event_id = latest_audit.id if latest_audit else sb.audit_event_id
    sb.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(sb)

    # Emit SANDBOX_SESSION_COMPLETED outbox event for n8n Workflow 5
    try:
        sb_payload = build_verification_event_payload(
            db=db,
            session=ver_session,
            decision=decision,
            event_type="SANDBOX_SESSION_COMPLETED",
            sandbox_session_id=sb.id,
            attack_type=sb.attack_type,
        )
        delivery = enqueue_webhook_event(
            db,
            payload=sb_payload,
            session_id=ver_session.id,
            tenant_id=sb.tenant_id,
            industry=sb.industry,
        )
        db.commit()
        if delivery and delivery.status == "PENDING":
            dispatch_delivery_background(delivery.id)
    except Exception:
        db.rollback()

    detail = build_session_detail(db, ver_session)
    return SandboxVerifyResponse(
        sandbox_session=_to_sandbox_out(db, sb, include_verification=True),
        verification=VerifySubmissionResponse(
            session=detail,
            decision=detail.decision,  # type: ignore[arg-type]
            authorization_token=raw_token,
            token_expires_at=token_expires_at,
            token_summary=detail.token_summary,
        ),
    )


@router.get("/analytics")
def get_sandbox_and_automation_analytics(
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    sb_rows = list(db.scalars(_scoped_sandbox_query(operator)).all())

    deliv_stmt = select(WebhookDelivery).order_by(WebhookDelivery.created_at.desc())
    if operator.role != "platform_admin" and operator.tenant_id:
        deliv_stmt = deliv_stmt.where(
            (WebhookDelivery.tenant_id == operator.tenant_id) | (WebhookDelivery.tenant_id.is_(None))
        )
    deliveries = list(db.scalars(deliv_stmt).all())

    decisions_by_day: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {"APPROVED": 0, "REJECTED": 0, "REVIEW": 0, "STEP_UP": 0}
    )
    attack_dist: Counter[str] = Counter()
    industry_dist: Counter[str] = Counter()
    incidents_by_day: Counter[str] = Counter()

    for r in sb_rows:
        day = r.created_at.strftime("%Y-%m-%d")
        if r.decision_outcome in decisions_by_day[day]:
            decisions_by_day[day][r.decision_outcome] += 1
        attack_dist[r.attack_type] += 1
        industry_dist[r.industry] += 1
        if r.decision_outcome in ("REJECTED", "REVIEW"):
            incidents_by_day[day] += 1

    delivery_status_counts = Counter(d.status for d in deliveries)

    return {
        "summary": {
            "total_sandbox_tests": len(sb_rows),
            "genuine_speaker_attempts": sum(1 for r in sb_rows if r.attack_type == "genuine_speaker"),
            "different_speaker_attempts": sum(1 for r in sb_rows if r.attack_type == "different_speaker"),
            "synthetic_voice_tests": sum(1 for r in sb_rows if r.attack_type == "synthetic_voice"),
            "approved_attempts": sum(1 for r in sb_rows if r.decision_outcome == "APPROVED"),
            "rejected_attempts": sum(1 for r in sb_rows if r.decision_outcome == "REJECTED"),
            "review_decisions": sum(1 for r in sb_rows if r.decision_outcome in ("REVIEW", "STEP_UP")),
            "high_risk_incidents": sum(1 for r in sb_rows if r.decision_outcome == "REJECTED"),
            "automation_notifications": sum(1 for d in deliveries if d.status == "DELIVERED"),
            "failed_webhook_deliveries": sum(1 for d in deliveries if d.status in ("FAILED", "DEAD_LETTER")),
        },
        "decisions_over_time": [
            {"date": day, **counts} for day, counts in sorted(decisions_by_day.items())
        ],
        "attack_scenario_distribution": dict(attack_dist),
        "industry_testing_activity": {
            "telecom": industry_dist.get("telecom", 0),
            "banking": industry_dist.get("banking", 0),
            "helpdesk": industry_dist.get("helpdesk", 0),
            "education": industry_dist.get("education", 0),
        },
        "incident_trends": [
            {"date": day, "incidents": count} for day, count in sorted(incidents_by_day.items())
        ],
        "automation_execution_status": {
            "DELIVERED": delivery_status_counts.get("DELIVERED", 0),
            "PENDING": delivery_status_counts.get("PENDING", 0),
            "FAILED": delivery_status_counts.get("FAILED", 0) + delivery_status_counts.get("DEAD_LETTER", 0),
            "SKIPPED_DISABLED": delivery_status_counts.get("SKIPPED_DISABLED", 0),
        },
    }
