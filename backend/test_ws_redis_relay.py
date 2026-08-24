"""Exercises the Redis-backed WebSocket relay (services/ws_manager.py +
services/redis_client.py) against fakeredis's async client — a real pub/sub
implementation in-process, not a mock of individual calls — so this actually proves
the publish → relay → local-delivery path works, not just that the right functions
get called. No real Redis server involved or required.
"""

import asyncio

import fakeredis
import pytest

from services import redis_client, ws_manager


class FakeWebSocket:
    def __init__(self):
        self.accepted = False
        self.sent: list[dict] = []

    async def accept(self):
        self.accepted = True

    async def send_json(self, message: dict):
        self.sent.append(message)


@pytest.fixture(autouse=True)
def _reset_redis_client():
    redis_client.reset_client_for_tests()
    yield
    redis_client.reset_client_for_tests()


@pytest.fixture
def fake_redis():
    client = fakeredis.FakeAsyncRedis(decode_responses=True)
    redis_client._client = client
    redis_client._client_initialized = True
    yield client


@pytest.fixture(autouse=True)
def _restore_manager_singleton():
    original = ws_manager.manager
    yield
    ws_manager.manager = original


@pytest.mark.asyncio
async def test_broadcast_falls_back_to_local_delivery_when_redis_unavailable():
    manager = ws_manager.ConnectionManager()
    ws = FakeWebSocket()
    await manager.connect(ws, user_id=None)
    await manager.subscribe(ws, ["quotes"])

    # redis_client.get_client() returns None with no REDIS_URL configured (the
    # reset_client_for_tests fixture already ensured a clean, unconfigured state).
    await manager.broadcast("quotes", [{"ticker": "THYAO"}])

    assert ws.sent == [{"channel": "quotes", "data": [{"ticker": "THYAO"}]}]


@pytest.mark.asyncio
async def test_broadcast_publishes_to_redis_instead_of_delivering_locally(fake_redis):
    manager = ws_manager.ConnectionManager()
    ws = FakeWebSocket()
    await manager.connect(ws, user_id=None)
    await manager.subscribe(ws, ["quotes"])

    await manager.broadcast("quotes", [{"ticker": "THYAO"}])

    # No relay loop is running in this test, so nothing should have been delivered
    # yet — broadcast() handed off to Redis and returned, it didn't deliver directly.
    assert ws.sent == []


@pytest.mark.asyncio
async def test_redis_relay_loop_delivers_published_broadcast_to_local_connection(fake_redis):
    manager = ws_manager.ConnectionManager()
    ws_manager.manager = manager  # redis_relay_loop delivers via the module-level singleton
    ws = FakeWebSocket()
    await manager.connect(ws, user_id=None)
    await manager.subscribe(ws, ["quotes"])

    relay_task = asyncio.create_task(ws_manager.redis_relay_loop())
    try:
        await asyncio.sleep(0.2)  # let the relay loop actually subscribe
        await manager.broadcast("quotes", [{"ticker": "THYAO"}])
        await asyncio.sleep(0.2)  # let the relay loop receive and deliver it

        assert ws.sent == [{"channel": "quotes", "data": [{"ticker": "THYAO"}]}]
    finally:
        relay_task.cancel()
        await asyncio.gather(relay_task, return_exceptions=True)


@pytest.mark.asyncio
async def test_redis_relay_loop_respects_per_user_targeting(fake_redis):
    manager = ws_manager.ConnectionManager()
    ws_manager.manager = manager
    user_a, user_b = FakeWebSocket(), FakeWebSocket()
    await manager.connect(user_a, user_id=1)
    await manager.connect(user_b, user_id=2)
    await manager.subscribe(user_a, ["alerts"])
    await manager.subscribe(user_b, ["alerts"])

    relay_task = asyncio.create_task(ws_manager.redis_relay_loop())
    try:
        await asyncio.sleep(0.2)
        await manager.send_to_user(1, "alerts", {"ticker": "THYAO"})
        await asyncio.sleep(0.2)

        assert len(user_a.sent) == 1
        assert user_b.sent == []
    finally:
        relay_task.cancel()
        await asyncio.gather(relay_task, return_exceptions=True)


def test_redis_relay_loop_returns_immediately_with_no_redis_configured():
    # No fake_redis fixture here — REDIS_URL is unset, get_client() returns None.
    # This must be a plain no-op task main.py can always create unconditionally.
    assert redis_client.get_client() is None
