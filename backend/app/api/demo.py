from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.auth import _to_operator_profile
from app.api.deps import get_current_operator, require_roles
from app.core.config import Settings, get_settings
from app.core.errors import VoiceLockError
from app.core.security import create_access_token
from app.database.seed import DEMO_TENANTS, seed_demo_data
from app.database.session import get_db
from app.middleware.rate_limit import rate_limit
from app.models.entities import (
    AuditEvent,
    AuthorizationToken,
    Challenge,
    Decision,
    EndUser,
    IndustryActionRecord,
    OperatorAccount,
    SandboxSession,
    SpeakerEnrollment,
    Tenant,
    VerificationResult,
    VerificationSession,
    WebhookDelivery,
)
from app.schemas.auth import LoginResponse
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/api/demo", tags=["Demo Experience"])

DEMO_SLUGS = [t["slug"] for t in DEMO_TENANTS]


class DemoPortalSummary(BaseModel):
    tenant_id: str
    slug: str
    name: str
    industry: str
    enrolled_users: int
    total_users: int


class DemoOverviewState(BaseModel):
    demo_enabled: bool
    provider_mode: str
    portals: List[DemoPortalSummary]


class DemoBootstrapRequest(BaseModel):
    role_mode: str = "admin"  # admin | telecom | helpdesk | banking | education


class DemoResetRequest(BaseModel):
    clear_enrollments: bool = False


class DemoResetResponse(BaseModel):
    status: str
    sessions_cleared: int
    enrollments_cleared: int
    tenants_seeded: int


def _assert_demo_allowed(settings: Settings) -> None:
    if settings.app_env.lower() == "production":
        raise VoiceLockError(
            code="demo_disabled_in_production",
            message="Demo bootstrap/reset endpoints are disabled in production mode.",
            status_code=status.HTTP_403_FORBIDDEN,
        )


