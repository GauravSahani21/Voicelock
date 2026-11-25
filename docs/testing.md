# VoiceLock Gateway — Testing & Verification Guide

This document describes the automated test suite, frontend build checks, live Detectif.ai checks, and browser E2E verification completed for **VoiceLock Gateway**.

---

## 1. Automated Backend Suite (`pytest`)

All backend tests run against a dedicated isolated PostgreSQL test database (`voicelock_test` by default in `backend/tests/conftest.py`) and use deterministic `MOCK_DEV_ADAPTER` responses by default so CI/local runs require zero external network calls or API credits.

### Run Command

```bash
cd backend
.venv/bin/pytest -v
```

### Test Coverage Breakdown (18 tests across 6 modules)

1. **`tests/test_health.py` (1 test)**
   - `test_health_endpoint_returns_ok`: Verifies `/api/health` readiness, PostgreSQL connection check, and safe status metadata.
2. **`tests/test_unit_core.py` (7 tests)**
   - `test_challenge_generation_unpredictable`: Verifies CSPRNG challenge phrase uniqueness.
   - `test_phrase_matching_normalization`: Verifies spoken digit/word normalization (e.g., `74` vs `seven four`) and tolerance threshold logic.
   - `test_policy_engine_same_evidence_different_industry_outcomes`: Verifies deterministic versioned policies produce distinct outcomes across industries for identical evidence.
   - `test_policy_engine_provider_outage_never_passes`: Verifies fail-safe routing (`REVIEW`, never `PASS`) when AI checks or transcription error/time out.
   - `test_policy_engine_synthetic_voice_overrides_speaker_match`: Verifies `Aletheia = FAKE` overrides `Eidos = MATCH` and rejects.
   - `test_policy_engine_education_role_guard`: Verifies role-based rules in Education (`student` vs `faculty` / `administrator`).
   - `test_detectif_result_normalization_documented_schemas`: Verifies Aletheia & Eidos schema normalization.
3. **`tests/test_detectif_client.py` (2 async tests)**
   - `test_detectif_aletheia_live_client_with_retry_and_idempotency`: Exercises `POST /v1/deepfake/detect` multipart requests, `Authorization` header, `Idempotency-Key` preservation across `429`/`Retry-After` retries, and safe timeout handling with mocked HTTP transport.
   - `test_detectif_eidos_enroll_verify_delete_and_error_handling`: Exercises `POST /v1/speakers/enroll`, `POST /v1/speakers/verify`, `DELETE /v1/speakers/{speaker_id}`, and `422 audio_too_short` handling.
4. **`tests/test_integration_and_security.py` (5 tests)**
   - `test_authentication_and_tenant_isolation`: Verifies Argon2id login, JWT bearer enforcement, `/api/auth/logout` `jti` revocation, and strict `403` tenant isolation for tenant-scoped operators.
   - `test_enrollment_consent_duration_and_revocation`: Enforces `consent_confirmed=true`, `15–60s` duration validation, temp file cleanup, and enrollment revocation.
   - `test_audio_validation_rejects_malformed_and_oversized`: Verifies corrupted bytes and oversized uploads are rejected with `400`/`413`.
   - `test_e2e_workflows_security_tokens_and_outages`: Full session -> challenge -> verify -> `PASS` token issuance -> atomic consume -> wrong-action rejection (`403 token_action_mismatch`) -> wrong-user/resource rejection -> replay rejection (`409 token_already_consumed`), plus challenge replay rejection and fail-closed provider outage handling.
   - `test_attack_simulator_all_12_scenarios`: Runs all 12 `SIMULATED TEST SCENARIO` fixtures.
5. **`tests/test_demo_experience.py` (2 tests)**
   - `test_demo_overview_bootstrap_and_reset`: Verifies `/api/demo/overview-state`, `/api/demo/bootstrap`, and `/api/demo/reset` (`clear_enrollments=false` vs `true`).
   - `test_demo_blocked_in_production_mode`: Verifies `/api/demo/*` returns `403 demo_disabled_in_production` when `APP_ENV=production`.
6. **`tests/test_follow_up_e2e.py` (1 E2E test)**
   - `test_complete_user_centric_portal_journeys`: Exercises complete customer/employee journeys across Telecom SIM replacement, IT Helpdesk MFA reset, Banking beneficiary change, College grade disclosure, and Impersonation Attack Mode using the embedded VoiceLock pipeline.

---

## 2. Frontend Type-Check & Production Build

```bash
cd frontend
npm run build
```

Runs `tsc -b && vite build` and outputs bundle artifacts to `frontend/dist/`.

---

## 3. Live Detectif.ai & Browser E2E Verification

When `DETECTIF_API_KEY` is configured inside `backend/.env`:
- `GET https://platform.detectif.ai/v1/health` and `/v1/credits` verified `200 OK`.
- Live Detectif.ai **Eidos** enrollment (`POST /v1/speakers/enroll`), speaker verification (`POST /v1/speakers/verify`), and deletion (`DELETE /v1/speakers/{speaker_id}`) verified with real speech audio (`15–60s` enroll, `3–60s` verify).
- Live Detectif.ai **Aletheia** (`POST /v1/deepfake/detect`) and local **`faster-whisper`** (`base.en`) phrase matching verified on spoken WAV clips.
- End-to-end Playwright browser tests verified desktop (`1280x800`) and mobile (`390x844`) responsive rendering (zero horizontal overflow across all four consumer portals and `/security/*` routes, zero console errors) against the live FastAPI + PostgreSQL + React/Vite stack.
