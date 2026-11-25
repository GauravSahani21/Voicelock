from __future__ import annotations

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import extract_bearer_token, get_current_operator
from app.core.errors import VoiceLockError
from app.core.security import (
    create_access_token,
    decode_access_token,
    revoke_token_jti,
    verify_password,
)
from app.database.session import get_db
from app.middleware.rate_limit import rate_limit
from app.models.entities import OperatorAccount, Tenant
from app.schemas.auth import LoginRequest, LoginResponse, LogoutResponse, OperatorProfile
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _to_operator_profile(db: Session, operator: OperatorAccount) -> OperatorProfile:
    tenant: Tenant | None = db.get(Tenant, operator.tenant_id) if operator.tenant_id else None
    return OperatorProfile(
        id=operator.id,
        email=operator.email,
        full_name=operator.full_name,
        role=operator.role,
        tenant_id=operator.tenant_id,
        tenant_name=tenant.name if tenant else None,
        tenant_industry=tenant.industry if tenant else None,
        is_active=operator.is_active,
        created_at=operator.created_at,
    )


@router.post(
    "/login",
    response_model=LoginResponse,
    dependencies=[Depends(rate_limit("auth_login", max_requests=30, window_seconds=60))],
)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    operator = db.scalar(
        select(OperatorAccount).where(OperatorAccount.email == payload.email.lower().strip())
    )
    if not operator or not verify_password(payload.password, operator.password_hash):
        record_audit_event(
            db,
            event_type="auth.login_failed",
            actor_reference=payload.email.lower().strip(),
            details={"reason": "invalid_credentials"},
            commit=True,
        )
        raise VoiceLockError(
            code="invalid_credentials",
            message="Invalid email or password.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    if not operator.is_active:
        raise VoiceLockError(
            code="account_disabled",
            message="This operator account is disabled.",
            status_code=status.HTTP_403_FORBIDDEN,
        )

    token, _, expires_at = create_access_token(
        subject=operator.id,
        role=operator.role,
        tenant_id=operator.tenant_id,
        email=operator.email,
    )
    record_audit_event(
        db,
        event_type="auth.login_succeeded",
        actor_reference=operator.email,
        tenant_id=operator.tenant_id,
        details={"role": operator.role},
        commit=True,
    )
    return LoginResponse(
        access_token=token,
        expires_at=expires_at,
        operator=_to_operator_profile(db, operator),
    )


@router.post("/logout", response_model=LogoutResponse)
def logout(
    authorization: str | None = Header(default=None),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> LogoutResponse:
    token = extract_bearer_token(authorization)
    payload = decode_access_token(token)
    jti = payload.get("jti", "")
    revoke_token_jti(jti)
    record_audit_event(
        db,
        event_type="auth.logout",
        actor_reference=operator.email,
        tenant_id=operator.tenant_id,
        commit=True,
    )
    return LogoutResponse()


@router.get("/me", response_model=OperatorProfile)
def get_me(
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> OperatorProfile:
    return _to_operator_profile(db, operator)
