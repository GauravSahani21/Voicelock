# VoiceLock Gateway — Technical Architecture

## 1. System Overview

**VoiceLock Gateway** is a reusable voice-security and action-authorization gateway structured as a **modular monolith**. Rather than building separate security engines per industry, VoiceLock exposes one verification and authorization pipeline whose behavior is governed by versioned, industry-specific policy configurations (`telecom`, `helpdesk`, `banking`, `education`).

```text
+-----------------------------------------------------------------------------+
|                    External / Simulated Industry Applications               |
|  [Telecom SIM Portal]  [IT Helpdesk]  [Banking Portal]  [Education Portal]  |
+-------------------+-----------------------------------+---------------------+
                    | 1. Create verification session    | 5. Validate & consume
                    |    & request challenge            |    action-bound token
                    v                                   v
+-----------------------------------------------------------------------------+
|                        VoiceLock Gateway API (FastAPI)                      |
|                                                                             |
|  Auth & RBAC   |  Session & Challenge Service  |  Token Authorization Svc   |
|  Tenant Guard  |  Audio Validation & Cleanup   |  Audit Trail Service       |
+-------------------+-----------------------------------+---------------------+
                    |                                   ^
        2. Run configured checks              4. Evaluate deterministic rules
                    v                                   |
+------------------------------------+    +-----------------------------------+
|      Verification Orchestrator     |--->|     Deterministic Policy Engine   |
|  - faster-whisper (Challenge STT)  |    |  - telecom / helpdesk / banking / |
|  - Detectif.ai Aletheia (Deepfake) |    |    education versioned rules      |
|  - Detectif.ai Eidos (Speaker ID)  |    |  - PASS / STEP_UP / REVIEW / REJ  |
+-------------------+----------------+    +-----------------------------------+
                    |
                    v
+-----------------------------------------------------------------------------+
|                 PostgreSQL (Relational State & Audit Trail)                 |
|  tenants, users, speaker_enrollments, verification_sessions, challenges,    |
|  verification_results, decisions, authorization_tokens, audit_events        |
+-----------------------------------------------------------------------------+
```

### Runtime Environment Inspection (Phase 0)

- **Workspace**: `/Users/gauravsahani/Desktop/Hackathon` (clean greenfield workspace).
- **Node.js / npm**: Node `v22.19.0`, npm `10.9.3` (React + TypeScript + Vite + Tailwind CSS).
- **Python / Package Manager**: `uv` available with Python `3.12` (to be provisioned via `uv` for FastAPI, SQLAlchemy, Alembic, Pydantic, `faster-whisper`, `httpx`). System Python is `3.9.6`.
- **Database**: PostgreSQL 16 (provisioned natively via Homebrew `postgresql@16` and documented with `docker-compose.yml` for containerized setups; Docker Desktop app is installed on host, daemon currently inactive).
- **Detectif.ai Health Check**: Verified `GET https://platform.detectif.ai/v1/health` returns HTTP 200 (`status: "ok"`, `database: "ok"`, `inference: "ok"`).
- **Credentials**: `DETECTIF_API_KEY` is not yet configured in the environment. Phase 5 will support both the real Detectif.ai REST API (when `DETECTIF_API_KEY` is provided in backend `.env`) and a clearly labelled `MOCK_DEV_ADAPTER` for local development without credentials.

---

## 2. Verified Detectif.ai API Integration Specification

All integration details below were verified directly against the official documentation (`https://platform.detectif.ai/docs.md`, `docs/deepfake-detection.md`, `docs/speaker-verification.md`, and `docs/agents.md`).

### 2.1 Base URL & Authentication

- **Base URL**: `https://platform.detectif.ai`
- **Authentication**: `Authorization: Bearer <DETECTIF_API_KEY>` (never sent in URLs, query parameters, or frontend code).
- **Idempotency**: Upload requests (`POST`) should include `Idempotency-Key` (1–128 chars, UUID) and reuse the same key on safe retries (`429`, `500`, `502`, `503`, `504`).
- **Supported Audio Formats**: `WAV`, `MP3`, `M4A`, `FLAC`, `OGG/Opus`, `WebM`, `AIFF` (max `100 MB` via REST `multipart/form-data`, field name `file`).

