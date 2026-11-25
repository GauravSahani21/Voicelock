from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> str:
    return str(uuid.uuid4())


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    industry: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    users: Mapped[List["EndUser"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    operators: Mapped[List["OperatorAccount"]] = relationship(back_populates="tenant")
    sessions: Mapped[List["VerificationSession"]] = relationship(back_populates="tenant")


class OperatorAccount(Base):
    """Authenticated gateway console/API operator account (RBAC + tenant scoping)."""

    __tablename__ = "operator_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="operator")
    tenant_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    tenant: Mapped[Optional["Tenant"]] = relationship(back_populates="operators")


class EndUser(Base):
    """End-user / customer / employee / student within a tenant."""

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("tenant_id", "external_reference", name="uq_users_tenant_ext_ref"),
        Index("ix_users_tenant_role", "tenant_id", "role"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    external_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone_reference: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="customer")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    metadata_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    tenant: Mapped["Tenant"] = relationship(back_populates="users")
    enrollments: Mapped[List["SpeakerEnrollment"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    sessions: Mapped[List["VerificationSession"]] = relationship(back_populates="user")


class SpeakerEnrollment(Base):
    """Tracks Detectif.ai Eidos (or clearly labelled dev mock) speaker enrollment per tenant+user."""

    __tablename__ = "speaker_enrollments"
    __table_args__ = (
        Index("ix_enrollments_tenant_user", "tenant_id", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider_name: Mapped[str] = mapped_column(String(64), nullable=False, default="detectif_eidos")
    provider_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="LIVE_PROVIDER_CHECK")
    provider_speaker_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enrollment_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    consent_status: Mapped[str] = mapped_column(String(32), nullable=False, default="not_given")
    consent_recorded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_operation_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    quality_metadata: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    enrolled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    user: Mapped["EndUser"] = relationship(back_populates="enrollments")


class VerificationSession(Base):
    """Represents one sensitive action verification request bound to tenant, user, action, resource."""

    __tablename__ = "verification_sessions"
    __table_args__ = (
        Index("ix_sessions_tenant_created", "tenant_id", "created_at"),
        Index("ix_sessions_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    external_request_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    requested_action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    resource_reference: Mapped[str] = mapped_column(String(255), nullable=False)
    policy_id: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(32), nullable=False, default="1.0.0")
    source_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="LIVE_WORKFLOW")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED")
    step_up_satisfied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    request_context: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    tenant: Mapped["Tenant"] = relationship(back_populates="sessions")
    user: Mapped["EndUser"] = relationship(back_populates="sessions")
    challenges: Mapped[List["Challenge"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    verification_results: Mapped[List["VerificationResult"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    decision: Mapped[Optional["Decision"]] = relationship(
        back_populates="session", uselist=False, cascade="all, delete-orphan"
    )
    authorization_tokens: Mapped[List["AuthorizationToken"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class Challenge(Base):
    """Fresh, unpredictable, single-use, expiring challenge phrase bound to a session."""

    __tablename__ = "challenges"
    __table_args__ = (
        Index("ix_challenges_session_status", "session_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("verification_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    challenge_text: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ISSUED")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped["VerificationSession"] = relationship(back_populates="challenges")


class VerificationResult(Base):
    """Normalized check output from faster-whisper, Aletheia, Eidos, or simulator fixtures."""

    __tablename__ = "verification_results"
    __table_args__ = (
        Index("ix_results_session_check", "session_id", "check_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("verification_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="LIVE_PROVIDER_CHECK")
    check_type: Mapped[str] = mapped_column(String(64), nullable=False)
    normalized_result: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_verdict: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    score_or_similarity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    provider_reference: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    error_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    details_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    session: Mapped["VerificationSession"] = relationship(back_populates="verification_results")


class Decision(Base):
    """Deterministic policy outcome for a verification session."""

    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("verification_sessions.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    outcome: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    reason_codes: Mapped[List[str]] = mapped_column(JSON, nullable=False, default=list)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    triggered_rules: Mapped[List[str]] = mapped_column(JSON, nullable=False, default=list)
    policy_id: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    session: Mapped["VerificationSession"] = relationship(back_populates="decision")


class AuthorizationToken(Base):
    """Short-lived, single-use, action- and resource-bound decision token (SHA-256 hashed)."""

    __tablename__ = "authorization_tokens"
    __table_args__ = (
        Index("ix_auth_tokens_hash", "token_hash", unique=True),
        Index("ix_auth_tokens_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("verification_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    resource_reference: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped["VerificationSession"] = relationship(back_populates="authorization_tokens")


class AuditEvent(Base):
    """Immutable audit trail for all security, enrollment, verification, and token events."""

    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_tenant_created", "tenant_id", "created_at"),
        Index("ix_audit_session_created", "session_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    tenant_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_reference: Mapped[str] = mapped_column(String(160), nullable=False)
    session_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("verification_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_details: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class IndustryActionRecord(Base):
    """Simulated downstream industry operations executed only after consuming a valid token."""

    __tablename__ = "industry_action_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    tenant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("verification_sessions.id", ondelete="CASCADE"), nullable=False
    )
    token_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("authorization_tokens.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    industry: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    resource_reference: Mapped[str] = mapped_column(String(255), nullable=False)
    execution_status: Mapped[str] = mapped_column(String(32), nullable=False, default="EXECUTED")
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    payload_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
