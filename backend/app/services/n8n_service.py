from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.models.entities import (
    AutomationConfig,
    Decision,
    Tenant,
    VerificationResult,
    VerificationSession,
    WebhookDelivery,
)
from app.services.audit_service import record_audit_event

logger = get_logger("voicelock.n8n")


def is_n8n_enabled(db: Session, settings: Optional[Settings] = None) -> bool:
    """Determine whether n8n automation is enabled via runtime config or env default."""
    cfg = settings or get_settings()
    row = db.get(AutomationConfig, "default")
    if row is not None:
        return bool(row.enabled)
    return bool(cfg.n8n_enabled)


def set_n8n_enabled(db: Session, *, enabled: bool, actor_reference: str) -> AutomationConfig:
    """Persist runtime n8n enable/disable toggle without touching secrets."""
    row = db.get(AutomationConfig, "default")
    now = datetime.now(timezone.utc)
    if row is None:
        row = AutomationConfig(id="default", enabled=enabled, updated_by=actor_reference, updated_at=now)
        db.add(row)
    else:
        row.enabled = enabled
        row.updated_by = actor_reference
        row.updated_at = now
    record_audit_event(
        db,
        event_type="automation.toggled",
        actor_reference=actor_reference,
        details={"n8n_enabled": enabled},
    )
    db.commit()
    db.refresh(row)
    return row


