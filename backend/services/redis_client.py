"""Optional Redis connection, used for two independent purposes:

1. Fanning WebSocket broadcasts out across more than one uvicorn worker process (see
   services/ws_manager.py's module docstring for why that's needed — each worker only
   knows about its own connected clients). Uses the async client (`get_client()`),
   since ws_manager.py runs entirely inside the asyncio event loop.
2. Sharing market_data_provider.py's Yahoo/CoinGecko response caches across worker
   processes (`cache_get_json`/`cache_set_json`), so each worker doesn't independently
   re-fetch the same symbol from Yahoo Finance. Uses the sync client (`get_sync_client()`),
   since market_data_provider's functions are plain sync functions called both directly
   from request handlers and via ThreadPoolExecutor/asyncio.to_thread worker threads —
   a sync redis-py client (backed by a thread-safe connection pool) is the natural fit
   there, not the asyncio one used for the WS relay.

This module is deliberately a soft dependency throughout: every function here returns
None/False on any failure instead of raising, so a missing REDIS_URL, an unreachable
Redis, or a Redis that goes down mid-run all degrade gracefully — the WS relay falls
back to "this worker handles its own WebSocket clients only", and the shared cache
falls back to "each worker keeps its own in-process cache" (market_data_provider.py's
existing behavior, unchanged) — rather than crashing the app.
"""

import json
import logging

import redis as redis_sync
import redis.asyncio as redis

from config import settings

logger = logging.getLogger("uvicorn.error")

_client: "redis.Redis | None" = None
_client_initialized = False

_sync_client: "redis_sync.Redis | None" = None
_sync_client_initialized = False


def get_client() -> "redis.Redis | None":
    """Returns a lazily-created async Redis client, or None if REDIS_URL isn't set.
    redis.from_url() itself never connects eagerly (the client is just configuration
    until a command is issued), so this can't fail here — actual connection problems
    surface (and are caught) at the point of use, in ws_manager.py.
    """
    global _client, _client_initialized
    if not _client_initialized:
        _client_initialized = True
        if settings.redis_url:
            _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def get_sync_client() -> "redis_sync.Redis | None":
    """Sync counterpart of get_client(), for callers (market_data_provider.py) that
    aren't running inside the asyncio event loop. Same lazy/optional semantics."""
    global _sync_client, _sync_client_initialized
    if not _sync_client_initialized:
        _sync_client_initialized = True
        if settings.redis_url:
            _sync_client = redis_sync.from_url(settings.redis_url, decode_responses=True)
    return _sync_client


def reset_client_for_tests() -> None:
    """Test-only hook so tests can inject a fakeredis client (or swap REDIS_URL)
    without a previous test's real client lingering in module state.
    """
    global _client, _client_initialized, _sync_client, _sync_client_initialized
    _client = None
    _client_initialized = False
    _sync_client = None
    _sync_client_initialized = False


def cache_get_json(key: str):
    """Best-effort shared-cache read for market_data_provider.py's caches. Returns
    None on a cache miss, on any Redis error, and when Redis isn't configured at all —
    callers must treat all three identically to "not cached yet" and fall back to
    fetching (and to their own in-process cache).
    """
    client = get_sync_client()
    if client is None:
        return None
    try:
        raw = client.get(key)
    except Exception:
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def cache_set_json(key: str, value, ttl_seconds: int) -> None:
    """Best-effort shared-cache write, mirroring cache_get_json. A write failure (or
    Redis being unconfigured) is silently ignored — the caller's own in-process cache
    still has the value for this process, which is exactly today's pre-Redis behavior.
    """
    client = get_sync_client()
    if client is None:
        return
    try:
        client.set(key, json.dumps(value), ex=ttl_seconds)
    except Exception:
        pass
