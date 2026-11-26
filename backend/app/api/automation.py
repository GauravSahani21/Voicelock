from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, Header, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import extract_bearer_token, get_current_operator, require_roles
from app.core.config import Settings, get_settings
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.models.entities import (
    Decision,
    OperatorAccount,
    SandboxSession,
    Tenant,
    VerificationSession,
    WebhookDelivery,
)
from app.services.audit_service import record_audit_event
from app.services.n8n_service import (
    deliver_webhook_record,
    enqueue_webhook_event,
    is_n8n_enabled,
    set_n8n_enabled,
)

router = APIRouter(prefix="/api/automation", tags=["n8n Automation"])


WORKFLOW_CATALOG: List[Dict[str, str]] = [
    {
        "id": "wf_01_security_incident_alert",
        "filename": "01-security-incident-alert.json",
        "name": "Security Incident Alert",
        "trigger": "Webhook: VOICE_VERIFICATION_COMPLETED (REJECTED or REVIEW)",
        "description": "Validates incoming event, deduplicates by event_id, classifies severity, and dispatches incident alert.",
    },
    {
        "id": "wf_02_high_risk_attempt_alert",
        "filename": "02-high-risk-attempt-alert.json",
        "name": "High-Risk Attempt Alert",
        "trigger": "Webhook: risk_level == HIGH or synthetic/speaker mismatch",
        "description": "Classifies high-risk voice spoofing or mismatch events and notifies security administrators.",
    },
    {
        "id": "wf_03_cross_domain_notification",
        "filename": "03-cross-domain-security-notification.json",
        "name": "Cross-Domain Security Notification",
        "trigger": "Webhook: Suspicious TELECOM event (e.g., SIM_REPLACEMENT REJECTED)",
        "description": "Notification demonstration alerting downstream banking/helpdesk teams of SIM-swap risk. Never blocks or authorizes actions.",
    },
    {
        "id": "wf_04_daily_security_summary",
        "filename": "04-daily-security-summary.json",
        "name": "Daily Security Summary",
        "trigger": "Schedule: Daily 08:00 UTC",
        "description": "Fetches aggregated statistics from authenticated FastAPI /api/automation/reporting/daily and formats a daily report.",
    },
    {
        "id": "wf_05_sandbox_session_completed",
        "filename": "05-sandbox-session-completed.json",
        "name": "Sandbox Session Completed",
        "trigger": "Webhook: SANDBOX_SESSION_COMPLETED",
        "description": "Records concise sandbox test summaries and optionally alerts admins only on suspicious/rejected sandbox tests.",
    },
]


class AutomationToggleRequest(BaseModel):
    enabled: bool


class WebhookDeliveryOut(BaseModel):
    id: str
    event_id: str
    event_type: str
    session_id: Optional[str]
    tenant_id: Optional[str]
    industry: Optional[str]
    target_url: str
    status: str
    attempt_count: int
    max_attempts: int
    http_status: Optional[int]
    last_error: Optional[str]
    payload_json: Dict[str, Any]
    created_at: datetime
    delivered_at: Optional[datetime]


class AutomationStatusOut(BaseModel):
    n8n_enabled: bool
    webhook_configured: bool
    webhook_url_masked: str
    n8n_base_url: str
    connection_status: str  # connected | unreachable | disabled | unconfigured
    total_events_sent: int
    delivered_count: int
    pending_count: int
    failed_count: int
    last_successful_delivery: Optional[datetime]
    last_failed_delivery: Optional[datetime]
    workflows: List[Dict[str, str]]


def _mask_url(url: str) -> str:
    if not url:
        return ""
    if len(url) <= 48:
        return url
    return url[:36] + "..." + url[-10:]


def _to_delivery_out(d: WebhookDelivery) -> WebhookDeliveryOut:
    return WebhookDeliveryOut(
        id=d.id,
        event_id=d.event_id,
        event_type=d.event_type,
        session_id=d.session_id,
        tenant_id=d.tenant_id,
        industry=d.industry,
        target_url=_mask_url(d.target_url),
        status=d.status,
        attempt_count=d.attempt_count,
        max_attempts=d.max_attempts,
        http_status=d.http_status,
        last_error=d.last_error,
        payload_json=d.payload_json,
        created_at=d.created_at,
        delivered_at=d.delivered_at,
    )