### 2.2 Aletheia — Deepfake Detection (`POST /v1/deepfake/detect`)

- **Purpose**: Assesses whether submitted audio contains AI-generated/synthetic speech.
- **Audio Constraints**: Up to `300` seconds (5 minutes); requires **at least `2` seconds of speech** (`>= 10` seconds recommended for lowest false-alarm rate).
- **Documented Request**:
  - `POST https://platform.detectif.ai/v1/deepfake/detect`
  - `multipart/form-data` with field `file`.
- **Documented Response (`200 OK`)**:
  - `request_id` (string)
  - `operation_id` (string, `op_...`, retrievable for 30 days via `GET /v1/operations/{operation_id}`)
  - `object` (`"deepfake.detection"`)
  - `result.verdict`: `"real"` or `"fake"` (authoritative decision field; `"not_sure"` exists only for legacy enum compatibility)
  - `result.label`: `"genuine"` or `"synthetic"`
  - `result.is_synthetic`: boolean (`true` iff `verdict == "fake"`)
  - `result.score`: float `0..1` (higher = more likely AI-generated; Detectif docs state: *"Decide with the verdict, not the score alone."*)
  - `result.score_semantics`, `result.duration_seconds`, `result.scored_seconds` (optional)
  - `result.segments`: list of `{ start, end, score, verdict? }`
  - `model`: `{ name, version }`, `credits`, `latency_ms`, `idempotent_replay`.

### 2.3 Eidos — Speaker Verification (`/v1/speakers/*`)

- **Speaker Identifier (`speaker_id`)**: Caller-supplied identifier matching `^[A-Za-z0-9_.:-]{1,64}$`. VoiceLock maps each `(tenant_id, user_id)` enrollment to a deterministic, tenant-scoped `speaker_id` (e.g., `vl_<tenant_hex12>_<user_hex12>`).
- **Enroll (`POST /v1/speakers/enroll`)**:
  - Form fields: `file` (audio), `speaker_id` (required), `display_name` (optional, max 128 chars).
  - **Audio Constraints**: **15 to 60 seconds** duration with **at least 10 seconds of clear speech**. Max **5 samples** per speaker (`409 too_many_samples` on 6th).
  - Response: `request_id`, `operation_id`, `object: "speaker.enrollment"`, `speaker: { speaker_id, display_name, samples, created_at, updated_at }`, `quality: { speech_seconds, duration_seconds }`, `model`, `credits`, `latency_ms`, `idempotent_replay`.
- **Verify (`POST /v1/speakers/verify`)**:
  - Form fields: `file` (audio), `speaker_id` (required), `detect_deepfake` (optional boolean, default `false`).
  - **Audio Constraints**: **3 to 60 seconds** duration with **at least 2 seconds of speech**.
  - Response: `request_id`, `operation_id`, `object: "speaker.verification"`, `speaker_id`, `result: { decision ("match" | "no_match"), similarity (-1 to 1), similarity_semantics, duration_seconds }`, `deepfake` (null unless `detect_deepfake=true`), `model`, `credits`, `latency_ms`, `idempotent_replay`.
  - **Important Semantics**: `result.similarity` ranges from `-1` to `1` and is **not a percentage or probability**. Policy rules must decide using `result.decision` (`match` vs `no_match`).
- **Speaker Read / Delete**:
  - `GET /v1/speakers` & `GET /v1/speakers/{speaker_id}`
  - `DELETE /v1/speakers/{speaker_id}`: Permanently deletes the speaker, encrypted voiceprint, and enrollment audio samples (`{ object: "speaker.deleted", deleted: true }`).

### 2.4 Account & Health Endpoints

