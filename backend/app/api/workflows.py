from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator, require_roles
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.models.entities import EndUser, IndustryActionRecord, OperatorAccount, Tenant
from app.policies.registry import get_action_policy
from app.schemas.gateway import IndustryActionRecordOut, IndustryExecuteRequest
from app.services.audit_service import record_audit_event
from app.services.authorization_service import consume_authorization_token

router = APIRouter(prefix="/api/workflows", tags=["Industry Workflows"])


@router.get("/executions", response_model=List[IndustryActionRecordOut])
def list_workflow_executions(
    tenant_id: Optional[str] = Query(default=None),
    industry: Optional[str] = Query(default=None),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[IndustryActionRecordOut]:
    stmt = select(IndustryActionRecord).order_by(IndustryActionRecord.created_at.desc()).limit(100)
    if operator.role != "platform_admin":
        if not operator.tenant_id:
            return []
        if tenant_id and tenant_id != operator.tenant_id:
            assert_tenant_access(operator, tenant_id)
        stmt = stmt.where(IndustryActionRecord.tenant_id == operator.tenant_id)
    elif tenant_id:
        stmt = stmt.where(IndustryActionRecord.tenant_id == tenant_id)

    if industry:
        stmt = stmt.where(IndustryActionRecord.industry == industry)

    rows = list(db.scalars(stmt).all())
    return [
        IndustryActionRecordOut(
            id=r.id,
            tenant_id=r.tenant_id,
            user_id=r.user_id,
            session_id=r.session_id,
            token_id=r.token_id,
            industry=r.industry,
            action=r.action,
            resource_reference=r.resource_reference,
            execution_status=r.execution_status,
            summary=r.summary,
            payload_json=r.payload_json,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/{industry}/execute", response_model=IndustryActionRecordOut, status_code=status.HTTP_201_CREATED)
def execute_protected_industry_action(
    industry: str,
    payload: IndustryExecuteRequest,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> IndustryActionRecordOut:
    """
    Simulated protected industry application endpoint (Telecom, Helpdesk, Banking, Education).
    STRICTLY refuses to execute unless a valid, single-use VoiceLock authorization token
    matching exact tenant, user, action, and resource is validated and consumed server-side,
    AND application-level role permissions (e.g. Education student vs faculty vs admin) pass.
    """
    assert_tenant_access(operator, payload.tenant_id)
    tenant = db.get(Tenant, payload.tenant_id)
    user = db.get(EndUser, payload.user_id)
    if not tenant or not user or user.tenant_id != tenant.id:
        raise VoiceLockError(
            code="user_not_found_in_tenant",
            message="Target user not found in tenant.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if tenant.industry != industry:
        raise VoiceLockError(
            code="industry_tenant_mismatch",
            message=f"Tenant '{tenant.name}' belongs to industry '{tenant.industry}', not '{industry}'.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    try:
        action_policy = get_action_policy(industry, payload.action)
    except KeyError as exc:
        raise VoiceLockError(
            code="unsupported_action",
            message=str(exc),
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from exc

    # Existing application RBAC remains enforced independently of voice authorization
    if action_policy.allowed_user_roles is not None and user.role not in action_policy.allowed_user_roles:
        raise VoiceLockError(
            code="application_role_forbidden",
            message=(
                f"Application RBAC denied: user role '{user.role}' cannot execute "
                f"'{payload.action}' in {industry}."
            ),
            status_code=status.HTTP_403_FORBIDDEN,
        )

    # Validate & atomically consume the single-use action-bound token before executing
    token_record = consume_authorization_token(
        db,
        raw_token=payload.authorization_token,
        tenant_id=tenant.id,
        user_id=user.id,
        action=payload.action,
        resource_reference=payload.resource_reference,
        actor_reference=operator.email,
    )

    summary = _build_execution_summary(industry, payload.action, user.name, payload.resource_reference, payload.operation_payload)
    record = IndustryActionRecord(
        tenant_id=tenant.id,
        user_id=user.id,
        session_id=token_record.session_id,
        token_id=token_record.id,
        industry=industry,
        action=payload.action,
        resource_reference=payload.resource_reference,
        execution_status="EXECUTED",
        summary=summary,
        payload_json={
            "simulated_application": True,
            "operation_payload": payload.operation_payload,
            "user_role": user.role,
        },
    )
    db.add(record)
    db.flush()

    # Update simulated portal entity metadata ONLY after valid token consumption
    from datetime import datetime, timezone

    meta = dict(user.metadata_json or {})
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    if industry == "telecom" and payload.action == "sim_replacement":
        new_iccid = payload.operation_payload.get("new_sim_iccid", "890141032199990001")
        meta["sim_iccid"] = new_iccid
        meta["sim_status"] = "Replacement Provisioned"
        meta["last_sim_update"] = now_iso
        activity = list(meta.get("recent_activity") or [])
        activity.insert(0, {"date": now_iso, "event": f"SIM replacement authorized ({payload.resource_reference})"})
        meta["recent_activity"] = activity[:6]
        user.metadata_json = meta
    elif industry == "helpdesk" and payload.action == "mfa_reset":
        meta["mfa_status"] = "Reset Authorized — Ready for Re-enrollment"
        meta["last_mfa_reset"] = now_iso
        user.metadata_json = meta
    elif payload.action == "change_registered_phone" and payload.operation_payload.get("new_phone"):
        new_phone = str(payload.operation_payload["new_phone"])
        user.phone_reference = new_phone
        meta["masked_phone"] = f"•••-•••-{new_phone[-4:]}" if len(new_phone) >= 4 else new_phone
        user.metadata_json = meta

    record_audit_event(
        db,
        event_type="workflow.action_executed",
        actor_reference=operator.email,
        tenant_id=tenant.id,
        session_id=token_record.session_id,
        details={
            "industry": industry,
            "action": payload.action,
            "resource_reference": payload.resource_reference,
            "execution_id": record.id,
            "token_id": token_record.id,
        },
    )
    db.commit()
    db.refresh(record)

    return IndustryActionRecordOut(
        id=record.id,
        tenant_id=record.tenant_id,
        user_id=record.user_id,
        session_id=record.session_id,
        token_id=record.token_id,
        industry=record.industry,
        action=record.action,
        resource_reference=record.resource_reference,
        execution_status=record.execution_status,
        summary=record.summary,
        payload_json=record.payload_json,
        created_at=record.created_at,
    )


def _build_execution_summary(
    industry: str,
    action: str,
    user_name: str,
    resource_ref: str,
    op_payload: dict,
) -> str:
    if industry == "telecom" and action == "sim_replacement":
        new_iccid = op_payload.get("new_sim_iccid", "890141032199990001")
        return (
            f"[SIMULATED TELECOM] SIM replacement completed for {user_name} "
            f"(Request {resource_ref}). Provisioned new eSIM/SIM {new_iccid}."
        )
    if industry == "helpdesk" and action == "mfa_reset":
        return (
            f"[SIMULATED IT HELPDESK] MFA device reset completed for {user_name} "
            f"(Ticket {resource_ref}). Temporary enrollment link issued."
        )
    if industry == "banking":
        return (
            f"[SIMULATED BANKING] Protected operation '{action}' executed for {user_name} "
            f"(Ref {resource_ref})."
        )
    if industry == "education":
        return (
            f"[SIMULATED UNIVERSITY PORTAL] Operation '{action}' authorized & completed for {user_name} "
            f"(Ref {resource_ref})."
        )
    return f"[SIMULATED {industry.upper()}] Executed '{action}' for {user_name} ({resource_ref})."
