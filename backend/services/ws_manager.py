"""Tracks connected WebSocket clients and which channels each has subscribed to, so
a handful of background loops (see main.py) can push a batch of quotes/news/alerts to
every interested client at once instead of each browser tab independently polling the
REST API on its own interval.

One process-wide ConnectionManager instance (`manager` below). Without Redis
configured (the default — see services/redis_client.py), broadcasts only reach
clients connected to *this* uvicorn worker, which is exactly right for this app's
single-worker dev/deploy setup. With REDIS_URL set, broadcast()/send_to_user()
publish to a shared Redis channel instead of delivering locally, and
redis_relay_loop() (started from main.py's lifespan, alongside the other background
loops) is what actually delivers to this worker's connections — every worker
(including the one that originated the message) goes through the same Redis round
trip, so there's exactly one delivery path regardless of process count, not two
competing ones.
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from services import redis_client

logger = logging.getLogger("uvicorn.error")

REDIS_PUBSUB_CHANNEL = "pa:ws:broadcast"


@dataclass
class _ConnectionState:
    user_id: int | None
    channels: set[str] = field(default_factory=set)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[WebSocket, _ConnectionState] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_id: int | None) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[websocket] = _ConnectionState(user_id=user_id)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(websocket, None)

    async def subscribe(self, websocket: WebSocket, channels: list[str]) -> None:
        async with self._lock:
            state = self._connections.get(websocket)
            if state is not None:
                state.channels.update(channels)

    async def unsubscribe(self, websocket: WebSocket, channels: list[str]) -> None:
        async with self._lock:
            state = self._connections.get(websocket)
            if state is not None:
                state.channels.difference_update(channels)

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def broadcast(self, channel: str, data: Any) -> None:
        """Sends to every connection subscribed to `channel`, regardless of who's
        logged in — used for public/shared data (quotes, ticker-strip, news, ...).
        Never used for the per-user "alerts" channel; see send_to_user for that.
        """
        if await self._publish(channel, data, user_id=None):
            return
        await self._send_to(channel, data, predicate=lambda state: True)

    async def send_to_user(self, user_id: int, channel: str, data: Any) -> None:
        """Sends only to connections authenticated as this user — used for private,
        per-user data (triggered price/RSI alerts)."""
        if await self._publish(channel, data, user_id=user_id):
            return
        await self._send_to(channel, data, predicate=lambda state: state.user_id == user_id)

    async def _publish(self, channel: str, data: Any, user_id: int | None) -> bool:
        """Best-effort publish to Redis — returns True if it was actually handed off
        (meaning redis_relay_loop will deliver it, including locally), False if Redis
        isn't configured/reachable right now, meaning the caller must fall back to
        delivering locally itself. Never raises: a Redis outage degrades this worker
        to local-only broadcasting rather than losing the message or crashing.
        """
        client = redis_client.get_client()
        if client is None:
            return False
        try:
            envelope = json.dumps({"channel": channel, "data": data, "user_id": user_id})
            await client.publish(REDIS_PUBSUB_CHANNEL, envelope)
            return True
        except Exception as exc:
            logger.warning("Redis publish failed, falling back to local-only delivery: %s", exc)
            return False

    async def _send_to(self, channel: str, data: Any, predicate) -> None:
        message = {"channel": channel, "data": data}
        async with self._lock:
            targets = [ws for ws, state in self._connections.items() if channel in state.channels and predicate(state)]
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)


manager = ConnectionManager()


async def redis_relay_loop() -> None:
    """Subscribes to REDIS_PUBSUB_CHANNEL and delivers every message to this worker's
    own local connections — the counterpart to ConnectionManager._publish() above.
    Returns immediately (a no-op background task) if Redis isn't configured, so
    main.py can always start this task unconditionally, same as the other
    background loops, without an if-Redis branch at the call site.
    """
    client = redis_client.get_client()
    if client is None:
        return

    while True:
        try:
            pubsub = client.pubsub()
            await pubsub.subscribe(REDIS_PUBSUB_CHANNEL)
            logger.info("Redis WebSocket relay connected on channel %s", REDIS_PUBSUB_CHANNEL)
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    envelope = json.loads(message["data"])
                    channel = envelope["channel"]
                    data = envelope["data"]
                    user_id = envelope.get("user_id")
                except (KeyError, ValueError, TypeError) as exc:
                    logger.warning("Ignoring malformed Redis relay message: %s", exc)
                    continue

                if user_id is not None:
                    await manager._send_to(channel, data, predicate=lambda state: state.user_id == user_id)
                else:
                    await manager._send_to(channel, data, predicate=lambda state: True)
        except Exception as exc:
            # A dropped Redis connection shouldn't permanently kill this worker's
            # relay (or, transitively, the WebSocket fanout for the whole
            # deployment) — log and retry after a short backoff instead of letting
            # the exception propagate out of the asyncio.create_task in main.py.
            logger.warning("Redis relay loop error, retrying in 5s: %s", exc)
            await asyncio.sleep(5)
