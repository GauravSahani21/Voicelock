from __future__ import annotations

from typing import Callable

import jwt
from fastapi import Depends, Header, status
from sqlalchemy.orm import Session

from app.core.errors import VoiceLockError
from app.core.security import decode_access_token
from app.database.session import get_db
from app.models.entities import OperatorAccount


def extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise VoiceLockError(
            code="missing_authorization",
            message="Authentication is required.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise VoiceLockError(
            code="invalid_authorization_header",
            message="Authorization header must use Bearer token format.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return parts[1].strip()


def get_current_operator(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> OperatorAccount:
    token = extract_bearer_token(authorization)
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise VoiceLockError(
            code="token_expired",
            message="Authentication token has expired.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    except jwt.InvalidTokenError:
        raise VoiceLockError(
            code="invalid_token",
            message="Authentication token is invalid or revoked.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    operator_id = payload.get("sub")
    if not operator_id:
        raise VoiceLockError(
            code="invalid_token",
            message="Authentication token payload is malformed.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    operator = db.get(OperatorAccount, operator_id)
    if not operator or not operator.is_active:
        raise VoiceLockError(
            code="account_disabled",
            message="Operator account not found or inactive.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return operator


def require_roles(*allowed_roles: str) -> Callable[[OperatorAccount], OperatorAccount]:
    def dependency(operator: OperatorAccount = Depends(get_current_operator)) -> OperatorAccount:
        if operator.role not in allowed_roles:
            raise VoiceLockError(
                code="insufficient_role",
                message="Your role is not permitted to perform this action.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return operator

    return dependency


def assert_tenant_access(operator: OperatorAccount, tenant_id: str) -> None:
    """Enforce strict tenant isolation. Platform admins can inspect any tenant; tenant-scoped roles cannot."""
    if operator.role == "platform_admin":
        return
    if not operator.tenant_id or operator.tenant_id != tenant_id:
        raise VoiceLockError(
            code="forbidden_tenant_access",
            message="Access denied for the requested tenant.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
