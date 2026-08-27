"""Tests for the /health (liveness) and /health/ready (readiness) handlers.

The handler functions are called directly rather than through an HTTP client, to
match the rest of this suite (nothing here pulls in a TestClient / httpx).
"""

import json
from unittest.mock import patch

import main


def test_health_liveness_returns_ok():
    assert main.health() == {"status": "ok"}


def test_health_liveness_never_touches_the_database():
    # Liveness must stay up even when the DB is unreachable — Render's health check
    # points here, so a DB blip must not make it fail and trigger a restart loop.
    with patch.object(
        main.engine, "connect", side_effect=AssertionError("must not be called")
    ):
        assert main.health() == {"status": "ok"}


def test_health_ready_returns_ready_when_database_is_reachable():
    result = main.health_ready()
    assert result == {"status": "ready", "checks": {"database": "ok"}}


def test_health_ready_returns_503_when_database_is_unreachable():
    with patch.object(
        main.engine, "connect", side_effect=OSError("connection refused")
    ):
        response = main.health_ready()
    assert response.status_code == 503
    body = json.loads(response.body)
    assert body == {"status": "unavailable", "checks": {"database": "down"}}


def test_health_ready_reports_the_db_failure_to_sentry():
    with patch.object(
        main.engine, "connect", side_effect=OSError("connection refused")
    ), patch.object(main.sentry_sdk, "capture_exception") as capture:
        main.health_ready()
    capture.assert_called_once()


def test_both_health_routes_accept_get_and_head():
    methods = {
        route.path: route.methods
        for route in main.app.routes
        if getattr(route, "path", None) in ("/health", "/health/ready")
    }
    assert {"GET", "HEAD"} <= methods["/health"]
    assert {"GET", "HEAD"} <= methods["/health/ready"]
