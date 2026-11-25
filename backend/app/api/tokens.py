from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator, require_roles
from app.database.session import get_db
from app.middleware.rate_limit import rate_limit
from app.models.entities import OperatorAccount
from app.schemas.gateway import TokenConsumeResponse, TokenValidateRequest, TokenValidateResponse
from app.services.authorization_service import consume_authorization_token, validate_authorization_token

router = APIRouter(prefix="/api/tokens", tags=["Authorization Tokens"])


@router.post("/validate", response_model=TokenValidateResponse)
def validate_token(
    payload: TokenValidateRequest,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> TokenValidateResponse:
    assert_tenant_access(operator, payload.tenant_id)
    res = validate_authorization_token(
        db,
        raw_token=payload.token,
        tenant_id=payload.tenant_id,
        user_id=payload.user_id,
        action=payload.action,
        resource_reference=payload.resource_reference,
    )
    return TokenValidateResponse(
        valid=res.valid,
        status=res.status,
        reason_code=res.reason_code,
        message=res.message,
        token_id=res.token_record.id if res.token_record else None,
        session_id=res.token_record.session_id if res.token_record else None,
        expires_at=res.token_record.expires_at if res.token_record else None,
    )


@router.post(
    "/consume",
    response_model=TokenConsumeResponse,
    dependencies=[Depends(rate_limit("token_consume", max_requests=60, window_seconds=60))],
)
def consume_token(
    payload: TokenValidateRequest,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> TokenConsumeResponse:
    assert_tenant_access(operator, payload.tenant_id)
    rec = consume_authorization_token(
        db,
        raw_token=payload.token,
        tenant_id=payload.tenant_id,
        user_id=payload.user_id,
        action=payload.action,
        resource_reference=payload.resource_reference,
        actor_reference=operator.email,
    )
    return TokenConsumeResponse(
        consumed=True,
        token_id=rec.id,
        session_id=rec.session_id,
        action=rec.action,
        resource_reference=rec.resource_reference,
        status=rec.status,
        consumed_at=rec.consumed_at,  # type: ignore[arg-type]
    )
