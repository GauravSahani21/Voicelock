from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

OutcomeType = Literal["PASS", "STEP_UP", "REVIEW", "REJECT"]
RiskLevel = Literal["low", "medium", "high", "critical"]


@dataclass(frozen=True)
class ActionPolicy:
    action: str
    label: str
    description: str
    risk_level: RiskLevel
    require_aletheia: bool = True
    require_eidos: bool = True
    require_challenge: bool = True
    token_ttl_seconds: int = 180
    always_require_step_up: bool = False
    synthetic_voice_outcome: Literal["REJECT", "REVIEW"] = "REJECT"
    speaker_mismatch_outcome: Literal["REJECT", "REVIEW"] = "REJECT"
    missing_enrollment_outcome: Literal["STEP_UP", "REVIEW", "REJECT"] = "STEP_UP"
    provider_outage_outcome: Literal["REVIEW", "REJECT"] = "REVIEW"
    allowed_user_roles: Optional[List[str]] = None
    additional_verification_notes: str = ""


@dataclass(frozen=True)
class IndustryPolicyConfig:
    policy_id: str
    industry: str
    version: str
    display_name: str
    description: str
    actions: Dict[str, ActionPolicy] = field(default_factory=dict)
