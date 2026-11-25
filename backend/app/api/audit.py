from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.models.entities import AuditEvent, OperatorAccount, Tenant
from app.schemas.gateway import AuditEventOut

router = APIRouter(prefix="/api/audit", tags=["Audit Logs"])


def _to_audit_out(db: Session, ev: AuditEvent) -> AuditEventOut:
    tenant = db.get(Tenant, ev.tenant_id) if ev.tenant_id else None
    return AuditEventOut(
        id=ev.id,
        tenant_id=ev.tenant_id,
        tenant_name=tenant.name if tenant else None,
        actor_reference=ev.actor_reference,
        session_id=ev.session_id,
        event_type=ev.event_type,
        event_details=ev.event_details,
        created_at=ev.created_at,
    )


@router.get("", response_model=List[AuditEventOut])
def list_audit_events(
    tenant_id: Optional[str] = Query(default=None),
    session_id: Optional[str] = Query(default=None),
    event_type: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[AuditEventOut]:
    stmt = select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)
    if operator.role != "platform_admin":
        if not operator.tenant_id:
            return []
        if tenant_id and tenant_id != operator.tenant_id:
            assert_tenant_access(operator, tenant_id)
        stmt = stmt.where(AuditEvent.tenant_id == operator.tenant_id)
    elif tenant_id:
        stmt = stmt.where(AuditEvent.tenant_id == tenant_id)

    if session_id:
        stmt = stmt.where(AuditEvent.session_id == session_id)
    if event_type:
        stmt = stmt.where(AuditEvent.event_type.ilike(f"%{event_type}%"))

    events = list(db.scalars(stmt).all())
    return [_to_audit_out(db, ev) for ev in events]


@router.get("/{event_id}", response_model=AuditEventOut)
def get_audit_event(
    event_id: str,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> AuditEventOut:
    ev = db.get(AuditEvent, event_id)
    if not ev:
        raise VoiceLockError(
            code="audit_event_not_found",
            message="Audit event not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if ev.tenant_id:
        assert_tenant_access(operator, ev.tenant_id)
    elif operator.role != "platform_admin":
        raise VoiceLockError(
            code="forbidden_tenant_access",
            message="Access denied for global audit event.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    return _to_audit_out(db, ev)
