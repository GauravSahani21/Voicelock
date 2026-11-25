from __future__ import annotations

from datetime import datetime, timezone
import secrets
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator, require_roles
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.models.entities import EndUser, OperatorAccount, SpeakerEnrollment, Tenant
from app.schemas.tenants import EndUserCreate, EndUserOut, TenantCreate, TenantOut
from app.services.audit_service import record_audit_event

router = APIRouter(prefix="/api/tenants", tags=["Tenants & Users"])


@router.get("", response_model=List[TenantOut])
def list_tenants(
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[TenantOut]:
    stmt = select(Tenant).order_by(Tenant.created_at.asc())
    if operator.role != "platform_admin":
        if not operator.tenant_id:
            return []
        stmt = stmt.where(Tenant.id == operator.tenant_id)
    tenants = list(db.scalars(stmt).all())
    return [
        TenantOut(
            id=t.id,
            slug=t.slug,
            name=t.name,
            industry=t.industry,
            status=t.status,
            created_at=t.created_at,
        )
        for t in tenants
    ]


@router.post("", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    operator: OperatorAccount = Depends(require_roles("platform_admin")),
    db: Session = Depends(get_db),
) -> TenantOut:
    existing = db.scalar(select(Tenant).where(Tenant.slug == payload.slug))
    if existing:
        raise VoiceLockError(
            code="tenant_slug_exists",
            message=f"A tenant with slug '{payload.slug}' already exists.",
            status_code=status.HTTP_409_CONFLICT,
        )
    tenant = Tenant(
        slug=payload.slug,
        name=payload.name,
        industry=payload.industry,
        status="active",
    )
    db.add(tenant)
    db.flush()
    record_audit_event(
        db,
        event_type="tenant.created",
        actor_reference=operator.email,
        tenant_id=tenant.id,
        details={"slug": tenant.slug, "industry": tenant.industry},
    )
    db.commit()
    db.refresh(tenant)
    return TenantOut(
        id=tenant.id,
        slug=tenant.slug,
        name=tenant.name,
        industry=tenant.industry,
        status=tenant.status,
        created_at=tenant.created_at,
    )


@router.get("/{tenant_id}", response_model=TenantOut)
def get_tenant(
    tenant_id: str,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> TenantOut:
    assert_tenant_access(operator, tenant_id)
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise VoiceLockError(
            code="tenant_not_found",
            message="Tenant not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return TenantOut(
        id=tenant.id,
        slug=tenant.slug,
        name=tenant.name,
        industry=tenant.industry,
        status=tenant.status,
        created_at=tenant.created_at,
    )


@router.get("/{tenant_id}/users", response_model=List[EndUserOut])
def list_tenant_users(
    tenant_id: str,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[EndUserOut]:
    assert_tenant_access(operator, tenant_id)
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise VoiceLockError(
            code="tenant_not_found",
            message="Tenant not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    users = list(
        db.scalars(
            select(EndUser).where(EndUser.tenant_id == tenant_id).order_by(EndUser.created_at.asc())
        ).all()
    )
    enrollments = list(
        db.scalars(
            select(SpeakerEnrollment)
            .where(SpeakerEnrollment.tenant_id == tenant_id)
            .order_by(SpeakerEnrollment.created_at.desc())
        ).all()
    )
    latest_status_by_user: dict[str, str] = {}
    for enr in enrollments:
        if enr.user_id not in latest_status_by_user:
            latest_status_by_user[enr.user_id] = enr.enrollment_status

    return [
        EndUserOut(
            id=u.id,
            tenant_id=u.tenant_id,
            external_reference=u.external_reference,
            name=u.name,
            email=u.email,
            phone_reference=u.phone_reference,
            role=u.role,
            status=u.status,
            metadata_json=u.metadata_json,
            created_at=u.created_at,
            enrollment_status=latest_status_by_user.get(u.id, "not_enrolled"),
        )
        for u in users
    ]


def _default_user_reference(industry: str, role: str) -> str:
    prefix_map = {
        "telecom": "CUST-TEL",
        "helpdesk": "EMP-ENT",
        "banking": "BNK-CUST",
    }
    if industry == "education":
        prefix = "FAC-UNI" if role == "faculty" else "ADM-UNI" if role == "administrator" else "STU-UNI"
    else:
        prefix = prefix_map.get(industry, "USR")
    return f"{prefix}-{secrets.token_hex(3).upper()}"


def _build_default_user_metadata(
    *,
    industry: str,
    role: str,
    phone_reference: str | None,
    provided_metadata: Dict[str, Any],
) -> Dict[str, Any]:
    meta = dict(provided_metadata or {})
    digits = "".join(ch for ch in (phone_reference or "") if ch.isdigit())
    masked_phone = meta.get("masked_phone") or (
        f"+1 (555) •••-{digits[-4:]}" if len(digits) >= 4 else (phone_reference or "+1 (555) •••-0199")
    )
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if industry == "telecom":
        meta.setdefault("masked_phone", masked_phone)
        meta.setdefault("sim_iccid", f"8901410321{secrets.randbelow(900000000) + 100000000}")
        meta.setdefault("sim_type", "eSIM")
        meta.setdefault("sim_status", "Active")
        meta.setdefault("last_sim_update", today)
        meta.setdefault("registered_device", "Mobile Handset (Verified)")
        meta.setdefault("plan", "5G Unlimited Postpaid")
        meta.setdefault("recent_activity", [{"date": today, "event": "Subscriber account registered"}])
    elif industry == "helpdesk":
        meta.setdefault("masked_phone", masked_phone)
        meta.setdefault("department", "Engineering")
        meta.setdefault("designation", "Team Member" if role == "employee" else role.title())
        meta.setdefault("registered_device", "Corporate Laptop (MDM Pending)")
        meta.setdefault("mfa_device", "Authenticator App")
        meta.setdefault("mfa_status", "Enrolled (TOTP)")
    elif industry == "banking":
        meta.setdefault("masked_phone", masked_phone)
        meta.setdefault("account_mask", f"••••-••••-{secrets.randbelow(9000) + 1000}")
        meta.setdefault("account_type", "Premier Checking")
    elif industry == "education":
        meta.setdefault("masked_phone", masked_phone)
        meta.setdefault("department", "Computer Science")
        if role == "faculty":
            meta.setdefault("title", "Faculty Member")
        elif role == "administrator":
            meta.setdefault("office", "Registrar Office")
        else:
            meta.setdefault("course", "Undergraduate Program")
            meta.setdefault("gpa_standing", "Good Standing")
    return meta


@router.post("/{tenant_id}/users", response_model=EndUserOut, status_code=status.HTTP_201_CREATED)
def create_tenant_user(
    tenant_id: str,
    payload: EndUserCreate,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> EndUserOut:
    assert_tenant_access(operator, tenant_id)
    tenant = db.get(Tenant, tenant_id)
    if not tenant:
        raise VoiceLockError(
            code="tenant_not_found",
            message="Tenant not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    ext_ref = (payload.external_reference or "").strip() or _default_user_reference(tenant.industry, payload.role)

    existing = db.scalar(
        select(EndUser).where(
            EndUser.tenant_id == tenant_id,
            EndUser.external_reference == ext_ref,
        )
    )
    if existing:
        raise VoiceLockError(
            code="user_reference_exists",
            message="A user with this external reference already exists in this tenant.",
            status_code=status.HTTP_409_CONFLICT,
        )

    merged_metadata = _build_default_user_metadata(
        industry=tenant.industry,
        role=payload.role,
        phone_reference=payload.phone_reference,
        provided_metadata=payload.metadata_json,
    )

    user = EndUser(
        tenant_id=tenant_id,
        external_reference=ext_ref,
        name=payload.name.strip(),
        email=payload.email.strip() if payload.email else None,
        phone_reference=payload.phone_reference.strip() if payload.phone_reference else None,
        role=payload.role,
        metadata_json=merged_metadata,
    )
    db.add(user)
    db.flush()
    record_audit_event(
        db,
        event_type="user.created",
        actor_reference=operator.email,
        tenant_id=tenant_id,
        details={"user_id": user.id, "external_reference": user.external_reference, "role": user.role},
    )
    db.commit()
    db.refresh(user)
    return EndUserOut(
        id=user.id,
        tenant_id=user.tenant_id,
        external_reference=user.external_reference,
        name=user.name,
        email=user.email,
        phone_reference=user.phone_reference,
        role=user.role,
        status=user.status,
        metadata_json=user.metadata_json,
        created_at=user.created_at,
        enrollment_status="not_enrolled",
    )