def sign_webhook_payload(secret: str, timestamp: str, event_id: str, body_bytes: bytes) -> str:
    """Compute HMAC-SHA256 signature over '<timestamp>.<event_id>.<body>'."""
    if not secret:
        return ""
    msg = f"{timestamp}.{event_id}.".encode("utf-8") + body_bytes
    return "sha256=" + hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def build_verification_event_payload(
    *,
    db: Session,
    session: VerificationSession,
    decision: Decision,
    event_type: str = "VOICE_VERIFICATION_COMPLETED",
    sandbox_session_id: Optional[str] = None,
    attack_type: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Build a minimal, non-sensitive structured security event payload for n8n.
    Never includes raw audio, credentials, access tokens, or authorization tokens.
    """
    tenant = db.get(Tenant, session.tenant_id)
    industry = (tenant.industry if tenant else "unknown").upper()

    results = list(
        db.scalars(select(VerificationResult).where(VerificationResult.session_id == session.id)).all()
    )
    aletheia_res = next((r for r in results if r.check_type == "voice_authenticity"), None)
    eidos_res = next((r for r in results if r.check_type == "speaker_verification"), None)
    challenge_res = next(
        (r for r in results if r.check_type in ("challenge_phrase", "challenge_validation")), None
    )

    decision_label = {
        "PASS": "APPROVED",
        "REJECT": "REJECTED",
        "REVIEW": "REVIEW",
        "STEP_UP": "REVIEW",
    }.get(decision.outcome, decision.outcome)

    voice_authenticity = aletheia_res.normalized_result if aletheia_res else "NOT_REQUIRED"
    if voice_authenticity == "FAKE":
        voice_authenticity = "SUSPICIOUS"

    speaker_match: Optional[bool] = None
    if eidos_res:
        if eidos_res.normalized_result == "MATCH":
            speaker_match = True
        elif eidos_res.normalized_result in ("NO_MATCH", "ENROLLMENT_MISSING"):
            speaker_match = False

    challenge_valid: Optional[bool] = None
    if challenge_res:
        challenge_valid = challenge_res.normalized_result == "MATCH"

    risk_level = "LOW"
    if decision.outcome == "REJECT" or voice_authenticity == "SUSPICIOUS":
        risk_level = "HIGH"
    elif decision.outcome in ("REVIEW", "STEP_UP"):
        risk_level = "MEDIUM"

    event_id = f"evt_{uuid.uuid4().hex[:20]}"
    payload: Dict[str, Any] = {
        "event_id": event_id,
        "event_type": event_type,
        "session_id": sandbox_session_id or session.id,
        "verification_session_id": session.id,
        "industry": industry,
        "action": session.requested_action.upper(),
        "decision": decision_label,
        "raw_outcome": decision.outcome,
        "reason_codes": list(decision.reason_codes or []),
        "speaker_match": speaker_match,
        "voice_authenticity": voice_authenticity,
        "challenge_valid": challenge_valid,
        "risk_level": risk_level,
        "source_mode": session.source_mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if attack_type:
        payload["attack_type"] = attack_type
    return payload


def enqueue_webhook_event(
    db: Session,
    *,
    payload: Dict[str, Any],
    session_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    industry: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> Optional[WebhookDelivery]:
    """
    Persist a durable outbox record in the same transaction boundary.
    Returns None if an identical event_id already exists (idempotency guard).
    """
    cfg = settings or get_settings()
    event_id = str(payload.get("event_id") or f"evt_{uuid.uuid4().hex[:20]}")
    existing = db.scalar(select(WebhookDelivery).where(WebhookDelivery.event_id == event_id))
    if existing is not None:
        return existing

    enabled = is_n8n_enabled(db, cfg)
    target_url = cfg.n8n_webhook_url.strip()
    initial_status = "PENDING" if (enabled and target_url) else "SKIPPED_DISABLED"

    delivery = WebhookDelivery(
        event_id=event_id,
        event_type=str(payload.get("event_type", "VOICE_VERIFICATION_COMPLETED")),
        session_id=session_id,
        tenant_id=tenant_id,
        industry=industry.lower() if industry else None,
        target_url=target_url,
        payload_json=payload,
        status=initial_status,
        attempt_count=0,
        max_attempts=max(1, cfg.n8n_max_retries),
        next_retry_at=datetime.now(timezone.utc) if initial_status == "PENDING" else None,
    )
    db.add(delivery)
    db.flush()
    return delivery


async def deliver_webhook_record(
    db: Session,
    delivery: WebhookDelivery,
    *,
    settings: Optional[Settings] = None,
    transport: Optional[httpx.AsyncBaseTransport] = None,
) -> WebhookDelivery:
    """
    Attempt bounded delivery of a single WebhookDelivery record with exponential backoff.
    Never raises on network/HTTP failure; safely updates delivery status.
    """
    cfg = settings or get_settings()
    target_url = (delivery.target_url or cfg.n8n_webhook_url).strip()
    if not target_url:
        delivery.status = "FAILED"
        delivery.last_error = "N8N_WEBHOOK_URL is not configured."
        db.commit()
        db.refresh(delivery)
        return delivery

    body_bytes = json.dumps(delivery.payload_json, separators=(",", ":"), sort_keys=True).encode("utf-8")
    max_attempts = max(1, delivery.max_attempts or cfg.n8n_max_retries)

    while delivery.attempt_count < max_attempts:
        delivery.attempt_count += 1
        ts = datetime.now(timezone.utc).isoformat()
        sig = sign_webhook_payload(cfg.n8n_webhook_secret, ts, delivery.event_id, body_bytes)
        headers = {
            "Content-Type": "application/json",
            "X-VoiceSuraksha-Event-Id": delivery.event_id,
            "X-VoiceSuraksha-Event-Type": delivery.event_type,
            "X-VoiceSuraksha-Timestamp": ts,
        }
        if sig:
            headers["X-VoiceSuraksha-Signature"] = sig

        try:
            async with httpx.AsyncClient(timeout=cfg.n8n_timeout_seconds, transport=transport) as client:
                resp = await client.post(target_url, content=body_bytes, headers=headers)
            delivery.http_status = resp.status_code
            delivery.response_snippet = (resp.text or "")[:500]
            if 200 <= resp.status_code < 300:
                delivery.status = "DELIVERED"
                delivery.delivered_at = datetime.now(timezone.utc)
                delivery.last_error = None
                delivery.next_retry_at = None
                db.commit()
                db.refresh(delivery)
                return delivery
            delivery.last_error = f"HTTP {resp.status_code}: {(resp.text or '')[:200]}"
        except Exception as exc:
            delivery.last_error = f"{type(exc).__name__}: {str(exc)[:240]}"
            logger.warning("n8n webhook delivery failed event_id=%s attempt=%s err=%s", delivery.event_id, delivery.attempt_count, delivery.last_error)

        if delivery.attempt_count < max_attempts:
            backoff_s = min(0.5 * (2 ** (delivery.attempt_count - 1)), 2.0)
            await asyncio.sleep(backoff_s)

    delivery.status = "DEAD_LETTER" if delivery.attempt_count >= max_attempts else "FAILED"
    delivery.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    db.commit()
    db.refresh(delivery)
    return delivery


def dispatch_delivery_background(delivery_id: str) -> None:
    """Fire-and-forget background task to deliver a queued outbox event without blocking FastAPI."""
    from app.database.session import SessionLocal

    async def _run() -> None:
        with SessionLocal() as bg_db:
            rec = bg_db.get(WebhookDelivery, delivery_id)
            if rec and rec.status == "PENDING":
                await deliver_webhook_record(bg_db, rec)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run())
    except RuntimeError:
        pass
