# VoiceLock Gateway — REST API Reference

Interactive Swagger / OpenAPI docs are served automatically by FastAPI at:
- `http://localhost:8000/docs` (Swagger UI)
- `http://localhost:8000/redoc` (ReDoc)
- `http://localhost:8000/openapi.json` (OpenAPI 3.1 schema)

All error responses use a uniform JSON envelope without stack traces or secrets:

```json
{
  "error": {
    "code": "token_action_mismatch",
    "message": "Authorization token is bound to action 'password_reset' and cannot authorize 'mfa_reset'.",
    "details": {}
  },
  "request_id": "vl_req_..."
}
```

## Endpoint Groups

### Health & Provider Status
- `GET /api/health` — Unauthenticated readiness check returning gateway status, PostgreSQL connectivity, active Detectif provider mode (`live` or `mock`), and configured Whisper model.
- `GET /api/providers/status` — Authenticated check calling `GET https://platform.detectif.ai/v1/health` and (when `DETECTIF_API_KEY` is configured) `GET https://platform.detectif.ai/v1/credits`.

### Authentication (`/api/auth`)
- `POST /api/auth/login` — Email/password login returning a signed HS256 JWT (`Authorization: Bearer <token>`).
- `POST /api/auth/logout` — Revokes the active JWT identifier (`jti`).
- `GET /api/auth/me` — Returns current operator profile, role, and tenant scope.

### Tenants & End-Users (`/api/tenants`)
- `GET /api/tenants` — Lists authorized tenants (`platform_admin` sees all; tenant-scoped operators see only their assigned tenant).
- `POST /api/tenants` — Creates a tenant (`platform_admin` only).
- `GET /api/tenants/{tenant_id}` — Retrieves tenant metadata (enforces tenant isolation).
- `GET /api/tenants/{tenant_id}/users` — Lists end-users and latest enrollment status.
- `POST /api/tenants/{tenant_id}/users` — Creates an end-user inside the tenant.

### Voice Enrollment (`/api/enrollments`)
- `GET /api/enrollments` — Lists voice enrollments for authorized tenant(s).
- `GET /api/enrollments/{id}` — Retrieves enrollment metadata (no raw audio or voice embeddings).
- `POST /api/enrollments` — Multipart upload (`tenant_id`, `user_id`, `consent_confirmed=true`, optional `re_enroll`, `file`). Validates 15–60s audio duration and enrolls with Detectif.ai Eidos (`POST /v1/speakers/enroll`, or labelled `MOCK_DEV_ADAPTER` when API key is absent).
- `DELETE /api/enrollments/{id}` — Revokes local enrollment and deletes the speaker profile from Detectif.ai (`DELETE /v1/speakers/{speaker_id}`).

### Verification Sessions & Challenges (`/api/sessions`)
- `POST /api/sessions` — Creates an action- and resource-bound verification session.
- `GET /api/sessions` — Filterable list of verification sessions.
- `GET /api/sessions/{id}` — Full session detail including latest challenge, normalized check results, decision, and token metadata.
- `POST /api/sessions/{id}/challenge` — Issues a fresh CSPRNG spoken challenge phrase bound to the session (supersedes prior unconsumed challenges).
- `POST /api/sessions/{id}/verify` — Multipart submission (`challenge_id`, `file`). Validates audio, consumes challenge atomically, runs `faster-whisper` + Detectif.ai Aletheia + Detectif.ai Eidos per policy, evaluates deterministic `PolicyEngine`, writes audit events, and returns a single-use `authorization_token` on `PASS`.
- `GET /api/sessions/{id}/result` — Retrieves evaluated session details.

### Decisions & Human Review (`/api/decisions`)
- `GET /api/decisions` — Lists policy decisions with filtering by tenant, outcome, and industry.
- `GET /api/decisions/{id}` — Retrieves full decision explanation, reason codes, triggered rules, and model evidence.
- `POST /api/decisions/{id}/review` — Allows an authorized operator to resolve `REVIEW` or `STEP_UP` cases (`APPROVE` or `REJECT`) with audit logging.

### Action-Bound Authorization Tokens (`/api/tokens`)
- `POST /api/tokens/validate` — Non-consuming validation verifying signature hash, expiry, unconsumed status, tenant, user, action, and resource binding.
- `POST /api/tokens/consume` — Atomic single-use consumption (`SELECT ... FOR UPDATE`). Rejects replayed (`409`), expired (`403`), or scope-mismatched (`403`) tokens.

### Policies, Workflows, Simulator & Audit
- `GET /api/policies` & `GET /api/policies/{industry}` — Inspects versioned industry policy rules (`telecom`, `helpdesk`, `banking`, `education`).
- `POST /api/workflows/{industry}/execute` & `GET /api/workflows/executions` — Simulated protected industry operations gated by server-side token consumption and application RBAC.
- `GET /api/simulator/scenarios` & `POST /api/simulator/run` — Deterministic `SIMULATED TEST SCENARIO` attack & outage fixtures.
- `GET /api/audit` & `GET /api/audit/{id}` — Tenant-isolated audit trail queries.
- `GET /api/dashboard/overview` — Live database metrics for the Security Operations Overview.

### Demo Experience (`/api/demo`, non-production only)
- `GET /api/demo/overview-state` — Returns non-sensitive portal enrollment readiness and active provider mode for `/`.
- `POST /api/demo/bootstrap` — Issues a scoped JWT for designated fictional demo roles (`admin`, `telecom`, `helpdesk`, `banking`, `education`); returns `403 demo_disabled_in_production` when `APP_ENV=production`.
- `POST /api/demo/reset` — Clears transient demo sessions, tokens, executions, and audit events (preserving or clearing enrollments per `clear_enrollments`); disabled when `APP_ENV=production`.
