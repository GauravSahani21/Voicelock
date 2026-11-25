from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Tuple

from fastapi import status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import VoiceLockError
from app.models.entities import Challenge, VerificationSession
from app.services.audit_service import record_audit_event

# Crisp, phonetically distinct vocabulary designed for clear pronunciation & reliable STT
PHONETIC_WORDS = [
    "amber",
    "atlas",
    "beacon",
    "canyon",
    "cobalt",
    "crimson",
    "delta",
    "emerald",
    "falcon",
    "forest",
    "granite",
    "harbor",
    "indigo",
    "jasper",
    "lantern",
    "marble",
    "meadow",
    "north",
    "olive",
    "orchard",
    "phoenix",
    "quartz",
    "raven",
    "river",
    "silver",
    "summit",
    "timber",
    "vector",
    "velvet",
    "violet",
    "winter",
    "zenith",
]

DIGIT_WORDS = [
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
]


def generate_challenge_phrase() -> str:
    """
    Generate an unpredictable server-side challenge phrase using CSPRNG.
    Sized (~6 words + 2 digits) to elicit 4-8 seconds of natural speech,
    satisfying Detectif.ai Aletheia (>=2s) and Eidos verification (3-60s).
    """
    chosen_words = []
    pool = list(PHONETIC_WORDS)
    for _ in range(4):
        idx = secrets.randbelow(len(pool))
        chosen_words.append(pool.pop(idx))
    d1 = secrets.choice(DIGIT_WORDS)
    d2 = secrets.choice(DIGIT_WORDS)
    return (
        f"Verify {chosen_words[0]} {chosen_words[1]} {d1} {d2} "
        f"{chosen_words[2]} {chosen_words[3]}"
    )


def issue_challenge(
    db: Session,
    *,
    session: VerificationSession,
    actor_reference: str,
) -> Challenge:
    """Issue a fresh single-use challenge bound to an active verification session."""
    now = datetime.now(timezone.utc)
    if _ensure_utc(session.expires_at) <= now:
        raise VoiceLockError(
            code="session_expired",
            message="Verification session has expired. Start a new verification request.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # Supersede any unconsumed earlier challenges for this session so only the freshest is valid
    prior_challenges = list(
        db.scalars(
            select(Challenge).where(
                Challenge.session_id == session.id,
                Challenge.status == "ISSUED",
            )
        ).all()
    )
    for ch in prior_challenges:
        ch.status = "SUPERSEDED"

    settings = get_settings()
    ttl = settings.challenge_ttl_seconds
    expires_at = min(now + timedelta(seconds=ttl), _ensure_utc(session.expires_at))

    challenge = Challenge(
        session_id=session.id,
        challenge_text=generate_challenge_phrase(),
        status="ISSUED",
        expires_at=expires_at,
    )
    db.add(challenge)
    db.flush()

    record_audit_event(
        db,
        event_type="challenge.issued",
        actor_reference=actor_reference,
        tenant_id=session.tenant_id,
        session_id=session.id,
        details={
            "challenge_id": challenge.id,
            "action": session.requested_action,
            "resource_reference": session.resource_reference,
            "expires_at": challenge.expires_at.isoformat(),
        },
    )
    db.commit()
    db.refresh(challenge)
    return challenge


def validate_and_consume_challenge(
    db: Session,
    *,
    session: VerificationSession,
    challenge_id: str,
    actor_reference: str,
) -> Tuple[bool, str, Challenge]:
    """
    Validate challenge ownership, expiry, and single-use status, atomically consuming it
    when valid. Returns (is_valid, failure_reason_code, challenge).
    """
    challenge = db.scalar(
        select(Challenge)
        .where(Challenge.id == challenge_id)
        .with_for_update()
    )
    if not challenge or challenge.session_id != session.id:
        raise VoiceLockError(
            code="challenge_not_found",
            message="Challenge does not belong to this verification session.",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    now = datetime.now(timezone.utc)

    if challenge.status == "CONSUMED" or challenge.consumed_at is not None:
        record_audit_event(
            db,
            event_type="challenge.replay_rejected",
            actor_reference=actor_reference,
            tenant_id=session.tenant_id,
            session_id=session.id,
            details={"challenge_id": challenge.id},
            commit=True,
        )
        return False, "CHALLENGE_REUSED", challenge

    if challenge.status == "SUPERSEDED":
        return False, "CHALLENGE_SUPERSEDED", challenge

    if _ensure_utc(challenge.expires_at) <= now:
        challenge.status = "EXPIRED"
        record_audit_event(
            db,
            event_type="challenge.expired",
            actor_reference=actor_reference,
            tenant_id=session.tenant_id,
            session_id=session.id,
            details={"challenge_id": challenge.id, "expired_at": challenge.expires_at.isoformat()},
        )
        db.commit()
        return False, "CHALLENGE_EXPIRED", challenge

    # Mark consumed atomically so concurrent replay attempts are blocked
    challenge.status = "CONSUMED"
    challenge.consumed_at = now
    db.flush()
    return True, "", challenge


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
