"""JWT minting/verification and password hashing.

Single access token, 8 hours, no refresh flow: a rep's shift is shorter than
that and this is a demo. Adding refresh later is additive.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import bcrypt
import jwt

from app.core.config import settings

# bcrypt directly rather than passlib: passlib 1.7.4 probes bcrypt in a way
# that breaks against bcrypt >= 4.1, and this is the whole of what we needed
# from it. bcrypt caps input at 72 bytes, so long passwords are truncated
# explicitly here rather than raising deep in a dependency.
_BCRYPT_MAX_BYTES = 72


def _encode(raw: str) -> bytes:
    return raw.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_encode(raw), bcrypt.gensalt()).decode()


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_encode(raw), hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: UUID, role: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
