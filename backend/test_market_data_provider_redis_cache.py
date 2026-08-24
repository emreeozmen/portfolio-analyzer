"""Exercises market_data_provider.py's Redis-backed shared cache layer against
fakeredis's sync client — a real in-memory implementation, not a mock of individual
calls — so this proves a second "worker" (simulated by clearing the in-process dict
cache while keeping the same fake Redis) reuses the first worker's fetch instead of
hitting Yahoo/CoinGecko again. No real Redis server involved or required.
"""

from unittest.mock import MagicMock, patch

import fakeredis
import pandas as pd
import pytest

from services import market_data_provider, redis_client


@pytest.fixture(autouse=True)
def _reset_redis_client():
    redis_client.reset_client_for_tests()
    yield
    redis_client.reset_client_for_tests()


@pytest.fixture(autouse=True)
def _clear_local_caches():
    market_data_provider._ohlcv_cache.clear()
    market_data_provider._fx_cache.clear()
    market_data_provider._market_cap_cache.clear()
    market_data_provider._dividends_cache.clear()
    market_data_provider._news_cache.clear()
    market_data_provider._crypto_global_cache = None
    yield
    market_data_provider._ohlcv_cache.clear()
    market_data_provider._fx_cache.clear()
    market_data_provider._market_cap_cache.clear()
    market_data_provider._dividends_cache.clear()
    market_data_provider._news_cache.clear()
    market_data_provider._crypto_global_cache = None


@pytest.fixture
def fake_redis():
    client = fakeredis.FakeRedis(decode_responses=True)
    redis_client._sync_client = client
    redis_client._sync_client_initialized = True
    yield client


def _history_frame(rows: list[dict]) -> pd.DataFrame:
    dates = pd.date_range("2026-01-01", periods=len(rows))
    df = pd.DataFrame(rows, index=dates)
    return df[["Open", "High", "Low", "Close", "Volume"]]


def test_fetch_ohlcv_cached_shares_across_local_cache_clears_via_redis(fake_redis):
    frame = _history_frame([{"Open": 1, "High": 2, "Low": 0.5, "Close": 1.5, "Volume": 100}])
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = frame

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        first = market_data_provider.fetch_ohlcv_cached("TEST.IS", period="1y")
        # Simulate a second worker process: its own in-process cache starts empty,
        # but it shares the same Redis.
        market_data_provider._ohlcv_cache.clear()
        second = market_data_provider.fetch_ohlcv_cached("TEST.IS", period="1y")

    assert mock_cls.call_count == 1  # Yahoo was only actually hit once
    assert [b.close for b in first] == [b.close for b in second] == [1.5]


def test_get_market_cap_shares_via_redis(fake_redis):
    mock_ticker = MagicMock()
    mock_ticker.info = {"marketCap": 999}

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        market_data_provider.get_market_cap("TEST.IS")
        market_data_provider._market_cap_cache.clear()
        result = market_data_provider.get_market_cap("TEST.IS")

    assert mock_cls.call_count == 1
    assert result == 999.0


def test_get_dividends_shares_via_redis(fake_redis):
    series = pd.Series([1.25], index=pd.to_datetime(["2026-02-01"]))
    mock_ticker = MagicMock()
    mock_ticker.dividends = series

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        market_data_provider.get_dividends("TEST.IS")
        market_data_provider._dividends_cache.clear()
        result = market_data_provider.get_dividends("TEST.IS")

    assert mock_cls.call_count == 1
    assert result == [(pd.Timestamp("2026-02-01").date(), 1.25)]


def test_get_crypto_global_stats_shares_via_redis(fake_redis):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "data": {
            "total_market_cap": {"usd": 1_000_000.0},
            "market_cap_change_percentage_24h_usd": 1.0,
            "market_cap_percentage": {"btc": 50.0, "eth": 10.0},
        }
    }
    mock_resp.raise_for_status.return_value = None

    with patch.object(market_data_provider.requests, "get", return_value=mock_resp) as mock_get:
        market_data_provider.get_crypto_global_stats()
        market_data_provider._crypto_global_cache = None
        result = market_data_provider.get_crypto_global_stats()

    assert mock_get.call_count == 1
    assert result["total_market_cap_usd"] == 1_000_000.0


def test_get_news_shares_via_redis(fake_redis):
    raw_entry = {
        "id": "abc123",
        "content": {
            "title": "Test Headline",
            "summary": "Test summary",
            "provider": {"displayName": "Yahoo Finance"},
            "pubDate": "2026-01-01T00:00:00Z",
            "clickThroughUrl": {"url": "https://example.com/article"},
            "thumbnail": {"resolutions": [{"url": "https://example.com/thumb.jpg"}]},
        },
    }
    mock_ticker = MagicMock()
    mock_ticker.news = [raw_entry]

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        first = market_data_provider.get_news("TEST.IS")
        # Simulate a second worker process: its own in-process cache starts empty.
        market_data_provider._news_cache.clear()
        second = market_data_provider.get_news("TEST.IS")

    assert mock_cls.call_count == 1  # Yahoo was only actually hit once
    assert first == second
    assert first[0]["title"] == "Test Headline"


def test_get_fx_rate_shares_via_redis(fake_redis):
    mock_ticker = MagicMock()
    mock_ticker.fast_info = {"lastPrice": 32.5}

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        first = market_data_provider.get_fx_rate("USD", "TRY")
        # Simulate a second worker process: its own in-process cache starts empty.
        market_data_provider._fx_cache.clear()
        second = market_data_provider.get_fx_rate("USD", "TRY")

    assert mock_cls.call_count == 1  # Yahoo was only actually hit once
    assert first == second == 32.5


def test_shared_cache_is_a_noop_without_redis_configured():
    """Without REDIS_URL set (the default), cache_get_json/cache_set_json must be
    silent no-ops so behavior is identical to before this feature existed."""
    frame = _history_frame([{"Open": 1, "High": 2, "Low": 0.5, "Close": 1.5, "Volume": 100}])
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = frame

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        market_data_provider.fetch_ohlcv_cached("TEST.IS", period="1y")
        market_data_provider._ohlcv_cache.clear()
        market_data_provider.fetch_ohlcv_cached("TEST.IS", period="1y")

    assert mock_cls.call_count == 2  # no shared cache available, so the second call refetches