- `GET /v1/health` (unauthenticated): `{ request_id, status: "ok"|"degraded", version, database, inference }`.
- `GET /v1/credits` (auth, `credits:read`): `{ request_id, object: "credits", plan, unlimited, available, reserved, price_per_operation }`.
- `GET /v1/operations/{operation_id}` (auth): Fetch stored result for up to 30 days.

### 2.5 Documented Error Handling & Unsupported/Edge Behavior

- **Branch on `error.code`**, never `error.message`:
  - `401` (`missing_api_key`, `invalid_api_key`, `revoked_api_key`) -> Provider auth misconfiguration -> `REVIEW` / safe hold.
  - `402` (`insufficient_credits`) or `403` (`insufficient_scope`, `email_not_verified`) -> Provider failure -> `REVIEW`.
  - `404` (`speaker_not_found`) -> Missing enrollment on provider -> `STEP_UP` / `REVIEW` per policy.
  - `413` (`file_too_large`), `415` (`unsupported_format`), `422` (`audio_too_short`, `audio_too_long`, `insufficient_speech`, `silent_audio`, `corrupt_audio`) -> Invalid/unusable audio -> surface actionable message / fail verification safely (`REJECT` or `REVIEW` depending on whether pre-validation failed vs audio manipulation).
  - `429` (`rate_limited`, `concurrency_limited`) & `500`/`502`/`503`/`504` (`inference_failed`, `server_busy`, `inference_timeout`) -> Respect `Retry-After` up to bounded retry budget using same `Idempotency-Key`; if still failing, record provider outage and return `REVIEW` (never `PASS`).
- **Unsupported / Clarified Provider Behavior**:
  1. `store_audio=false` is **not supported** by Detectif.ai (`400 store_audio_not_supported`). Detectif.ai retains successfully parsed uploaded audio for 30 days before deletion; VoiceLock deletes its own temporary audio files immediately after processing.
  2. Enrollment vs Verification duration windows differ significantly (**15–60s** for enrollment vs **3–60s** for verification). VoiceLock enforces both at upload validation and guides callers to record >= 4–10 seconds for verification and >= 15 seconds for enrollment.
  3. VoiceLock orchestrates Aletheia (`POST /v1/deepfake/detect`) and Eidos (`POST /v1/speakers/verify`) independently rather than relying solely on `detect_deepfake=true`, allowing policies to run Aletheia-only, Eidos-only, or both (`asyncio.gather`) while recording independent `operation_id`s and errors per check.

---

## 3. Core Gateway Components

### 3.1 Authentication, RBAC & Multi-Tenant Isolation
- Passwords hashed with `argon2` / `bcrypt` via `passlib` / `pwdlib`.
- Signed JWT / session bearer tokens (`HS256`, short-lived, `HttpOnly` cookie or `Authorization: Bearer` with logout blocklist/session tracking).
- Roles: `platform_admin` (can access/create all tenants), `tenant_admin`, `operator`, `auditor`.
- Every tenant-scoped endpoint validates `authenticated_user` access to `tenant_id` server-side; frontend-supplied `tenant_id` is never trusted without authorization checks.

### 3.2 Fresh Challenge & Speech Transcription (`faster-whisper`)
- Generated server-side using Python `secrets.choice` from a high-entropy vocabulary of distinct phonetic words + digits (e.g., `"Verify blue river seven four cedar falcon"` — sized to encourage 4–8 seconds of clear speech, satisfying Eidos's 3s+ and Aletheia's 2s+ speech requirements).
- Bound strictly to `(session_id, tenant_id, user_id, requested_action, resource_reference)`.
- Has `expires_at` (default 180s) and `consumed_at`; single-use atomic consumption prevents replay.
- `TranscriptionService` wraps `faster-whisper` behind a clean `STTProvider` protocol so other STT engines can be swapped in. Normalization strips punctuation/casing and matches challenge tokens (handling number words like `"seven"` <-> `"7"`).
- **Important**: Transcription validates **only** that the fresh challenge phrase was spoken; it never asserts speaker identity or deepfake authenticity.

