from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class EnrollmentCreateResponse(BaseModel):
    id: str
    tenant_id: str
    user_id: str
    user_name: str
    provider_name: str
    provider_mode: str
    enrollment_status: str
    consent_status: str
    sample_count: int
    last_operation_id: Optional[str] = None
    quality_metadata: Dict[str, Any] = Field(default_factory=dict)
    enrolled_at: Optional[datetime] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


class EnrollmentOut(BaseModel):
    id: str
    tenant_id: str
    tenant_name: Optional[str] = None
    user_id: str
    user_name: str
    user_external_reference: str
    provider_name: str
    provider_mode: str
    provider_speaker_reference: Optional[str] = None
    sample_count: int
    enrollment_status: str
    consent_status: str
    consent_recorded_at: Optional[datetime] = None
    last_operation_id: Optional[str] = None
    quality_metadata: Dict[str, Any] = Field(default_factory=dict)
    enrolled_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    created_at: datetime


class SessionCreateRequest(BaseModel):
    tenant_id: str
    user_id: str
    requested_action: str = Field(min_length=2, max_length=128)
    resource_reference: str = Field(min_length=1, max_length=255)
    external_request_id: Optional[str] = Field(default=None, max_length=128)
    request_context: Dict[str, Any] = Field(default_factory=dict)
    step_up_satisfied: bool = False


class ChallengeOut(BaseModel):
    id: str
    session_id: str
    challenge_text: str
    status: str
    created_at: datetime
    expires_at: datetime
    consumed_at: Optional[datetime] = None


class VerificationResultOut(BaseModel):
    id: str
    provider: str
    provider_mode: str
    check_type: str
    normalized_result: str
    raw_verdict: Optional[str] = None
    score_or_similarity: Optional[float] = None
    provider_reference: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    details_json: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class DecisionOut(BaseModel):
    id: str
    session_id: str
    outcome: str
    reason_codes: List[str]
    explanation: str
    triggered_rules: List[str]
    policy_id: str
    policy_version: str
    created_at: datetime


class TokenSummaryOut(BaseModel):
    id: str
    session_id: str
    tenant_id: str
    user_id: str
    action: str
    resource_reference: str
    status: str
    created_at: datetime
    expires_at: datetime
    consumed_at: Optional[datetime] = None


class SessionDetailOut(BaseModel):
    id: str
    tenant_id: str
    tenant_name: str
    industry: str
    user_id: str
    user_name: str
    user_external_reference: str
    user_role: str
    external_request_id: Optional[str] = None
    requested_action: str
    resource_reference: str
    policy_id: str
    policy_version: str
    source_mode: str
    status: str
    step_up_satisfied: bool
    request_context: Dict[str, Any]
    created_at: datetime
    expires_at: datetime
    latest_challenge: Optional[ChallengeOut] = None
    verification_results: List[VerificationResultOut] = Field(default_factory=list)
    decision: Optional[DecisionOut] = None
    token_summary: Optional[TokenSummaryOut] = None


class VerifySubmissionResponse(BaseModel):
    session: SessionDetailOut
    decision: DecisionOut
    authorization_token: Optional[str] = None
    token_expires_at: Optional[datetime] = None
    token_summary: Optional[TokenSummaryOut] = None


class TokenValidateRequest(BaseModel):
    token: str = Field(min_length=10, max_length=256)
    tenant_id: str
    user_id: Optional[str] = None
    action: str
    resource_reference: str


class TokenValidateResponse(BaseModel):
    valid: bool
    status: str
    reason_code: str
    message: str
    token_id: Optional[str] = None
    session_id: Optional[str] = None
    expires_at: Optional[datetime] = None


class TokenConsumeResponse(BaseModel):
    consumed: bool
    token_id: str
    session_id: str
    action: str
    resource_reference: str
    status: str
    consumed_at: datetime


class ActionPolicyOut(BaseModel):
    action: str
    label: str
    description: str
    risk_level: str
    require_aletheia: bool
    require_eidos: bool
    require_challenge: bool
    token_ttl_seconds: int
    always_require_step_up: bool
    synthetic_voice_outcome: str
    speaker_mismatch_outcome: str
    missing_enrollment_outcome: str
    provider_outage_outcome: str
    allowed_user_roles: Optional[List[str]] = None
    additional_verification_notes: str = ""


class IndustryPolicyOut(BaseModel):
    policy_id: str
    industry: str
    version: str
    display_name: str
    description: str
    actions: List[ActionPolicyOut]


class AuditEventOut(BaseModel):
    id: str
    tenant_id: Optional[str] = None
    tenant_name: Optional[str] = None
    actor_reference: str
    session_id: Optional[str] = None
    event_type: str
    event_details: Dict[str, Any]
    created_at: datetime


class IndustryExecuteRequest(BaseModel):
    tenant_id: str
    user_id: str
    action: str
    resource_reference: str
    authorization_token: str = Field(min_length=10, max_length=256)
    operation_payload: Dict[str, Any] = Field(default_factory=dict)


class IndustryActionRecordOut(BaseModel):
    id: str
    tenant_id: str
    user_id: str
    session_id: str
    token_id: str
    industry: str
    action: str
    resource_reference: str
    execution_status: str
    summary: str
    payload_json: Dict[str, Any]
    created_at: datetime
