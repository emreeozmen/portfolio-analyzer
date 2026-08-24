from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from services import rate_limit


@pytest.fixture(autouse=True)
def clear_rate_limit_state():
    rate_limit._attempts.clear()
    rate_limit._locked_until.clear()
    rate_limit._request_log.clear()
    yield
    rate_limit._attempts.clear()
    rate_limit._locked_until.clear()
    rate_limit._request_log.clear()


def _mock_request(path: str = "/assets/track", ip: str = "1.2.3.4"):
    request = MagicMock()
    request.url.path = path
    request.client.host = ip
    return request


def test_not_locked_out_initially():
    assert rate_limit.is_locked_out("user@example.com") == 0.0


def test_locks_out_after_max_attempts():
    for _ in range(rate_limit.MAX_ATTEMPTS):
        rate_limit.record_failed_attempt("user@example.com")

    assert rate_limit.is_locked_out("user@example.com") > 0


def test_below_max_attempts_not_locked_out():
    for _ in range(rate_limit.MAX_ATTEMPTS - 1):
        rate_limit.record_failed_attempt("user@example.com")

    assert rate_limit.is_locked_out("user@example.com") == 0.0


def test_reset_attempts_clears_lockout():
    for _ in range(rate_limit.MAX_ATTEMPTS):
        rate_limit.record_failed_attempt("user@example.com")
    assert rate_limit.is_locked_out("user@example.com") > 0

    rate_limit.reset_attempts("user@example.com")

    assert rate_limit.is_locked_out("user@example.com") == 0.0


def test_email_matching_is_case_and_whitespace_insensitive():
    for _ in range(rate_limit.MAX_ATTEMPTS):
        rate_limit.record_failed_attempt("  User@Example.com  ")

    assert rate_limit.is_locked_out("user@example.com") > 0


def test_lockout_expires_after_window(monkeypatch):
    current_time = 1_000_000.0
    monkeypatch.setattr(rate_limit.time, "time", lambda: current_time)

    for _ in range(rate_limit.MAX_ATTEMPTS):
        rate_limit.record_failed_attempt("user@example.com")
    assert rate_limit.is_locked_out("user@example.com") > 0

    current_time += rate_limit.LOCKOUT_SECONDS + 1
    monkeypatch.setattr(rate_limit.time, "time", lambda: current_time)

    assert rate_limit.is_locked_out("user@example.com") == 0.0


def test_throttle_allows_calls_under_the_limit():
    dependency = rate_limit.throttle(max_calls=3, window_seconds=60)
    request = _mock_request()

    for _ in range(3):
        dependency(request)  # should not raise


def test_throttle_blocks_calls_over_the_limit():
    dependency = rate_limit.throttle(max_calls=3, window_seconds=60)
    request = _mock_request()

    for _ in range(3):
        dependency(request)

    with pytest.raises(HTTPException) as exc_info:
        dependency(request)
    assert exc_info.value.status_code == 429


def test_throttle_is_scoped_per_ip():
    dependency = rate_limit.throttle(max_calls=1, window_seconds=60)
    dependency(_mock_request(ip="1.1.1.1"))

    dependency(_mock_request(ip="2.2.2.2"))  # different IP, should not raise


def test_throttle_is_scoped_per_path():
    dependency = rate_limit.throttle(max_calls=1, window_seconds=60)
    dependency(_mock_request(path="/assets/track"))

    dependency(_mock_request(path="/assets/refresh-all"))  # different path, should not raise


def test_throttle_window_expires(monkeypatch):
    current_time = 1_000_000.0
    monkeypatch.setattr(rate_limit.time, "time", lambda: current_time)
    dependency = rate_limit.throttle(max_calls=1, window_seconds=60)
    request = _mock_request()

    dependency(request)
    with pytest.raises(HTTPException):
        dependency(request)

    current_time += 61
    monkeypatch.setattr(rate_limit.time, "time", lambda: current_time)

    dependency(request)  # should not raise, window has expired