@router.get("/overview-state", response_model=DemoOverviewState)
def get_demo_overview_state(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> DemoOverviewState:
    """Non-sensitive demo readiness summary for the VoiceLock Secure Access Demo landing page."""
    _assert_demo_allowed(settings)
    tenants = list(
        db.scalars(select(Tenant).where(Tenant.slug.in_(DEMO_SLUGS)).order_by(Tenant.created_at.asc())).all()
    )
    summaries: List[DemoPortalSummary] = []
    for t in tenants:
        users = list(db.scalars(select(EndUser).where(EndUser.tenant_id == t.id)).all())
        enrolled = list(
            db.scalars(
                select(SpeakerEnrollment).where(
                    SpeakerEnrollment.tenant_id == t.id,
                    SpeakerEnrollment.enrollment_status == "enrolled",
                )
            ).all()
        )
        enrolled_user_ids = {e.user_id for e in enrolled}
        summaries.append(
            DemoPortalSummary(
                tenant_id=t.id,
                slug=t.slug,
                name=t.name,
                industry=t.industry,
                enrolled_users=len(enrolled_user_ids),
                total_users=len(users),
            )
        )
    return DemoOverviewState(
        demo_enabled=True,
        provider_mode=settings.active_provider_mode,
        portals=summaries,
    )


@router.post(
    "/bootstrap",
    response_model=LoginResponse,
    dependencies=[Depends(rate_limit("demo_bootstrap", max_requests=40, window_seconds=60))],
)
def bootstrap_demo_session(
    payload: DemoBootstrapRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    """
    Issue a real JWT scoped strictly to designated fictional demo accounts so judges can
    explore portals seamlessly without copying credentials from a terminal.
    Disabled automatically when APP_ENV=production.
    """
    _assert_demo_allowed(settings)

    email_by_mode = {
        "admin": "admin@voicelock.demo",
        "telecom": "telecom.ops@voicelock.demo",
        "helpdesk": "helpdesk.ops@voicelock.demo",
        "banking": "bank.ops@voicelock.demo",
        "education": "registrar.ops@voicelock.demo",
    }
    target_email = email_by_mode.get(payload.role_mode)
    if not target_email:
        raise VoiceLockError(
            code="invalid_demo_role_mode",
            message="Unsupported demo role mode.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    operator = db.scalar(select(OperatorAccount).where(OperatorAccount.email == target_email))
    if not operator:
        seed_demo_data(db)
        operator = db.scalar(select(OperatorAccount).where(OperatorAccount.email == target_email))

    if not operator or not operator.is_active:
        raise VoiceLockError(
            code="demo_account_unavailable",
            message="Demo operator account unavailable.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    token, _, expires_at = create_access_token(
        subject=operator.id,
        role=operator.role,
        tenant_id=operator.tenant_id,
        email=operator.email,
    )
    record_audit_event(
        db,
        event_type="demo.session_bootstrapped",
        actor_reference=operator.email,
        tenant_id=operator.tenant_id,
        details={"role_mode": payload.role_mode},
        commit=True,
    )
    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        operator=_to_operator_profile(db, operator),
    )


@router.post("/reset", response_model=DemoResetResponse)
def reset_demo_environment(
    payload: DemoResetRequest,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> DemoResetResponse:
    """
    Reset transient demo verification sessions, tokens, executions, and audit logs
    between judge demonstrations without touching real production logic.
    """
    _assert_demo_allowed(settings)

    demo_tenants = list(db.scalars(select(Tenant).where(Tenant.slug.in_(DEMO_SLUGS))).all())
    demo_tenant_ids = [t.id for t in demo_tenants]
    if operator.role != "platform_admin" and operator.tenant_id:
        demo_tenant_ids = [tid for tid in demo_tenant_ids if tid == operator.tenant_id]

    sessions_cleared = 0
    enrollments_cleared = 0

    if demo_tenant_ids:
        demo_session_ids = list(
            db.scalars(
                select(VerificationSession.id).where(VerificationSession.tenant_id.in_(demo_tenant_ids))
            ).all()
        )
        sessions_cleared = len(demo_session_ids)

        db.execute(
            delete(WebhookDelivery).where(WebhookDelivery.tenant_id.in_(demo_tenant_ids))
        )
        db.execute(
            delete(SandboxSession).where(SandboxSession.tenant_id.in_(demo_tenant_ids))
        )
        db.execute(
            delete(IndustryActionRecord).where(IndustryActionRecord.tenant_id.in_(demo_tenant_ids))
        )
        db.execute(
            delete(AuthorizationToken).where(AuthorizationToken.tenant_id.in_(demo_tenant_ids))
        )
        if demo_session_ids:
            db.execute(delete(Decision).where(Decision.session_id.in_(demo_session_ids)))
            db.execute(delete(VerificationResult).where(VerificationResult.session_id.in_(demo_session_ids)))
            db.execute(delete(Challenge).where(Challenge.session_id.in_(demo_session_ids)))
        db.execute(delete(AuditEvent).where(AuditEvent.tenant_id.in_(demo_tenant_ids)))
        db.execute(delete(VerificationSession).where(VerificationSession.tenant_id.in_(demo_tenant_ids)))

        if payload.clear_enrollments:
            enr_res = db.execute(
                delete(SpeakerEnrollment).where(SpeakerEnrollment.tenant_id.in_(demo_tenant_ids))
            )
            enrollments_cleared = enr_res.rowcount or 0

        # Restore clean baseline user metadata for demo tenants
        for t_spec in DEMO_TENANTS:
            tenant = db.scalar(select(Tenant).where(Tenant.slug == t_spec["slug"]))
            if tenant and tenant.id in demo_tenant_ids:
                for u_spec in t_spec["users"]:
                    u = db.scalar(
                        select(EndUser).where(
                            EndUser.tenant_id == tenant.id,
                            EndUser.external_reference == u_spec["external_reference"],
                        )
                    )
                    if u:
                        u.metadata_json = dict(u_spec["metadata_json"])

    seed_summary = seed_demo_data(db)
    record_audit_event(
        db,
        event_type="demo.environment_reset",
        actor_reference=operator.email,
        tenant_id=operator.tenant_id,
        details={
            "sessions_cleared": sessions_cleared,
            "enrollments_cleared": enrollments_cleared,
            "clear_enrollments": payload.clear_enrollments,
        },
        commit=True,
    )
    return DemoResetResponse(
        status="reset_complete",
        sessions_cleared=sessions_cleared,
        enrollments_cleared=enrollments_cleared,
        tenants_seeded=seed_summary["tenants_created"],
    )
