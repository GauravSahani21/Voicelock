from __future__ import annotations

from app.policies.registry import get_action_policy, get_policy_for_industry
from app.services.aletheia_service import AletheiaService
from app.services.challenge_service import generate_challenge_phrase
from app.services.eidos_service import EidosService, build_provider_speaker_id
from app.services.policy_engine import PolicyEngine, PolicyEvidence
from app.services.transcription_service import compare_challenge_phrase


def test_challenge_generation_unpredictable() -> None:
    phrases = {generate_challenge_phrase() for _ in range(25)}
    assert len(phrases) == 25
    for p in phrases:
        assert p.startswith("Verify ")
        assert len(p.split()) == 7


def test_phrase_matching_normalization() -> None:
    expected = "Verify amber falcon seven four cobalt river"
    ok, ratio, matched, missing, _, _ = compare_challenge_phrase(
        expected, "Verify, Amber Falcon 7 4! Cobalt river."
    )
    assert ok is True
    assert ratio == 1.0
    assert missing == []

    # Combined digits "74" also expand to "seven four"
    ok_combined, ratio_combined, _, _, _, _ = compare_challenge_phrase(
        expected, "verify amber falcon 74 cobalt river"
    )
    assert ok_combined is True
    assert ratio_combined == 1.0

    # Wrong phrase fails cleanly
    ok_bad, ratio_bad, _, missing_bad, _, _ = compare_challenge_phrase(
        expected, "Yes please reset my multi factor device right now"
    )
    assert ok_bad is False
    assert ratio_bad < 0.5
    assert len(missing_bad) >= 5


def test_policy_engine_same_evidence_different_industry_outcomes() -> None:
    """Identical evidence (Eidos NO_MATCH, Aletheia REAL, Challenge MATCH) differs by industry risk policy."""
    evidence = PolicyEvidence(
        user_role="customer",
        challenge_status="MATCH",
        aletheia_status="REAL",
        eidos_status="NO_MATCH",
    )

    telecom_pol = get_policy_for_industry("telecom")
    sim_eval = PolicyEngine.evaluate(
        policy=telecom_pol,
        action_policy=get_action_policy("telecom", "sim_replacement"),
        evidence=evidence,
    )
    assert sim_eval.outcome == "REJECT"
    assert "SPEAKER_VERIFICATION_MISMATCH" in sim_eval.reason_codes

    banking_pol = get_policy_for_industry("banking")
    view_eval = PolicyEngine.evaluate(
        policy=banking_pol,
        action_policy=get_action_policy("banking", "view_account_details"),
        evidence=evidence,
    )
    assert view_eval.outcome == "REVIEW"
    assert "SPEAKER_VERIFICATION_MISMATCH" in view_eval.reason_codes


def test_policy_engine_provider_outage_never_passes() -> None:
    telecom_pol = get_policy_for_industry("telecom")
    ev = PolicyEvidence(
        user_role="customer",
        challenge_status="MATCH",
        aletheia_status="PROVIDER_ERROR",
        eidos_status="MATCH",
        aletheia_error_code="inference_timeout",
    )
    res = PolicyEngine.evaluate(
        policy=telecom_pol,
        action_policy=get_action_policy("telecom", "sim_replacement"),
        evidence=ev,
    )
    assert res.outcome == "REVIEW"
    assert "PROVIDER_UNAVAILABLE_SAFE_FAIL" in res.reason_codes


def test_policy_engine_synthetic_voice_overrides_speaker_match() -> None:
    helpdesk_pol = get_policy_for_industry("helpdesk")
    ev = PolicyEvidence(
        user_role="employee",
        challenge_status="MATCH",
        aletheia_status="FAKE",
        eidos_status="MATCH",
    )
    res = PolicyEngine.evaluate(
        policy=helpdesk_pol,
        action_policy=get_action_policy("helpdesk", "mfa_reset"),
        evidence=ev,
    )
    assert res.outcome == "REJECT"
    assert "SYNTHETIC_VOICE_DETECTED" in res.reason_codes
    assert "CONFLICTING_SIGNALS_SYNTHETIC_WITH_MATCH" in res.reason_codes


def test_policy_engine_education_role_guard() -> None:
    edu_pol = get_policy_for_industry("education")
    ev = PolicyEvidence(
        user_role="student",
        challenge_status="MATCH",
        aletheia_status="REAL",
        eidos_status="MATCH",
    )
    denied = PolicyEngine.evaluate(
        policy=edu_pol,
        action_policy=get_action_policy("education", "access_faculty_records"),
        evidence=ev,
    )
    assert denied.outcome == "REJECT"
    assert "ROLE_NOT_PERMITTED_FOR_ACTION" in denied.reason_codes


def test_detectif_result_normalization_documented_schemas() -> None:
    aletheia_payload = {
        "request_id": "req_123",
        "operation_id": "op_abc",
        "object": "deepfake.detection",
        "result": {
            "verdict": "fake",
            "label": "synthetic",
            "is_synthetic": True,
            "score": 0.91,
            "score_semantics": "Higher means more likely AI-generated.",
            "duration_seconds": 8.2,
            "scored_seconds": 8.0,
            "segments": [{"start": 0, "end": 4, "score": 0.88, "verdict": "fake"}],
        },
        "model": {"name": "aletheia", "version": "2026.10"},
        "latency_ms": 420.5,
    }
    norm_a = AletheiaService.normalize_response(aletheia_payload)
    assert norm_a.normalized_result == "FAKE"
    assert norm_a.verdict == "fake"
    assert norm_a.operation_id == "op_abc"
    assert norm_a.provider_mode == "LIVE_PROVIDER_CHECK"

    eidos_payload = {
        "request_id": "req_456",
        "operation_id": "op_def",
        "object": "speaker.verification",
        "speaker_id": "vl_abc_123",
        "result": {
            "decision": "match",
            "similarity": 0.7412,
            "similarity_semantics": "Higher means the two voices are more alike. Not a percentage.",
            "duration_seconds": 5.0,
        },
        "model": {"name": "eidos", "version": "2026.10"},
        "latency_ms": 310.2,
    }
    norm_e = EidosService.normalize_verify_response(eidos_payload)
    assert norm_e.normalized_result == "MATCH"
    assert norm_e.similarity == 0.7412
    assert norm_e.operation_id == "op_def"

    spk_id = build_provider_speaker_id("11111111-2222-3333-4444-555555555555", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    assert spk_id.startswith("vl_")
    assert len(spk_id) <= 64
