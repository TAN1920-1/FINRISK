"""Password hashing, JWT issuing/validation and in-process rate limiting."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import settings

_hasher = PasswordHasher()

#: Rejected outright regardless of length.
_COMMON_PASSWORDS = {
    "password",
    "password1",
    "password123",
    "12345678",
    "123456789",
    "1234567890",
    "qwerty123",
    "letmein123",
    "admin1234",
    "changeme",
    "welcome123",
}


class PasswordPolicyError(ValueError):
    """Raised when a candidate password fails the documented policy."""


def hash_password(password: str) -> str:
    """Hash a plaintext password with Argon2id."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time-ish verification that never raises on malformed hashes."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    except Exception:  # pragma: no cover - defensive
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except Exception:  # pragma: no cover - defensive
        return False


def validate_password_strength(password: str) -> None:
    """Enforce the password policy documented in the README."""
    minimum = settings.min_password_length
    if not password or len(password) < minimum:
        raise PasswordPolicyError(f"Password must be at least {minimum} characters long.")
    if password.lower() in _COMMON_PASSWORDS:
        raise PasswordPolicyError("Password is too common. Choose something less predictable.")
    if password.isalpha() or password.isdigit():
        raise PasswordPolicyError("Password must mix letters with digits or symbols.")
    if len(set(password)) < 5:
        raise PasswordPolicyError("Password repeats too few distinct characters.")


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


def create_access_token(
    *,
    user_id: int,
    email: str,
    token_version: int,
    organization_id: Optional[int] = None,
    role: Optional[str] = None,
    expires_minutes: Optional[int] = None,
) -> tuple[str, datetime]:
    """Return a signed JWT and its expiry timestamp (UTC)."""
    expires_delta = timedelta(minutes=expires_minutes or settings.access_token_expire_minutes)
    now = datetime.now(timezone.utc)
    expires_at = now + expires_delta

    payload: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "ver": token_version,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    if organization_id is not None:
        payload["org"] = organization_id
    if role:
        payload["role"] = role

    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT.  Raises ``jwt.PyJWTError`` on failure."""
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


class SlidingWindowRateLimiter:
    """Small in-process limiter for sensitive endpoints (e.g. login).

    Suitable for a single-process deployment.  For a multi-process deployment a
    shared store (Redis) should replace this; the interface stays the same.
    """

    def __init__(self, max_attempts: int, window_seconds: int) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> bool:
        """Record an attempt; return ``False`` when the caller is rate limited."""
        now = time.time()
        bucket = self._events[key]
        while bucket and now - bucket[0] > self.window_seconds:
            bucket.popleft()
        if len(bucket) >= self.max_attempts:
            return False
        bucket.append(now)
        return True

    def reset(self, key: str) -> None:
        self._events.pop(key, None)

    def retry_after(self, key: str) -> int:
        bucket = self._events.get(key)
        if not bucket:
            return 0
        remaining = self.window_seconds - (time.time() - bucket[0])
        return max(0, int(remaining))


login_limiter = SlidingWindowRateLimiter(
    max_attempts=settings.login_rate_limit_attempts,
    window_seconds=settings.login_rate_limit_window_seconds,
)
