# VoiceLock Gateway — Security, Privacy & Threat Model Notes

## 1. Security Controls Implemented

- **Authentication & Password Hashing**: Operator credentials are hashed with `pwdlib` (`Argon2id` via `PasswordHash.recommended()`). Signed HS256 JWTs carry short lifetimes and `jti` revocation on `/api/auth/logout`.
- **RBAC & Strict Tenant Isolation**: `assert_tenant_access()` runs server-side on every tenant, user, enrollment, session, decision, token, workflow, simulator, and audit route. Frontend-supplied `tenant_id` values are never trusted for single-tenant operators (`403 forbidden_tenant_access`).
- **Backend-Only Provider Secrets**: `DETECTIF_API_KEY` is read solely on the backend and masked by `SecretRedactingFilter` in logs. No secret is exposed to Vite (`VITE_*`) or browser bundles.
- **Challenge Replay & Expiry Defense**: Fresh CSPRNG phrases (`secrets`) are bound to `(session_id, tenant_id, user_id, requested_action, resource_reference)`, expire automatically (`CHALLENGE_TTL_SECONDS=180`), and are consumed atomically via `SELECT ... FOR UPDATE`.
- **Action-Bound Single-Use Decision Tokens**: Raw tokens (`vl_tok_...`) are returned once upon `PASS` and stored solely as SHA-256 hashes (`authorization_tokens.token_hash`). Consumption atomically locks and transitions status to `CONSUMED`; any mismatch on `tenant_id`, `user_id`, `action`, `resource_reference`, expiry, or reuse fails closed (`403` / `409`).
- **Deterministic Policy Engine**: Zero LLMs are used in authorization decisions. Provider outages, timeouts, rate limits, or transcription failures never silently become `PASS` — they safely route to `REVIEW` or `REJECT`.
- **Input & Audio Validation + Rate Limiting**: Uploads enforce allowed MIME types/extensions, maximum size (`MAX_AUDIO_SIZE_MB=25`), real container/stream parsing via PyAV (`av`), and duration constraints (`15–60s` enrollment; `3–60s` verification with Eidos). Sliding-window rate limiting guards login, enrollment, verification, and token consumption endpoints.

## 2. Privacy & Data Handling

- **Explicit Voice Consent**: Voice enrollment requires `consent_confirmed=true` and records `consent_recorded_at`.
- **Zero Local Audio or Embedding Retention**: Uploaded audio is written only to a randomized temporary path inside `TEMP_AUDIO_DIR` and deleted unconditionally in a `finally` block right after processing. No raw voice embeddings are stored in PostgreSQL.
- **Detectif.ai Retention & Deletion Behavior (Verified from Official Docs)**:
  - Detectif.ai stores successfully parsed uploaded audio for **30 days** before automatic deletion (`store_audio=false` is unsupported and returns `400 store_audio_not_supported`).
  - Enrolled Eidos speaker profiles are stored encrypted on Detectif.ai until deleted via `DELETE /v1/speakers/{speaker_id}` (triggered by VoiceLock's `DELETE /api/enrollments/{id}` revocation workflow, which permanently removes both the voice profile and its enrollment recordings).

## 3. Known Prototype Scope & Limitations

- VoiceLock is a **hackathon prototype**, not a certified production identity-proofing or telecommunications control plane.
- Voice authenticity (Aletheia) and speaker verification (Eidos) outputs are **probabilistic signals**, not infallible proof of legal identity.
- Spoken challenges mitigate static audio replay, but do not guarantee immunity against real-time, low-latency AI voice conversion over live telephony channels.
- Alternative human review (`REVIEW` / `STEP_UP`) flows exist so legitimate callers who cannot complete voice verification are never permanently locked out.