### 3.3 Verification Orchestration Engine
1. Validate authenticated operator/application access and tenant isolation.
2. Validate active `VerificationSession` (not expired, belongs to tenant/user/action/resource).
3. Validate `Challenge` (exists for session, not expired, not previously consumed), atomically mark consumed during verification processing.
4. Validate uploaded audio (MIME/magic bytes, size limit <= 25 MB, readable via PyAV, duration within check limits). Store strictly in temporary directory and delete in `finally` block.
5. Run configured checks per the session's policy:
   - Challenge transcription (`faster-whisper`)
   - Aletheia deepfake detection (if required by policy)
   - Eidos speaker verification (if required by policy, requires active enrollment)
6. Normalize every result into `VerificationResult` rows with `provider_mode` (`LIVE_PROVIDER_CHECK`, `MOCK_DEV_ADAPTER`, or `SIMULATED_TEST_SCENARIO`), raw `provider_reference` (`operation_id` / `request_id`), normalized verdict/decision, and `error_code` if failed.
7. Invoke `PolicyEngine.evaluate(...)` -> persist `Decision`.
8. If outcome is `PASS`, mint a one-time `AuthorizationToken` bound to `(session_id, tenant_id, user_id, action, resource_reference)` and store its SHA-256 hash.
9. Write structured `AuditEvent` entries for every step.

### 3.4 Deterministic Policy Engine
- Pure Python rule evaluation (zero LLMs).
- Four outcomes: `PASS`, `STEP_UP`, `REVIEW`, `REJECT`.
- Policy packs (versioned, e.g., `v1.0.0`):
  - **`telecom`**: `sim_replacement` (High risk: Aletheia + Eidos + Challenge; fake -> `REJECT`, no_match -> `REJECT`, missing enrollment -> `STEP_UP`, outage -> `REVIEW`), `port_out_request` (High), `billing_address_view` (Low: Eidos + Challenge or Aletheia + Challenge).
  - **`helpdesk`**: `mfa_reset` (Critical: Aletheia + Eidos + Challenge + Step-up option if missing enrollment), `password_reset` (Medium), `registered_phone_change` (High), `device_reregistration` (High), `account_unlock` (Medium), `recovery_method_change` (High), `privileged_access_restoration` (Critical: requires `PASS` + secondary supervisor approval metadata).
  - **`banking`**: `view_account_summary` (Low: Eidos + Challenge), `card_block_replace` (Medium), `change_registered_phone` (High: Aletheia + Eidos + Challenge), `add_beneficiary` (High), `high_value_transfer` (Critical), `change_recovery_details` (High), `reset_credentials` (High).
  - **`education`**: `view_academic_records` (Low, role-checked), `view_exam_results` (Low, role-checked), `change_personal_info` (Medium), `reset_portal_credentials` (Medium), `change_recovery_info` (High), `access_faculty_records` (High, faculty/admin role required by app), `modify_academic_records` (Critical, admin role + Aletheia + Eidos + Challenge).

### 3.5 Action-Bound Authorization Tokens
- Raw token (`vl_tok_<32-byte urlsafe random>`) returned once on `PASS`; only `sha256(raw_token)` stored in `authorization_tokens`.
- `POST /api/tokens/validate` and `POST /api/tokens/consume` require exact match on `tenant_id`, `user_id`, `action`, `resource_reference`, active `status == "ACTIVE"`, and `now < expires_at`.
- Consuming sets `status = "CONSUMED"` and `consumed_at = now` atomically (`SELECT ... FOR UPDATE` / conditional `UPDATE`). Reusing a consumed token returns `409 token_already_consumed` and logs an audit event.

---

## 4. Database Schema Overview

