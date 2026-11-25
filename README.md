# VoiceLock Gateway

**Universal Voice Security & Action Authorization Layer**

> **One gateway. Multiple industries. One consistent security workflow.**

VoiceLock Gateway sits between an application and a sensitive operation—such as a Telecom SIM replacement, IT Helpdesk MFA reset, Banking beneficiary change, or University academic record request. Rather than acting as a standalone voice detector, it orchestrates fresh spoken challenges, **Detectif.ai Aletheia** (deepfake detection), **Detectif.ai Eidos** (speaker verification), local **`faster-whisper`** challenge transcription, a deterministic industry **Policy Engine**, and short-lived, single-use, **action- & resource-bound authorization tokens** backed by an immutable audit log.

---

## Interactive Hackathon Demo Experience

1. **Central Demo Hub (`/`) — *VoiceLock — Secure Access Demo***
   - Presents the four realistic industry portals, live provider mode (`DETECTIF LIVE` or `MOCK DEV ADAPTER`), and demo reset tools.
2. **Primary Demo: NexaCell Wireless (`/portals/telecom`)**
   - Realistic Telecom Customer Self-Service Portal protecting **SIM Replacement (`sim_replacement`)** with embedded VoiceLock challenge/verification and **Attack Mode** (`?mode=attack`) for live impersonation attempts.
3. **AcmeCorp IT Service Desk (`/portals/helpdesk`)**
   - Employee portal protecting **Reset MFA (`mfa_reset`)** and **Password Reset (`password_reset`)**.
4. **Crestline Digital Bank (`/portals/banking`)**
   - Digital banking portal protecting **Registered Mobile Change (`registered_mobile_change`)**, **Account Recovery (`account_recovery`)**, and **Beneficiary Change (`beneficiary_change`)**.
5. **Summit University Portal (`/portals/college`)**
   - Student/faculty/registrar portal protecting **Account Recovery**, **Grade Disclosure (`grade_disclosure`)**, and **Academic Transcript Release (`transcript_release`)**.
6. **Security Operator Console (`/security/*`)**
   - Multi-tenant security operations dashboard with **Verification Requests**, **Voice Enrollment & Revocation**, **9-Stage Decision Lifecycle Inspection**, **Attack Simulator (12 deterministic scenarios)**, **Security Policies**, **Audit Logs**, **Integration Code Snippets**, and **Provider Health Settings**.

---

## Architecture Overview

```text
+-----------------------------------------------------------------------------+
|            Consumer Portals & External Applications (/portals/*)            |
|     [Telecom SIM]   [IT Helpdesk]   [Banking Portal]   [College Portal]     |
+--------------------+----------------------------------+---------------------+
                     | 1. Request challenge & upload    | 5. Atomic token
                     |    spoken phrase via VoiceLock   |    consume & execute
                     v                                  v
+-----------------------------------------------------------------------------+
|                        VoiceLock Gateway API (FastAPI)                      |
|  Auth & RBAC   |  Session & Challenge Service  |  Token Authorization Svc   |
|  Tenant Guard  |  PyAV Validation & Cleanup    |  Audit Trail Service       |
+--------------------+----------------------------------+---------------------+
                     |                                  ^
         2. Parallel / staged checks         4. Evaluate deterministic rules
                     v                                  |
+------------------------------------+    +-----------------------------------+
|      Verification Orchestrator     |--->|     Deterministic Policy Engine   |
|  - faster-whisper (Challenge STT)  |    |  - Versioned rules (v1.0.0)       |
|  - Detectif.ai Aletheia (Deepfake) |    |  - PASS / STEP_UP / REVIEW / REJ  |
|  - Detectif.ai Eidos (Speaker ID)  |    |  - Fail-safe on provider outages  |
+--------------------+---------------+    +-----------------------------------+
                     |
                     v
+-----------------------------------------------------------------------------+
|                 PostgreSQL 16 (11 Relational Tables + Audit Trail)          |
|  tenants, operator_accounts, users, speaker_enrollments,                    |
|  verification_sessions, challenges, verification_results, decisions,        |
|  authorization_tokens, audit_events, industry_action_records                |
+-----------------------------------------------------------------------------+
```

---

## Quick Start

### Prerequisites
- Python **3.11 / 3.12** (`uv` recommended)
- Node.js **20+**
- PostgreSQL **15+** (local PostgreSQL 16 or Docker Compose)
- Optional: `DETECTIF_API_KEY` from [Detectif.ai](https://platform.detectif.ai) for live Aletheia & Eidos verification (`DETECTIF_PROVIDER_MODE=live`). Without a key, VoiceLock runs in clearly labelled `MOCK_DEV_ADAPTER` mode.

### 1. Environment & Database

```bash
cp .env.example backend/.env
# Edit backend/.env to set APP_SECRET_KEY (and optional DETECTIF_API_KEY)
```

Using local PostgreSQL (`postgresql@16`):

```bash
brew services start postgresql@16
createuser -s voicelock || true
psql postgres -c "ALTER USER voicelock WITH PASSWORD 'voicelock';"
createdb -O voicelock voicelock || true
createdb -O voicelock voicelock_test || true
```

Or with Docker Compose (`db`):

```bash
docker compose up -d db
```

### 2. Backend Setup (`http://localhost:8000`)

```bash
cd backend
uv venv --python 3.12
.venv/bin/pip install -r requirements.txt  # or uv pip install -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/python -m app.database.seed
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 3. Frontend Setup (`http://localhost:5173`)

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open **`http://localhost:5173/`** in your browser.

---

## Verification & Testing

- **Backend Automated Suite (`18 tests`)**:
  ```bash
  cd backend
  .venv/bin/pytest -v
  ```
- **Frontend Type-Check & Production Build**:
  ```bash
  cd frontend
  npm run build
  ```

---

## Security, Privacy & Known Limitations

- **Zero Local Audio Retention**: Uploaded audio is validated with PyAV (`av`) inside a temporary directory and deleted unconditionally in a `finally` block right after processing. No raw voice embeddings are stored locally.
- **Detectif.ai Data Handling**: Per official Detectif.ai documentation, parsed uploads may be retained by Detectif.ai for up to 30 days, while enrolled Eidos speaker profiles are stored until deleted via VoiceLock's revocation endpoint (`DELETE /api/enrollments/{id}` -> `DELETE /v1/speakers/{speaker_id}`).
- **Deterministic Fail-Closed Authorization**: No LLM decides access; Detectif outages/timeouts route strictly to human `REVIEW` (never `PASS`). Tokens are hashed with SHA-256, strictly bound to `(tenant_id, user_id, action, resource_reference)`, and consumed atomically with `SELECT ... FOR UPDATE`.
- **Prototype Scope**: Simulated industry portals model realistic carrier, IT, bank, and university workflows for demonstration; they do not integrate with live SS7/telephony networks or production IAM backends.

---

## Documentation Index

- [Technical Architecture & Verified Detectif.ai Spec](docs/architecture.md)
- [Development Setup Guide](docs/setup.md)
- [REST API Reference](docs/api.md) (plus interactive Swagger UI at `http://localhost:8000/docs`)
- [Security, Privacy & Threat Model](docs/security.md)
- [Testing & Verification Guide](docs/testing.md)
- [Judge Demonstration Script](docs/demo-script.md)
- [Phase Progress Tracker](docs/phase-progress.md)
