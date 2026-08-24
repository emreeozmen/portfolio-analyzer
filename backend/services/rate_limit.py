"""In-memory rate limiting: the original email-keyed login-attempt limiter, plus a
generic per-IP request throttle for other expensive/public endpoints. Deliberately
dependency-free (no Redis) since this app runs as a single process — swap for a
shared store first if this is ever run behind multiple worker processes, since
counters here are per-process.
"""

import time

from fastapi import HTTPException, Request, status

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60  # attempts older than this no longer count
LOCKOUT_SECONDS = 15 * 60

_attempts: dict[str, list[float]] = {}
_locked_until: dict[str, float] = {}


def _normalize(email: str) -> str:
    return email.strip().lower()


def is_locked_out(email: str) -> float:
    """Returns remaining lockout seconds (0 if not locked out)."""
    key = _normalize(email)
    until = _locked_until.get(key)
    if until is None:
        return 0.0
    remaining = until - time.time()
    if remaining <= 0:
        _locked_until.pop(key, None)
        return 0.0
    return remaining


def record_failed_attempt(email: str) -> None:
    key = _normalize(email)
    now = time.time()
    attempts = [t for t in _attempts.get(key, []) if now - t < WINDOW_SECONDS]
    attempts.append(now)
    _attempts[key] = attempts
    if len(attempts) >= MAX_ATTEMPTS:
        _locked_until[key] = now + LOCKOUT_SECONDS


def reset_attempts(email: str) -> None:
    key = _normalize(email)
    _attempts.pop(key, None)
    _locked_until.pop(key, None)


_request_log: dict[str, list[float]] = {}


def throttle(max_calls: int, window_seconds: int):
    """FastAPI dependency factory: `Depends(rate_limit.throttle(10, 60))` caps a
    caller (by client IP + the endpoint's own path, so limits on different routes
    don't share one counter) to `max_calls` within a sliding `window_seconds`
    window, raising 429 once exceeded. Meant for public endpoints that hit
    Yahoo Finance or otherwise do real work per call (asset tracking/refresh,
    registration) — not a replacement for the email-keyed login limiter above.
    """

    def _dependency(request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        key = f"{request.url.path}:{ip}"
        now = time.time()
        calls = [t for t in _request_log.get(key, []) if now - t < window_seconds]
        if len(calls) >= max_calls:
            _request_log[key] = calls
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin.",
            )
        calls.append(now)
        _request_log[key] = calls

    return _dependency
