from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import assert_tenant_access, get_current_operator, require_roles
from app.core.config import get_settings
from app.core.errors import VoiceLockError
from app.database.session import get_db
from app.middleware.rate_limit import rate_limit
from app.models.entities import EndUser, OperatorAccount, SpeakerEnrollment, Tenant
from app.schemas.gateway import EnrollmentCreateResponse, EnrollmentOut
from app.services.audio_service import temporary_audio_upload
from app.services.audit_service import record_audit_event
from app.services.eidos_service import EidosService, build_provider_speaker_id

router = APIRouter(prefix="/api/enrollments", tags=["Voice Enrollment"])


def _to_enrollment_out(db: Session, enrollment: SpeakerEnrollment) -> EnrollmentOut:
    user = db.get(EndUser, enrollment.user_id)
    tenant = db.get(Tenant, enrollment.tenant_id)
    return EnrollmentOut(
        id=enrollment.id,
        tenant_id=enrollment.tenant_id,
        tenant_name=tenant.name if tenant else None,
        user_id=enrollment.user_id,
        user_name=user.name if user else "Unknown User",
        user_external_reference=user.external_reference if user else "unknown",
        provider_name=enrollment.provider_name,
        provider_mode=enrollment.provider_mode,
        provider_speaker_reference=enrollment.provider_speaker_reference,
        sample_count=enrollment.sample_count,
        enrollment_status=enrollment.enrollment_status,
        consent_status=enrollment.consent_status,
        consent_recorded_at=enrollment.consent_recorded_at,
        last_operation_id=enrollment.last_operation_id,
        quality_metadata=enrollment.quality_metadata,
        enrolled_at=enrollment.enrolled_at,
        revoked_at=enrollment.revoked_at,
        created_at=enrollment.created_at,
    )


