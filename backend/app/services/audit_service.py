from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.entities import AuditEvent


def record_audit_event(
    db: Session,
    *,
    event_type: str,
    actor_reference: str,
    tenant_id: Optional[str] = None,
    session_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    commit: bool = False,
) -> AuditEvent:
    """Append an immutable audit trail event."""
    event = AuditEvent(
        tenant_id=tenant_id,
        actor_reference=actor_reference,
        session_id=session_id,
        event_type=event_type,
        event_details=details or {},
    )
    db.add(event)
    if commit:
        db.commit()
        db.refresh(event)
    else:
        db.flush()
    return event
