# VoiceSuraksha-Sync — n8n Security Automation Workflows

This directory contains importable n8n workflow JSON definitions for VoiceSuraksha-Sync.

## Architectural Boundary

FastAPI is the sole authority for voice verification, challenge validation, policy decisions (`PASS`, `REJECT`, `REVIEW`, `STEP_UP`), and short-lived authorization tokens. **n8n never performs voice verification or authorizes sensitive actions.**

## Workflows Included

1. `workflows/01-security-incident-alert.json` — Security Incident Alert (`REJECTED` / `REVIEW`)
2. `workflows/02-high-risk-attempt-alert.json` — High-Risk Attempt Alert
3. `workflows/03-cross-domain-security-notification.json` — Cross-Domain Security Notification (demonstration only)
4. `workflows/04-daily-security-summary.json` — Daily Security Summary (pulls from authenticated FastAPI `/api/automation/reporting/daily`)
5. `workflows/05-sandbox-session-completed.json` — Sandbox Session Completed

## How to Import into n8n

1. Open your n8n instance (`http://localhost:5678`).
2. Click **Add Workflow** -> **Import from File**.
3. Select each `.json` file from `automation/n8n/workflows/`.
4. Set environment variables in n8n (if using Workflow 4):
   - `VOICESURAKSHA_API_URL=http://localhost:8000`
   - `N8N_REPORTING_API_KEY=<matching backend N8N_REPORTING_API_KEY>`
5. Activate the imported workflows and copy the Webhook URL into your backend `.env` as `N8N_WEBHOOK_URL`.
