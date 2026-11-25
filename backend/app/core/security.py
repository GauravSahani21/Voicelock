from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

password_hasher = PasswordHash.recommended()

# In-memory JTI revocation set (lightweight logout blocklist for active JWT lifetimes)
_REVOKED_JTIS: set[str] = set()


def hash_password(plain_password: str) -> str:
    return password_hasher.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return password_hasher.verify(plain_password, hashed_password)
    except Exception:
        return False


def sha256_hex(raw_value: str) -> str:
    return hashlib.sha256(raw_value.encode("utf-8")).hexdigest()


def create_access_token(
    subject: str,
    role: str,
    tenant_id: Optional[str],
    email: str,
    expires_minutes: Optional[int] = None,
) -> tuple[str, str, datetime]:
    settings = get_settings()
    ttl = expires_minutes or settings.access_token_expire_minutes
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=ttl)
    jti = secrets.token_hex(16)

    payload: Dict[str, Any] = {
        "sub": subject,
        "role": role,
        "tenant_id": tenant_id,
        "email": email,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, settings.app_secret_key, algorithm="HS256")
    return token, jti, expires_at


def decode_access_token(token: str) -> Dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(token, settings.app_secret_key, algorithms=["HS256"])
    jti = payload.get("jti")
    if jti and jti in _REVOKED_JTIS:
        raise jwt.InvalidTokenError("Token has been revoked")
    return payload


def revoke_token_jti(jti: str) -> None:
    if jti:
        _REVOKED_JTIS.add(jti)
