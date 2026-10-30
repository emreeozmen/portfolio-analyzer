"""Tests for the /health (liveness) and /health/ready (readiness) handlers.

The handler functions are called directly rather than through an HTTP client, to
match the rest of this suite (nothing here pulls in a TestClient / httpx).
"""

import json
import asyncio
import threading
from unittest.mock import patch

import anyio
import pytest
import main


@pytest.mark.asyncio
async def test_health_liveness_returns_ok():
    assert await main.health() == {"status": "ok"}


@pytest.mark.asyncio
async def test_health_liveness_never_touches_the_database():
    # Liveness must stay up even when the DB is unreachable — Render's health check
    # points here, so a DB blip must not make it fail and trigger a restart loop.
    with patch.object(main.engine, "connect") as connect:
        assert await main.health() == {"status": "ok"}
    connect.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["GET", "HEAD"])
async def test_health_responds_even_when_sync_request_pool_is_exhausted(method):
    limiter = anyio.to_thread.current_default_thread_limiter()
    original_tokens = limiter.total_tokens
    started = threading.Event()
    release = threading.Event()

    def busy_request():
        started.set()
        release.wait(10)

    request_received = False

    async def receive():
        nonlocal request_received
        if not request_received:
            request_received = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.Event().wait()

    messages = []

    async def send(message):
        messages.append(message)

    limiter.total_tokens = 1
    busy = asyncio.create_task(anyio.to_thread.run_sync(busy_request))
    try:
        while not started.is_set():
            await asyncio.sleep(0.001)
        await asyncio.wait_for(
            main.app(
                {"type": "http", "http_version": "1.1", "method": method, "path": "/health", "root_path": "",
                 "query_string": b"", "headers": [], "scheme": "http",
                 "server": ("test", 80), "client": ("test", 123)},
                receive, send,
            ),
            timeout=0.5,
        )
        assert messages[0]["status"] == 200
    finally:
        release.set()
        await busy
        limiter.total_tokens = original_tokens


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
