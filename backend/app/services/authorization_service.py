from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import VoiceLockError
from app.core.security import sha256_hex
from app.models.entities import AuthorizationToken, VerificationSession
from app.services.audit_service import record_audit_event


@dataclass
class TokenValidationResult:
    valid: bool
    status: str  # ACTIVE | CONSUMED | EXPIRED | SCOPE_MISMATCH | INVALID
    reason_code: str
    message: str
    token_record: Optional[AuthorizationToken] = None


def issue_authorization_token(
    db: Session,
    *,
    session: VerificationSession,
    ttl_seconds: int,
    actor_reference: str,
) -> tuple[str, AuthorizationToken]:
    """
    Generate a cryptographically secure, single-use, short-lived, action- & resource-bound token.
    Only the SHA-256 hash is stored in the database; the raw token is returned once.
    """
    raw_token = f"vl_tok_{secrets.token_urlsafe(32)}"
    token_hash = sha256_hex(raw_token)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=ttl_seconds)

    record = AuthorizationToken(
        token_hash=token_hash,
        session_id=session.id,
        tenant_id=session.tenant_id,
        user_id=session.user_id,
        action=session.requested_action,
        resource_reference=session.resource_reference,
        status="ACTIVE",
        expires_at=expires_at,
    )
    db.add(record)
    db.flush()

    record_audit_event(
        db,
        event_type="authorization_token.issued",
        actor_reference=actor_reference,
        tenant_id=session.tenant_id,
        session_id=session.id,
        details={
            "token_id": record.id,
            "action": record.action,
            "resource_reference": record.resource_reference,
            "expires_at": expires_at.isoformat(),
        },
    )
    return raw_token, record


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def validate_authorization_token(
    db: Session,
    *,
    raw_token: str,
    tenant_id: str,
    user_id: Optional[str],
    action: str,
    resource_reference: str,
    lock_for_consume: bool = False,
) -> TokenValidationResult:
    token_hash = sha256_hex(raw_token.strip())
    stmt = select(AuthorizationToken).where(AuthorizationToken.token_hash == token_hash)
    if lock_for_consume:
        stmt = stmt.with_for_update()
    record = db.scalar(stmt)

    if not record:
        return TokenValidationResult(
            valid=False,
            status="INVALID",
            reason_code="TOKEN_INVALID",
            message="Authorization token does not exist or is invalid.",
        )

    now = datetime.now(timezone.utc)

    if record.status == "CONSUMED" or record.consumed_at is not None:
        return TokenValidationResult(
            valid=False,
            status="CONSUMED",
            reason_code="TOKEN_ALREADY_CONSUMED",
            message="Authorization token has already been consumed (one-time use enforced).",
            token_record=record,
        )

    if _ensure_utc(record.expires_at) <= now or record.status == "EXPIRED":
        record.status = "EXPIRED"
        db.flush()
        return TokenValidationResult(
            valid=False,
            status="EXPIRED",
            reason_code="TOKEN_EXPIRED",
            message="Authorization token has expired.",
            token_record=record,
        )

    if record.tenant_id != tenant_id:
        return TokenValidationResult(
            valid=False,
            status="SCOPE_MISMATCH",
            reason_code="TOKEN_TENANT_MISMATCH",
            message="Authorization token is bound to a different tenant.",
            token_record=record,
        )

    if user_id and record.user_id != user_id:
        return TokenValidationResult(
            valid=False,
            status="SCOPE_MISMATCH",
            reason_code="TOKEN_USER_MISMATCH",
            message="Authorization token is bound to a different user.",
            token_record=record,
        )

    if record.action != action:
        return TokenValidationResult(
            valid=False,
            status="SCOPE_MISMATCH",
            reason_code="TOKEN_ACTION_MISMATCH",
            message=(
                f"Authorization token is bound to action '{record.action}' and cannot authorize '{action}'."
            ),
            token_record=record,
        )

    if record.resource_reference != resource_reference:
        return TokenValidationResult(
            valid=False,
            status="SCOPE_MISMATCH",
            reason_code="TOKEN_RESOURCE_MISMATCH",
            message=(
                f"Authorization token is bound to resource '{record.resource_reference}' "
                f"and cannot authorize '{resource_reference}'."
            ),
            token_record=record,
        )

    return TokenValidationResult(
        valid=True,
        status="ACTIVE",
        reason_code="TOKEN_VALID",
        message="Authorization token is valid and matches tenant, user, action, and resource.",
        token_record=record,
    )


def consume_authorization_token(
    db: Session,
    *,
    raw_token: str,
    tenant_id: str,
    user_id: Optional[str],
    action: str,
    resource_reference: str,
    actor_reference: str,
) -> AuthorizationToken:
    """Validate and atomically consume a single-use action-bound authorization token."""
    validation = validate_authorization_token(
        db,
        raw_token=raw_token,
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_reference=resource_reference,
        lock_for_consume=True,
    )

    if not validation.valid or not validation.token_record:
        record_audit_event(
            db,
            event_type="authorization_token.rejected",
            actor_reference=actor_reference,
            tenant_id=tenant_id,
            session_id=validation.token_record.session_id if validation.token_record else None,
            details={
                "reason_code": validation.reason_code,
                "requested_action": action,
                "requested_resource": resource_reference,
            },
            commit=True,
        )
        http_status = (
            status.HTTP_409_CONFLICT
            if validation.reason_code == "TOKEN_ALREADY_CONSUMED"
            else status.HTTP_403_FORBIDDEN
        )
        raise VoiceLockError(
            code=validation.reason_code.lower(),
            message=validation.message,
            status_code=http_status,
            details={"status": validation.status},
        )

    token_record = validation.token_record
    token_record.status = "CONSUMED"
    token_record.consumed_at = datetime.now(timezone.utc)
    db.flush()

    record_audit_event(
        db,
        event_type="authorization_token.consumed",
        actor_reference=actor_reference,
        tenant_id=token_record.tenant_id,
        session_id=token_record.session_id,
        details={
            "token_id": token_record.id,
            "action": token_record.action,
            "resource_reference": token_record.resource_reference,
        },
    )
    db.commit()
    db.refresh(token_record)
    return token_record
