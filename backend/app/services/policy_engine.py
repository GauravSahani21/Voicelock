from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from app.policies.base import ActionPolicy, IndustryPolicyConfig, OutcomeType


@dataclass
class PolicyEvidence:
    user_role: str
    challenge_status: str  # MATCH | MISMATCH | EXPIRED | REUSED | SUPERSEDED | TRANSCRIPTION_ERROR | SKIPPED
    aletheia_status: str  # REAL | FAKE | UNCERTAIN | PROVIDER_ERROR | NOT_REQUIRED
    eidos_status: str  # MATCH | NO_MATCH | ENROLLMENT_MISSING | PROVIDER_ERROR | NOT_REQUIRED
    step_up_satisfied: bool = False
    aletheia_error_code: Optional[str] = None
    eidos_error_code: Optional[str] = None


@dataclass
class PolicyEvaluation:
    outcome: OutcomeType
    reason_codes: List[str] = field(default_factory=list)
    explanation: str = ""
    triggered_rules: List[str] = field(default_factory=list)
    policy_id: str = ""
    policy_version: str = ""
    token_ttl_seconds: int = 180


class PolicyEngine:
    """
    Deterministic, explainable, rule-based policy evaluation engine.
    Zero LLM involvement in security authorization decisions.
    """

    @staticmethod
    def evaluate(
        *,
        policy: IndustryPolicyConfig,
        action_policy: ActionPolicy,
        evidence: PolicyEvidence,
    ) -> PolicyEvaluation:
        reason_codes: List[str] = []
        triggered_rules: List[str] = []
        notes: List[str] = []

        # 1. Role permission check (e.g. Education student vs faculty vs admin)
        if action_policy.allowed_user_roles is not None:
            if evidence.user_role not in action_policy.allowed_user_roles:
                reason_codes.append("ROLE_NOT_PERMITTED_FOR_ACTION")
                triggered_rules.append(
                    f"RBAC_GUARD: role '{evidence.user_role}' not in {action_policy.allowed_user_roles}"
                )
                return PolicyEvaluation(
                    outcome="REJECT",
                    reason_codes=reason_codes,
                    explanation=(
                        f"User role '{evidence.user_role}' is not authorized to perform "
                        f"'{action_policy.action}' under {policy.industry} policy {policy.version}."
                    ),
                    triggered_rules=triggered_rules,
                    policy_id=policy.policy_id,
                    policy_version=policy.version,
                    token_ttl_seconds=action_policy.token_ttl_seconds,
                )

        # 2. Fresh challenge validation & expiry/replay enforcement
        if action_policy.require_challenge:
            if evidence.challenge_status == "EXPIRED":
                reason_codes.append("CHALLENGE_EXPIRED")
                triggered_rules.append("CHALLENGE_TTL_ENFORCED")
                return PolicyEvaluation(
                    outcome="REJECT",
                    reason_codes=reason_codes,
                    explanation="Submitted verification challenge has expired.",
                    triggered_rules=triggered_rules,
                    policy_id=policy.policy_id,
                    policy_version=policy.version,
                    token_ttl_seconds=action_policy.token_ttl_seconds,
                )
            if evidence.challenge_status in ("REUSED", "SUPERSEDED"):
                reason_codes.append(f"CHALLENGE_{evidence.challenge_status}")
                triggered_rules.append("CHALLENGE_SINGLE_USE_ENFORCED")
                return PolicyEvaluation(
                    outcome="REJECT",
                    reason_codes=reason_codes,
                    explanation="Challenge phrase has already been consumed or superseded (replay rejected).",
                    triggered_rules=triggered_rules,
                    policy_id=policy.policy_id,
                    policy_version=policy.version,
                    token_ttl_seconds=action_policy.token_ttl_seconds,
                )
            if evidence.challenge_status == "MISMATCH":
                reason_codes.append("CHALLENGE_PHRASE_MISMATCH")
                triggered_rules.append("CHALLENGE_TRANSCRIPTION_MISMATCH")
                return PolicyEvaluation(
                    outcome="REJECT",
                    reason_codes=reason_codes,
                    explanation="Spoken audio did not match the issued single-use challenge phrase.",
                    triggered_rules=triggered_rules,
                    policy_id=policy.policy_id,
                    policy_version=policy.version,
                    token_ttl_seconds=action_policy.token_ttl_seconds,
                )
            if evidence.challenge_status == "TRANSCRIPTION_ERROR":
                reason_codes.append("CHALLENGE_TRANSCRIPTION_UNAVAILABLE")
                triggered_rules.append("STT_FAILURE_SAFE_HOLD")
                return PolicyEvaluation(
                    outcome="REVIEW",
                    reason_codes=reason_codes,
                    explanation="Challenge speech transcription failed; routed for human operator review.",
                    triggered_rules=triggered_rules,
                    policy_id=policy.policy_id,
                    policy_version=policy.version,
                    token_ttl_seconds=action_policy.token_ttl_seconds,
                )
            if evidence.challenge_status == "MATCH":
                triggered_rules.append("CHALLENGE_PHRASE_MATCHED")

        # 3. Voice authenticity check (Detectif.ai Aletheia)
        aletheia_failed = False
        if action_policy.require_aletheia:
            if evidence.aletheia_status == "FAKE":
                reason_codes.append("SYNTHETIC_VOICE_DETECTED")
                if action_policy.require_eidos and evidence.eidos_status == "MATCH":
                    reason_codes.append("CONFLICTING_SIGNALS_SYNTHETIC_WITH_MATCH")
                triggered_rules.append(
                    f"ALETHEIA_FAKE -> {action_policy.synthetic_voice_outcome}"
                )
                return PolicyEvaluation(
                    outcome=action_policy.synthetic_voice_outcome,
                    reason_codes=reason_codes,
                    explanation=(
                        "Detectif.ai Aletheia flagged the submitted speech as synthetic/AI-generated. "
                        f"Policy '{policy.policy_id}' requires {action_policy.synthetic_voice_outcome}."
                    ),
                    triggered_rules=triggered_rules,
                    policy_id=policy.policy_id,
                    policy_version=policy.version,
                    token_ttl_seconds=action_policy.token_ttl_seconds,
                )
            if evidence.aletheia_status in ("PROVIDER_ERROR", "UNCERTAIN"):
                aletheia_failed = True
                reason_codes.append("ALETHEIA_CHECK_UNAVAILABLE")
                if evidence.aletheia_error_code:
                    reason_codes.append(f"PROVIDER_ERR_{evidence.aletheia_error_code.upper()}")
                triggered_rules.append("ALETHEIA_OUTAGE_SAFE_HOLD")
                notes.append("Aletheia authenticity check did not complete.")
            elif evidence.aletheia_status == "REAL":
                triggered_rules.append("ALETHEIA_REAL_PASSED")

        # 4. Speaker verification check (Detectif.ai Eidos)
        eidos_failed = False
        if action_policy.require_eidos:
            if evidence.eidos_status == "ENROLLMENT_MISSING":
                reason_codes.append("SPEAKER_ENROLLMENT_MISSING")
                triggered_rules.append(
                    f"EIDOS_ENROLLMENT_MISSING -> {action_policy.missing_enrollment_outcome}"
                )
                return PolicyEvaluation(
                    outcome=action_policy.missing_enrollment_outcome,
                    reason_codes=reason_codes,
                    explanation=(
                        "No active Eidos speaker profile exists for this user. "
                        f"Policy requires {action_policy.missing_enrollment_outcome}."
                    ),
                    triggered_rules=triggered_rules,
                    policy_id=policy.policy_id,
                    policy_version=policy.version,
                    token_ttl_seconds=action_policy.token_ttl_seconds,
                )

            if evidence.eidos_status == "NO_MATCH":
                reason_codes.append("SPEAKER_VERIFICATION_MISMATCH")
                if action_policy.require_aletheia and evidence.aletheia_status == "REAL":
                    reason_codes.append("NATURAL_VOICE_IMPERSONATION_RISK")
                triggered_rules.append(
                    f"EIDOS_NO_MATCH -> {action_policy.speaker_mismatch_outcome}"
                )
                return PolicyEvaluation(
                    outcome=action_policy.speaker_mismatch_outcome,
                    reason_codes=reason_codes,
                    explanation=(
                        "Submitted voice did not match the enrolled Eidos speaker profile. "
                        f"Policy '{policy.policy_id}' ({action_policy.action}) mandates "
                        f"{action_policy.speaker_mismatch_outcome}."
                    ),
                    triggered_rules=triggered_rules,
                    policy_id=policy.policy_id,
                    policy_version=policy.version,
                    token_ttl_seconds=action_policy.token_ttl_seconds,
                )

            if evidence.eidos_status == "PROVIDER_ERROR":
                eidos_failed = True
                reason_codes.append("EIDOS_CHECK_UNAVAILABLE")
                if evidence.eidos_error_code:
                    reason_codes.append(f"PROVIDER_ERR_{evidence.eidos_error_code.upper()}")
                triggered_rules.append("EIDOS_OUTAGE_SAFE_HOLD")
                notes.append("Eidos speaker verification did not complete.")
            elif evidence.eidos_status == "MATCH":
                triggered_rules.append("EIDOS_MATCH_PASSED")

        # 5. Provider unavailability must NEVER silently pass
        if aletheia_failed or eidos_failed:
            reason_codes.append("PROVIDER_UNAVAILABLE_SAFE_FAIL")
            return PolicyEvaluation(
                outcome=action_policy.provider_outage_outcome,
                reason_codes=reason_codes,
                explanation=(
                    "One or more required AI verification checks could not be completed. "
                    + " ".join(notes)
                    + f" Routed to {action_policy.provider_outage_outcome}."
                ),
                triggered_rules=triggered_rules,
                policy_id=policy.policy_id,
                policy_version=policy.version,
                token_ttl_seconds=action_policy.token_ttl_seconds,
            )

        # 6. Additional independent step-up factor check for critical actions
        if action_policy.always_require_step_up and not evidence.step_up_satisfied:
            reason_codes.append("ADDITIONAL_STEP_UP_REQUIRED")
            triggered_rules.append("CRITICAL_ACTION_REQUIRES_STEP_UP")
            return PolicyEvaluation(
                outcome="STEP_UP",
                reason_codes=reason_codes,
                explanation=(
                    f"Voice checks passed, but critical action '{action_policy.action}' requires "
                    "an additional out-of-band confirmation step before authorization."
                ),
                triggered_rules=triggered_rules,
                policy_id=policy.policy_id,
                policy_version=policy.version,
                token_ttl_seconds=action_policy.token_ttl_seconds,
            )

        # 7. All required checks passed
        reason_codes.append("ALL_REQUIRED_CHECKS_PASSED")
        if action_policy.always_require_step_up and evidence.step_up_satisfied:
            reason_codes.append("STEP_UP_FACTOR_VERIFIED")
            triggered_rules.append("STEP_UP_SATISFIED")
        triggered_rules.append("ALL_POLICY_CHECKS_PASSED -> PASS")

        return PolicyEvaluation(
            outcome="PASS",
            reason_codes=reason_codes,
            explanation=(
                f"All required voice, authenticity, and challenge checks satisfied under "
                f"{policy.industry} policy ({policy.policy_id} v{policy.version}). "
                f"Single-use token bound to action '{action_policy.action}'."
            ),
            triggered_rules=triggered_rules,
            policy_id=policy.policy_id,
            policy_version=policy.version,
            token_ttl_seconds=action_policy.token_ttl_seconds,
        )