async def _probe_n8n_health(settings: Settings, enabled: bool) -> str:
    if not enabled:
        return "disabled"
    if not settings.n8n_webhook_url.strip():
        return "unconfigured"
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(f"{settings.n8n_base_url}/healthz")
            if resp.status_code < 500:
                return "connected"
    except Exception:
        pass
    return "unreachable"


@router.get("/status", response_model=AutomationStatusOut)
async def get_automation_status(
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AutomationStatusOut:
    enabled = is_n8n_enabled(db, settings)
    deliveries = list(db.scalars(select(WebhookDelivery).order_by(WebhookDelivery.created_at.desc())).all())

    delivered = [d for d in deliveries if d.status == "DELIVERED"]
    pending = [d for d in deliveries if d.status == "PENDING"]
    failed = [d for d in deliveries if d.status in ("FAILED", "DEAD_LETTER")]

    conn_status = await _probe_n8n_health(settings, enabled)

    workflows = [
        {
            **wf,
            "integration_note": (
                "Import JSON from automation/n8n/workflows/ into n8n and activate workflow."
                if conn_status != "connected"
                else "Ready for n8n import; FastAPI dispatches signed events to N8N_WEBHOOK_URL."
            ),
        }
        for wf in WORKFLOW_CATALOG
    ]

    return AutomationStatusOut(
        n8n_enabled=enabled,
        webhook_configured=bool(settings.n8n_webhook_url.strip()),
        webhook_url_masked=_mask_url(settings.n8n_webhook_url.strip()),
        n8n_base_url=settings.n8n_base_url,
        connection_status=conn_status,
        total_events_sent=len(deliveries),
        delivered_count=len(delivered),
        pending_count=len(pending),
        failed_count=len(failed),
        last_successful_delivery=delivered[0].delivered_at if delivered else None,
        last_failed_delivery=failed[0].created_at if failed else None,
        workflows=workflows,
    )


@router.post("/toggle", response_model=AutomationStatusOut)
async def toggle_automation(
    payload: AutomationToggleRequest,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AutomationStatusOut:
    set_n8n_enabled(db, enabled=payload.enabled, actor_reference=operator.email)
    return await get_automation_status(operator=operator, db=db, settings=settings)


@router.post("/test-webhook", response_model=WebhookDeliveryOut)
async def test_webhook_connection(
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> WebhookDeliveryOut:
    if not settings.n8n_webhook_url.strip():
        raise VoiceLockError(
            code="n8n_webhook_unconfigured",
            message="N8N_WEBHOOK_URL is not configured in backend environment variables.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    event_id = f"evt_test_{uuid.uuid4().hex[:14]}"
    payload = {
        "event_id": event_id,
        "event_type": "AUTOMATION_TEST_PING",
        "triggered_by": operator.email,
        "risk_level": "LOW",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    delivery = WebhookDelivery(
        event_id=event_id,
        event_type="AUTOMATION_TEST_PING",
        target_url=settings.n8n_webhook_url.strip(),
        payload_json=payload,
        status="PENDING",
        attempt_count=0,
        max_attempts=1,
    )
    db.add(delivery)
    db.flush()
    record_audit_event(
        db,
        event_type="automation.webhook_tested",
        actor_reference=operator.email,
        tenant_id=operator.tenant_id,
        details={"event_id": event_id},
    )
    db.commit()
    db.refresh(delivery)

    updated = await deliver_webhook_record(db, delivery, settings=settings)
    return _to_delivery_out(updated)


@router.get("/deliveries", response_model=List[WebhookDeliveryOut])
def list_deliveries(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[WebhookDeliveryOut]:
    stmt = select(WebhookDelivery).order_by(WebhookDelivery.created_at.desc()).limit(limit)
    if operator.role != "platform_admin" and operator.tenant_id:
        stmt = stmt.where(
            (WebhookDelivery.tenant_id == operator.tenant_id) | (WebhookDelivery.tenant_id.is_(None))
        )
    if status_filter:
        stmt = stmt.where(WebhookDelivery.status == status_filter)
    rows = list(db.scalars(stmt).all())
    return [_to_delivery_out(r) for r in rows]


@router.post("/deliveries/{delivery_id}/retry", response_model=WebhookDeliveryOut)
async def retry_delivery(
    delivery_id: str,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> WebhookDeliveryOut:
    delivery = db.get(WebhookDelivery, delivery_id)
    if not delivery:
        raise VoiceLockError(
            code="delivery_not_found",
            message="Webhook delivery record not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if operator.role != "platform_admin" and delivery.tenant_id and delivery.tenant_id != operator.tenant_id:
        raise VoiceLockError(
            code="forbidden_tenant_access",
            message="Access denied for this webhook delivery.",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    delivery.status = "PENDING"
    delivery.attempt_count = 0
    delivery.max_attempts = max(1, settings.n8n_max_retries)
    delivery.last_error = None
    if not delivery.target_url and settings.n8n_webhook_url.strip():
        delivery.target_url = settings.n8n_webhook_url.strip()
    record_audit_event(
        db,
        event_type="automation.delivery_retried",
        actor_reference=operator.email,
        tenant_id=delivery.tenant_id,
        session_id=delivery.session_id,
        details={"delivery_id": delivery.id, "event_id": delivery.event_id},
    )
    db.commit()
    db.refresh(delivery)

    updated = await deliver_webhook_record(db, delivery, settings=settings)
    return _to_delivery_out(updated)


@router.get("/reporting/daily")
def get_daily_security_summary(
    hours: int = Query(default=24, ge=1, le=168),
    authorization: Optional[str] = Header(default=None),
    x_voicesuraksha_reporting_key: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
    """
    Authenticated reporting endpoint for n8n Workflow 4 (Daily Security Summary).
    Accepts either an operator Bearer JWT or a configured X-VoiceSuraksha-Reporting-Key header.
    """
    authorized = False
    if settings.n8n_reporting_api_key and x_voicesuraksha_reporting_key == settings.n8n_reporting_api_key:
        authorized = True
    elif authorization:
        # Validate JWT via existing operator dependency logic
        _ = extract_bearer_token(authorization)
        _ = get_current_operator(authorization=authorization, db=db)
        authorized = True

    if not authorized:
        raise VoiceLockError(
            code="unauthorized_reporting_access",
            message="Valid operator token or reporting API key is required.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    sessions = list(
        db.scalars(select(VerificationSession).where(VerificationSession.created_at >= cutoff)).all()
    )
    session_ids = [s.id for s in sessions]
    decisions = (
        list(db.scalars(select(Decision).where(Decision.session_id.in_(session_ids))).all())
        if session_ids
        else []
    )
    sandbox_count = len(
        list(db.scalars(select(SandboxSession).where(SandboxSession.created_at >= cutoff)).all())
    )
    deliveries = list(
        db.scalars(select(WebhookDelivery).where(WebhookDelivery.created_at >= cutoff)).all()
    )
    tenants = {t.id: t.industry for t in db.scalars(select(Tenant)).all()}

    approved = sum(1 for d in decisions if d.outcome == "PASS")
    rejected = sum(1 for d in decisions if d.outcome == "REJECT")
    review = sum(1 for d in decisions if d.outcome in ("REVIEW", "STEP_UP"))

    by_industry: Dict[str, int] = {}
    for s in sessions:
        ind = tenants.get(s.tenant_id, "unknown")
        by_industry[ind] = by_industry.get(ind, 0) + 1

    return {
        "window_hours": hours,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_verifications": len(sessions),
        "sandbox_verifications": sandbox_count,
        "approved": approved,
        "rejected": rejected,
        "review": review,
        "high_risk_incidents": rejected,
        "by_industry": by_industry,
        "automation_deliveries": {
            "total": len(deliveries),
            "delivered": sum(1 for d in deliveries if d.status == "DELIVERED"),
            "failed": sum(1 for d in deliveries if d.status in ("FAILED", "DEAD_LETTER")),
        },
    }
