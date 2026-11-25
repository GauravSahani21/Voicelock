from __future__ import annotations

from typing import Dict, List

from app.policies.banking import BANKING_POLICY
from app.policies.base import ActionPolicy, IndustryPolicyConfig
from app.policies.education import EDUCATION_POLICY
from app.policies.helpdesk import HELPDESK_POLICY
from app.policies.telecom import TELECOM_POLICY

POLICY_REGISTRY: Dict[str, IndustryPolicyConfig] = {
    "telecom": TELECOM_POLICY,
    "helpdesk": HELPDESK_POLICY,
    "banking": BANKING_POLICY,
    "education": EDUCATION_POLICY,
}


def get_policy_for_industry(industry: str) -> IndustryPolicyConfig:
    key = industry.lower().strip()
    if key not in POLICY_REGISTRY:
        raise KeyError(f"Unsupported industry policy '{industry}'")
    return POLICY_REGISTRY[key]


def get_action_policy(industry: str, action: str) -> ActionPolicy:
    policy = get_policy_for_industry(industry)
    if action not in policy.actions:
        raise KeyError(f"Action '{action}' is not defined under industry policy '{industry}'")
    return policy.actions[action]


def list_all_policies() -> List[IndustryPolicyConfig]:
    return [
        POLICY_REGISTRY["telecom"],
        POLICY_REGISTRY["helpdesk"],
        POLICY_REGISTRY["banking"],
        POLICY_REGISTRY["education"],
    ]
