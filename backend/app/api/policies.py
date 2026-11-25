from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, status

from app.api.deps import get_current_operator
from app.core.errors import VoiceLockError
from app.models.entities import OperatorAccount
from app.policies.base import IndustryPolicyConfig
from app.policies.registry import get_policy_for_industry, list_all_policies
from app.schemas.gateway import ActionPolicyOut, IndustryPolicyOut

router = APIRouter(prefix="/api/policies", tags=["Policies"])


def _to_policy_out(cfg: IndustryPolicyConfig) -> IndustryPolicyOut:
    return IndustryPolicyOut(
        policy_id=cfg.policy_id,
        industry=cfg.industry,
        version=cfg.version,
        display_name=cfg.display_name,
        description=cfg.description,
        actions=[
            ActionPolicyOut(
                action=a.action,
                label=a.label,
                description=a.description,
                risk_level=a.risk_level,
                require_aletheia=a.require_aletheia,
                require_eidos=a.require_eidos,
                require_challenge=a.require_challenge,
                token_ttl_seconds=a.token_ttl_seconds,
                always_require_step_up=a.always_require_step_up,
                synthetic_voice_outcome=a.synthetic_voice_outcome,
                speaker_mismatch_outcome=a.speaker_mismatch_outcome,
                missing_enrollment_outcome=a.missing_enrollment_outcome,
                provider_outage_outcome=a.provider_outage_outcome,
                allowed_user_roles=a.allowed_user_roles,
                additional_verification_notes=a.additional_verification_notes,
            )
            for a in cfg.actions.values()
        ],
    )


@router.get("", response_model=List[IndustryPolicyOut])
def get_policies(
    operator: OperatorAccount = Depends(get_current_operator),
) -> List[IndustryPolicyOut]:
    return [_to_policy_out(p) for p in list_all_policies()]


@router.get("/{industry}", response_model=IndustryPolicyOut)
def get_policy(
    industry: str,
    operator: OperatorAccount = Depends(get_current_operator),
) -> IndustryPolicyOut:
    try:
        cfg = get_policy_for_industry(industry)
    except KeyError as exc:
        raise VoiceLockError(
            code="policy_not_found",
            message=str(exc),
            status_code=status.HTTP_404_NOT_FOUND,
        ) from exc
    return _to_policy_out(cfg)
