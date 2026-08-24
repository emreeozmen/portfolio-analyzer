import pytest

from services.ws_manager import ConnectionManager


class FakeWebSocket:
    def __init__(self, fail_on_send: bool = False):
        self.accepted = False
        self.sent: list[dict] = []
        self.fail_on_send = fail_on_send

    async def accept(self):
        self.accepted = True

    async def send_json(self, message: dict):
        if self.fail_on_send:
            raise RuntimeError("connection closed")
        self.sent.append(message)


@pytest.fixture
def manager():
    return ConnectionManager()


@pytest.mark.asyncio
async def test_connect_accepts_and_tracks_connection(manager):
    ws = FakeWebSocket()
    await manager.connect(ws, user_id=None)
    assert ws.accepted is True
    assert manager.connection_count == 1


@pytest.mark.asyncio
async def test_disconnect_removes_connection(manager):
    ws = FakeWebSocket()
    await manager.connect(ws, user_id=None)
    await manager.disconnect(ws)
    assert manager.connection_count == 0


@pytest.mark.asyncio
async def test_broadcast_only_reaches_subscribed_connections(manager):
    subscribed = FakeWebSocket()
    unsubscribed = FakeWebSocket()
    await manager.connect(subscribed, user_id=None)
    await manager.connect(unsubscribed, user_id=None)
    await manager.subscribe(subscribed, ["quotes"])

    await manager.broadcast("quotes", [{"ticker": "THYAO"}])

    assert subscribed.sent == [{"channel": "quotes", "data": [{"ticker": "THYAO"}]}]
    assert unsubscribed.sent == []


@pytest.mark.asyncio
async def test_unsubscribe_stops_further_broadcasts(manager):
    ws = FakeWebSocket()
    await manager.connect(ws, user_id=None)
    await manager.subscribe(ws, ["quotes"])
    await manager.unsubscribe(ws, ["quotes"])

    await manager.broadcast("quotes", [{"ticker": "THYAO"}])

    assert ws.sent == []


@pytest.mark.asyncio
async def test_send_to_user_only_reaches_matching_user(manager):
    user_a = FakeWebSocket()
    user_b = FakeWebSocket()
    await manager.connect(user_a, user_id=1)
    await manager.connect(user_b, user_id=2)
    await manager.subscribe(user_a, ["alerts"])
    await manager.subscribe(user_b, ["alerts"])

    await manager.send_to_user(1, "alerts", {"ticker": "THYAO", "condition": "price_above"})

    assert len(user_a.sent) == 1
    assert user_b.sent == []


@pytest.mark.asyncio
async def test_send_to_user_ignores_unauthenticated_connections(manager):
    anon = FakeWebSocket()
    await manager.connect(anon, user_id=None)
    await manager.subscribe(anon, ["alerts"])

    await manager.send_to_user(1, "alerts", {"ticker": "THYAO"})

    assert anon.sent == []


@pytest.mark.asyncio
async def test_broadcast_drops_dead_connections(manager):
    dead = FakeWebSocket(fail_on_send=True)
    alive = FakeWebSocket()
    await manager.connect(dead, user_id=None)
    await manager.connect(alive, user_id=None)
    await manager.subscribe(dead, ["quotes"])
    await manager.subscribe(alive, ["quotes"])

    await manager.broadcast("quotes", [{"ticker": "THYAO"}])

    assert manager.connection_count == 1
    assert alive.sent
