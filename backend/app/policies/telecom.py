from __future__ import annotations

from app.policies.base import ActionPolicy, IndustryPolicyConfig

TELECOM_POLICY = IndustryPolicyConfig(
    policy_id="telecom_default",
    industry="telecom",
    version="1.0.0",
    display_name="Telecom Fraud & SIM-Swap Protection Policy",
    description=(
        "High-assurance voice verification policy guarding SIM replacement, number port-outs, "
        "and sensitive subscriber operations against deepfakes and impersonation."
    ),
    actions={
        "sim_replacement": ActionPolicy(
            action="sim_replacement",
            label="SIM Card Replacement",
            description="Issue a replacement physical SIM or eSIM for an active subscriber line.",
            risk_level="high",
            require_aletheia=True,
            require_eidos=True,
            require_challenge=True,
            token_ttl_seconds=180,
            synthetic_voice_outcome="REJECT",
            speaker_mismatch_outcome="REJECT",
            missing_enrollment_outcome="STEP_UP",
            provider_outage_outcome="REVIEW",
            additional_verification_notes="In-store government ID verification required on STEP_UP.",
        ),
        "port_out_request": ActionPolicy(
            action="port_out_request",
            label="Number Port-Out Authorization",
            description="Generate carrier port-out PIN to transfer mobile number to another carrier.",
            risk_level="critical",
            require_aletheia=True,
            require_eidos=True,
            require_challenge=True,
            token_ttl_seconds=120,
            always_require_step_up=True,
            synthetic_voice_outcome="REJECT",
            speaker_mismatch_outcome="REJECT",
            missing_enrollment_outcome="STEP_UP",
            provider_outage_outcome="REVIEW",
            additional_verification_notes="Requires out-of-band account PIN step-up in addition to voice checks.",
        ),
        "billing_inquiry": ActionPolicy(
            action="billing_inquiry",
            label="Billing Statement Inquiry",
            description="Read recent itemized call and billing summary.",
            risk_level="low",
            require_aletheia=False,
            require_eidos=True,
            require_challenge=True,
            token_ttl_seconds=300,
            synthetic_voice_outcome="REVIEW",
            speaker_mismatch_outcome="REVIEW",
            missing_enrollment_outcome="STEP_UP",
            provider_outage_outcome="REVIEW",
            additional_verification_notes="Low-risk read: speaker mismatch routes to agent review rather than hard reject.",
        ),
    },
)