- `operator_accounts`: Gateway dashboard users (`id`, `email`, `password_hash`, `full_name`, `role`, `tenant_id` nullable for platform admins, `is_active`, `created_at`).
- `tenants`: (`id`, `slug`, `name`, `industry`, `status`, `created_at`).
- `users`: End-users within a tenant (`id`, `tenant_id`, `external_reference`, `name`, `email`, `role`, `status`, `created_at`, unique `(tenant_id, external_reference)`).
- `speaker_enrollments`: (`id`, `tenant_id`, `user_id`, `provider_name`, `provider_mode`, `provider_speaker_reference`, `sample_count`, `enrollment_status`, `consent_status`, `consent_timestamp`, `enrolled_at`, `revoked_at`).
- `verification_sessions`: (`id`, `tenant_id`, `user_id`, `requested_action`, `resource_reference`, `policy_id`, `policy_version`, `status`, `source_mode`, `created_at`, `expires_at`).
- `challenges`: (`id`, `session_id`, `challenge_text`, `created_at`, `expires_at`, `consumed_at`, `status`).
- `verification_results`: (`id`, `session_id`, `provider`, `provider_mode`, `check_type`, `normalized_result`, `raw_verdict`, `score_or_similarity`, `provider_reference`, `error_code`, `error_message`, `details_json`, `created_at`).
- `decisions`: (`id`, `session_id`, `outcome`, `reason_codes`, `explanation`, `policy_id`, `policy_version`, `created_at`).
- `authorization_tokens`: (`id`, `token_hash`, `session_id`, `tenant_id`, `user_id`, `action`, `resource_reference`, `expires_at`, `consumed_at`, `status`, `created_at`).
- `audit_events`: (`id`, `tenant_id`, `actor_reference`, `session_id`, `event_type`, `event_details`, `created_at`).
- `industry_action_records`: Stores simulated protected operations executed by the Telecom, Helpdesk, Banking, and Education adapters ONLY after consuming a valid VoiceLock authorization token.

---

## 5. Development Roadmap

1. **Phase 0**: Project inspection, Detectif.ai docs verification, architecture & setup docs.
2. **Phase 1**: Foundation — PostgreSQL, SQLAlchemy, Alembic, FastAPI health/error handling, React+Vite+Tailwind scaffold.
3. **Phase 2**: Authentication, RBAC, tenant management, seed data.
4. **Phase 3**: Voice enrollment with consent, audio duration validation, Eidos enrollment & revocation (live + labelled dev mock).
5. **Phase 4**: Fresh challenge service, browser recording/playback/retake, temp file cleanup, `faster-whisper` transcription.
6. **Phase 5**: Detectif.ai Aletheia & Eidos REST clients, retries/timeouts, error mapping, provider health/credits endpoint.
7. **Phase 6**: Verification orchestration engine coordinating session, challenge, audio, STT, Aletheia, and Eidos.
8. **Phase 7**: Deterministic versioned policy engine across `telecom`, `helpdesk`, `banking`, `education`.
9. **Phase 8**: Action-bound authorization tokens (SHA-256, single-use consume, protected endpoint guard).
10. **Phase 9**: Industry workflows (Telecom SIM swap, IT Helpdesk MFA reset, Banking, Education) connected to common gateway.
11. **Phase 10**: Enterprise SOC dashboard connecting all 9 sidebar screens to real backend data.
12. **Phase 11**: Interactive Attack Simulator (12 deterministic `SIMULATED_TEST_SCENARIO` fixtures clearly separated from `LIVE_PROVIDER_CHECK`) & Audit Timeline.
13. **Phase 12**: Unit, integration, security, and end-to-end tests.
14. **Phase 13**: Final README, API docs, diagrams, security/privacy review, and judge demo script.

---

## 6. Security, Privacy & Limitations

- VoiceLock is a **hackathon prototype**, not a certified identity-proofing product.
- Voice biometrics and deepfake detection are **probabilistic signals**, never infallible proof of legal identity.
- Fresh spoken challenges deter static audio replay, but do not by themselves defeat sophisticated real-time voice cloning.
- Alternative human review (`REVIEW`) and step-up flows (`STEP_UP`) exist so legitimate callers are never permanently locked out by model uncertainty or provider outages.
- Raw audio is processed transiently on VoiceLock and deleted immediately after verification/enrollment; Detectif.ai's API retains uploaded audio for 30 days and encrypted speaker profiles until explicitly deleted (`DELETE /v1/speakers/{speaker_id}`).