@router.get("", response_model=List[EnrollmentOut])
def list_enrollments(
    tenant_id: Optional[str] = Query(default=None),
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> List[EnrollmentOut]:
    stmt = select(SpeakerEnrollment).order_by(SpeakerEnrollment.created_at.desc())
    if operator.role != "platform_admin":
        if not operator.tenant_id:
            return []
        if tenant_id and tenant_id != operator.tenant_id:
            assert_tenant_access(operator, tenant_id)
        stmt = stmt.where(SpeakerEnrollment.tenant_id == operator.tenant_id)
    elif tenant_id:
        stmt = stmt.where(SpeakerEnrollment.tenant_id == tenant_id)

    rows = list(db.scalars(stmt).all())
    return [_to_enrollment_out(db, row) for row in rows]


@router.get("/{enrollment_id}", response_model=EnrollmentOut)
def get_enrollment(
    enrollment_id: str,
    operator: OperatorAccount = Depends(get_current_operator),
    db: Session = Depends(get_db),
) -> EnrollmentOut:
    enrollment = db.get(SpeakerEnrollment, enrollment_id)
    if not enrollment:
        raise VoiceLockError(
            code="enrollment_not_found",
            message="Speaker enrollment record not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, enrollment.tenant_id)
    return _to_enrollment_out(db, enrollment)


@router.post(
    "",
    response_model=EnrollmentCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("enroll_audio", max_requests=30, window_seconds=60))],
)
async def enroll_speaker(
    tenant_id: str = Form(...),
    user_id: str = Form(...),
    consent_confirmed: bool = Form(...),
    re_enroll: bool = Form(default=False),
    file: UploadFile = File(...),
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> EnrollmentCreateResponse:
    assert_tenant_access(operator, tenant_id)

    if not consent_confirmed:
        raise VoiceLockError(
            code="consent_required",
            message="Explicit voice enrollment consent must be confirmed before capturing or uploading audio.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    tenant = db.get(Tenant, tenant_id)
    user = db.get(EndUser, user_id)
    if not tenant or not user or user.tenant_id != tenant.id:
        raise VoiceLockError(
            code="user_not_found_in_tenant",
            message="Target user was not found in the specified tenant.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    settings = get_settings()
    eidos = EidosService(settings=settings)
    speaker_id = build_provider_speaker_id(tenant.id, user.id)

    existing = db.scalar(
        select(SpeakerEnrollment)
        .where(
            SpeakerEnrollment.tenant_id == tenant.id,
            SpeakerEnrollment.user_id == user.id,
            SpeakerEnrollment.enrollment_status == "enrolled",
        )
        .order_by(SpeakerEnrollment.created_at.desc())
    )

    if re_enroll and existing is not None:
        # Revoke/delete previous profile before creating fresh enrollment
        deleted, err_code, err_msg = await eidos.delete_speaker(existing.provider_speaker_reference)
        if not deleted:
            raise VoiceLockError(
                code=err_code or "provider_revoke_failed",
                message=err_msg or "Failed to revoke existing speaker profile on provider.",
                status_code=status.HTTP_502_BAD_GATEWAY,
            )
        existing.enrollment_status = "revoked"
        existing.revoked_at = datetime.now(timezone.utc)
        record_audit_event(
            db,
            event_type="enrollment.revoked_for_reenroll",
            actor_reference=operator.email,
            tenant_id=tenant.id,
            details={"enrollment_id": existing.id, "user_id": user.id},
        )
        db.flush()
        existing = None

    with temporary_audio_upload(
        file,
        min_duration_seconds=settings.enrollment_min_duration_seconds,
        max_duration_seconds=settings.enrollment_max_duration_seconds,
    ) as (temp_path, audio_meta):
        existing_samples = existing.sample_count if existing else 0
        eidos_result = await eidos.enroll_speaker(
            speaker_id=speaker_id,
            display_name=f"{tenant.slug}:{user.external_reference}",
            file_path=temp_path,
            duration_seconds=audio_meta.duration_seconds,
            existing_sample_count=existing_samples,
        )

    now = datetime.now(timezone.utc)
    if eidos_result.status == "FAILED":
        failed_record = existing or SpeakerEnrollment(
            tenant_id=tenant.id,
            user_id=user.id,
            provider_name="detectif_eidos",
            provider_mode=eidos_result.provider_mode,
            provider_speaker_reference=speaker_id,
            sample_count=existing_samples,
            enrollment_status="failed" if existing is None else existing.enrollment_status,
            consent_status="granted",
            consent_recorded_at=now,
            quality_metadata={
                "error_code": eidos_result.error_code,
                "error_message": eidos_result.error_message,
                "request_id": eidos_result.request_id,
            },
        )
        if existing is None:
            db.add(failed_record)
            db.flush()
        record_audit_event(
            db,
            event_type="enrollment.failed",
            actor_reference=operator.email,
            tenant_id=tenant.id,
            details={
                "enrollment_id": failed_record.id,
                "user_id": user.id,
                "error_code": eidos_result.error_code,
                "provider_mode": eidos_result.provider_mode,
            },
        )
        db.commit()
        raise VoiceLockError(
            code=eidos_result.error_code or "enrollment_failed",
            message=eidos_result.error_message or "Voice enrollment failed at Detectif.ai Eidos.",
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT
            if eidos_result.error_code in {"audio_too_short", "audio_too_long", "insufficient_speech", "silent_audio", "corrupt_audio"}
            else status.HTTP_502_BAD_GATEWAY,
            details={"provider_mode": eidos_result.provider_mode, "request_id": eidos_result.request_id},
        )

    if existing is not None:
        enrollment = existing
        enrollment.sample_count = eidos_result.samples
        enrollment.provider_mode = eidos_result.provider_mode
        enrollment.last_operation_id = eidos_result.operation_id
        enrollment.consent_status = "granted"
        enrollment.consent_recorded_at = now
        enrollment.quality_metadata = {
            "speech_seconds": eidos_result.speech_seconds,
            "duration_seconds": eidos_result.duration_seconds,
            "request_id": eidos_result.request_id,
            "model_name": eidos_result.model_name,
            "model_version": eidos_result.model_version,
            **eidos_result.raw_metadata,
        }
    else:
        enrollment = SpeakerEnrollment(
            tenant_id=tenant.id,
            user_id=user.id,
            provider_name="detectif_eidos",
            provider_mode=eidos_result.provider_mode,
            provider_speaker_reference=eidos_result.speaker_id,
            sample_count=eidos_result.samples,
            enrollment_status="enrolled",
            consent_status="granted",
            consent_recorded_at=now,
            last_operation_id=eidos_result.operation_id,
            quality_metadata={
                "speech_seconds": eidos_result.speech_seconds,
                "duration_seconds": eidos_result.duration_seconds,
                "request_id": eidos_result.request_id,
                "model_name": eidos_result.model_name,
                "model_version": eidos_result.model_version,
                **eidos_result.raw_metadata,
            },
            enrolled_at=now,
        )
        db.add(enrollment)
        db.flush()

    record_audit_event(
        db,
        event_type="enrollment.completed",
        actor_reference=operator.email,
        tenant_id=tenant.id,
        details={
            "enrollment_id": enrollment.id,
            "user_id": user.id,
            "sample_count": enrollment.sample_count,
            "provider_mode": enrollment.provider_mode,
            "operation_id": enrollment.last_operation_id,
        },
    )
    db.commit()
    db.refresh(enrollment)

    return EnrollmentCreateResponse(
        id=enrollment.id,
        tenant_id=enrollment.tenant_id,
        user_id=enrollment.user_id,
        user_name=user.name,
        provider_name=enrollment.provider_name,
        provider_mode=enrollment.provider_mode,
        enrollment_status=enrollment.enrollment_status,
        consent_status=enrollment.consent_status,
        sample_count=enrollment.sample_count,
        last_operation_id=enrollment.last_operation_id,
        quality_metadata=enrollment.quality_metadata,
        enrolled_at=enrollment.enrolled_at,
    )


@router.delete("/{enrollment_id}", response_model=EnrollmentOut)
async def revoke_enrollment(
    enrollment_id: str,
    operator: OperatorAccount = Depends(require_roles("platform_admin", "tenant_admin", "operator")),
    db: Session = Depends(get_db),
) -> EnrollmentOut:
    enrollment = db.get(SpeakerEnrollment, enrollment_id)
    if not enrollment:
        raise VoiceLockError(
            code="enrollment_not_found",
            message="Speaker enrollment record not found.",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    assert_tenant_access(operator, enrollment.tenant_id)

    if enrollment.enrollment_status == "revoked":
        return _to_enrollment_out(db, enrollment)

    eidos = EidosService()
    deleted, err_code, err_msg = await eidos.delete_speaker(enrollment.provider_speaker_reference)
    if not deleted:
        raise VoiceLockError(
            code=err_code or "provider_delete_failed",
            message=err_msg or "Failed to delete speaker profile from Detectif.ai.",
            status_code=status.HTTP_502_BAD_GATEWAY,
        )

    enrollment.enrollment_status = "revoked"
    enrollment.revoked_at = datetime.now(timezone.utc)
    record_audit_event(
        db,
        event_type="enrollment.revoked",
        actor_reference=operator.email,
        tenant_id=enrollment.tenant_id,
        details={
            "enrollment_id": enrollment.id,
            "user_id": enrollment.user_id,
            "provider_mode": enrollment.provider_mode,
        },
    )
    db.commit()
    db.refresh(enrollment)
    return _to_enrollment_out(db, enrollment)
