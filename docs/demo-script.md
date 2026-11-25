# VoiceLock Gateway — Judge Demonstration Script

This 5-minute demo showcases **VoiceLock Gateway** from the perspective of an everyday customer or employee first, then opens the Security Operator Console behind the scenes to inspect the live evidence, policies, tokens, and audit trail.

**Central Idea:** *One reusable security gateway embedded seamlessly inside existing telecom, IT helpdesk, banking, and college applications.*

## Routes Overview

- **Central Demo Hub**: `http://localhost:5173/` (`VoiceLock — Secure Access Demo`)
- **Primary Portal (Telecom — NexaCell Wireless)**: `http://localhost:5173/portals/telecom` (`?mode=attack` for Attack Mode)
- **IT Helpdesk Portal (AcmeCorp IT Service Desk)**: `http://localhost:5173/portals/helpdesk`
- **Banking Portal (Crestline Digital Bank)**: `http://localhost:5173/portals/banking`
- **College Portal (Summit University Portal)**: `http://localhost:5173/portals/college`
- **Security Operator Console**: `http://localhost:5173/security`

## Operator Credentials (Fictional Tenants)

- **Platform Admin (all 4 industries)**: `admin@voicelock.demo` / `DemoAdmin!2026`
- **Telecom Operator**: `telecom.ops@voicelock.demo` / `DemoTelecom!2026`
- **Helpdesk Operator**: `helpdesk.ops@voicelock.demo` / `DemoHelpdesk!2026`
- **Bank Operator**: `bank.ops@voicelock.demo` / `DemoBank!2026` (available via Demo Bootstrap)
- **College Registrar**: `registrar.ops@voicelock.demo` / `DemoCollege!2026` (available via Demo Bootstrap)

---

## Live Demonstration Flow

### 1. Central Landing Hub (`http://localhost:5173/`) — 30s
1. Open `http://localhost:5173/` to show **VoiceLock — Secure Access Demo** and the live provider status badge (`DETECTIF LIVE` or `MOCK DEV ADAPTER`).
2. Highlight the four protected industry environments (**Telecom** emphasized as primary, plus **IT Helpdesk**, **Banking**, and **College**) and note the **Reset Demo Data** button for clean resets between runs.
3. Click **Open Telecom Customer Portal**.

### 2. Primary Demo: Legitimate Telecom SIM Replacement (`/portals/telecom`) — 90s
1. Select `Aarav Sharma (Customer 001)`. If not enrolled yet, click **Enroll Demo Voice (15s)**, confirm explicit consent, and record/upload a 15–20s clear speech clip (`POST /api/enrollments` -> Detectif Eidos).
2. Click **Replace My SIM** -> choose reason (e.g., *Lost SIM*), select replacement SIM type (`eSIM` / `Physical SIM`), and click **Continue to Verification**.
3. The embedded **VoiceLockVerification** component requests a fresh, single-use spoken challenge from `/api/sessions/{id}/challenge` (e.g. `"Verify ..."`).
4. Record or upload the enrolled speaker reading the exact phrase (`3–60s`) and click **Verify & Continue**.
5. Walk through the sequential checks (`Challenge Transcription` via `faster-whisper`, `Voice Authenticity` via Detectif Aletheia, `Speaker Identity` via Detectif Eidos, and deterministic policy decision **`PASS`**), then click **Complete SIM Replacement**. Confirm the customer's SIM record updates via atomic single-use token consumption.

### 3. Impersonation Attack Simulation (`/portals/telecom?mode=attack`) — 60s
1. Click **Attack Mode** (`Launch Impersonation Attempt`) in the NexaCell header.
2. Initiate a SIM replacement against `Aarav Sharma` as an attacker using either another person's voice or synthetic speech (`say` / TTS `.wav`).
3. Submit the challenge audio and show VoiceLock blocking the fraudulent SIM replacement (`REJECT` with reason codes such as `synthetic_voice_detected` / `speaker_mismatch` and zero authorization token issued).

### 4. Multi-Industry Proof Across Helpdesk, Banking & College — 60s
1. Open **IT Helpdesk Portal** (`/portals/helpdesk`): initiate **Reset MFA Device** and note stricter IT rules compared to self-service **Password Reset** (`REVIEW` vs `REJECT` on ambiguity).
2. Open **Banking Portal** (`/portals/banking`) or **College Portal** (`/portals/college`): trigger a sensitive **Change Registered Mobile Number** / **Academic Transcript Release** flow showing the exact same VoiceLock verification widget enforcing industry-specific rules and action-bound tokens.

### 5. Behind the Scenes: Security Operator Console (`/security`) — 60s
1. Click **Security Operator Console** (`/security`).
2. Inspect **Verification Requests** (`/security/requests`), click **Inspect** on the SIM swap / attack session to show the **Decision Detail** (`/security/decisions/:id`) 9-stage Security Event Lifecycle (`Request Created` -> `Challenge Issued` -> `Aletheia` -> `Eidos` -> `Challenge STT` -> `Policy Engine` -> `Token Issued / Blocked` -> `Token Consumed` -> `Action Executed`), reason codes, and immutable **Audit Logs** (`/security/audit`).
3. Briefly visit **Attack Simulator** (`/security/simulator`) to show all 12 deterministic `SIMULATED TEST SCENARIO` cases including fail-safe provider timeout routing to **`REVIEW`** (never `PASS`), and **Settings** (`/security/settings`) to show live Detectif.ai connectivity and privacy guarantees (zero raw audio retention).
