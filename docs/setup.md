# VoiceLock Gateway — Development Setup Guide

## Prerequisites

- **Python**: 3.11 or 3.12 (managed cleanly via `uv`)
- **Node.js**: 20+ (verified `v22.19.0` on host)
- **PostgreSQL**: 15+ (local Homebrew `postgresql@16` or Docker Compose)
- **Detectif.ai API Key**: Optional for local mock mode (`DETECTIF_PROVIDER_MODE=mock`), required for live Aletheia & Eidos verification (`DETECTIF_API_KEY` from https://platform.detectif.ai).

## 1. Environment Variables

Copy `.env.example` to `.env` (and/or `backend/.env`):

```bash
cp .env.example backend/.env
```

Set `APP_SECRET_KEY` to a random hex string (e.g., `openssl rand -hex 32`).
To run live Detectif.ai checks, set `DETECTIF_API_KEY` inside `backend/.env`. Never place API keys inside `frontend/`.

## 2. Database Setup

### Option A: Local PostgreSQL (macOS Homebrew)

```bash
brew install postgresql@16
brew services start postgresql@16
createuser -s voicelock || true
psql postgres -c "ALTER USER voicelock WITH PASSWORD 'voicelock';"
createdb -O voicelock voicelock || true
```

### Option B: Docker Compose

```bash
docker compose up -d db
```

## 3. Backend Setup (updated as Phase 1 progresses)

```bash
cd backend
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

## 4. Frontend Setup (updated as Phase 1 progresses)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and proxies `/api` requests to `http://localhost:8000`.
