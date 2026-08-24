from datetime import date
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from services import market_data_provider


COLUMNS = ["Open", "High", "Low", "Close", "Volume"]


def _history_frame(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    dates = pd.date_range("2026-01-01", periods=len(rows))
    df = pd.DataFrame(rows, index=dates)
    return df[COLUMNS]


def test_fetch_ohlcv_drops_trailing_nan_row():
    """A still-forming/incomplete session (today's bar) can come back as NaN OHLC —
    it should be dropped, not crash the whole fetch."""
    frame = _history_frame(
        [
            {"Open": 10, "High": 11, "Low": 9, "Close": 10.5, "Volume": 1000},
            {"Open": 10.5, "High": 12, "Low": 10, "Close": 11.5, "Volume": 1200},
            {"Open": np.nan, "High": np.nan, "Low": np.nan, "Close": np.nan, "Volume": 500},
        ]
    )
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = frame

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        bars = market_data_provider.fetch_ohlcv("TEST.IS", period="1y")

    assert len(bars) == 2
    assert bars[-1].close == 11.5


def test_fetch_ohlcv_falls_back_to_max_period_when_empty():
    empty = _history_frame([])
    full = _history_frame([{"Open": 5, "High": 6, "Low": 4, "Close": 5.5, "Volume": 100}])

    mock_ticker = MagicMock()
    mock_ticker.history.side_effect = [empty, full]

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        bars = market_data_provider.fetch_ohlcv("TEST.IS", period="1y")

    assert len(bars) == 1
    assert mock_ticker.history.call_count == 2
    assert mock_ticker.history.call_args_list[1].kwargs == {"period": "max"}


def test_fetch_ohlcv_raises_when_truly_no_data():
    empty = _history_frame([])
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = empty

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        with pytest.raises(ValueError):
            market_data_provider.fetch_ohlcv("TEST.IS", period="1y")


def test_fetch_ohlcv_raises_when_only_nan_rows_available():
    frame = _history_frame([{"Open": np.nan, "High": np.nan, "Low": np.nan, "Close": np.nan, "Volume": 10}])
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = frame

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        with pytest.raises(ValueError):
            market_data_provider.fetch_ohlcv("TEST.IS", period="max")


@pytest.fixture(autouse=True)
def _clear_market_data_caches():
    """get_quote/get_market_cap memoize by symbol in module-level dicts — clear
    them around every test so one test's fake data can't leak into another's
    (real usage relies on this same caching, so it can't just be removed)."""
    market_data_provider._ohlcv_cache.clear()
    market_data_provider._market_cap_cache.clear()
    market_data_provider._crypto_global_cache = None
    market_data_provider._crypto_global_last_attempt = 0.0
    market_data_provider._news_cache.clear()
    market_data_provider._fundamentals_cache.clear()
    market_data_provider._recommendations_cache.clear()
    market_data_provider._calendar_cache.clear()
    market_data_provider._holders_cache.clear()
    yield
    market_data_provider._ohlcv_cache.clear()
    market_data_provider._market_cap_cache.clear()
    market_data_provider._crypto_global_cache = None
    market_data_provider._crypto_global_last_attempt = 0.0
    market_data_provider._news_cache.clear()
    market_data_provider._fundamentals_cache.clear()
    market_data_provider._recommendations_cache.clear()
    market_data_provider._calendar_cache.clear()
    market_data_provider._holders_cache.clear()


def test_get_quote_computes_change_percent_from_last_two_bars():
    frame = _history_frame(
        [
            {"Open": 10, "High": 10.5, "Low": 9.5, "Close": 10.0, "Volume": 100},
            {"Open": 10, "High": 11, "Low": 9.9, "Close": 11.0, "Volume": 100},
        ]
    )
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = frame

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        quote = market_data_provider.get_quote("TEST-USD")

    assert quote["last_price"] == 11.0
    assert quote["change_percent"] == pytest.approx(10.0)


def test_fetch_ohlcv_cached_keys_by_period_not_just_symbol():
    """get_quote() calls fetch_ohlcv_cached(symbol, period="5d") — a symbol-only cache
    key would let that overwrite a same-symbol "1y" entry (e.g. the BIST 100 history
    chart / portfolio benchmark fetching XU100.IS) with only 5 days of data. Regression
    test for that: a short-period call must not evict/shadow a longer-period one for
    the same symbol.
    """
    short_frame = _history_frame([{"Open": 1, "High": 1, "Low": 1, "Close": 1, "Volume": 1}] * 5)
    long_frame = _history_frame([{"Open": 2, "High": 2, "Low": 2, "Close": 2, "Volume": 2}] * 200)

    with patch.object(market_data_provider.yf, "Ticker") as mock_ticker_cls:
        mock_ticker_cls.return_value.history.return_value = long_frame
        long_bars = market_data_provider.fetch_ohlcv_cached("XU100.IS", period="1y")

        mock_ticker_cls.return_value.history.return_value = short_frame
        short_bars = market_data_provider.fetch_ohlcv_cached("XU100.IS", period="5d")

        # Re-fetching "1y" should still hit its own cache entry (200 bars), unaffected
        # by the "5d" call for the same symbol in between.
        still_long_bars = market_data_provider.fetch_ohlcv_cached("XU100.IS", period="1y")

    assert len(long_bars) == 200
    assert len(short_bars) == 5
    assert len(still_long_bars) == 200


def test_get_quote_zero_change_with_only_one_bar():
    frame = _history_frame([{"Open": 5, "High": 5.5, "Low": 4.5, "Close": 5.0, "Volume": 10}])
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = frame

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        quote = market_data_provider.get_quote("TEST-USD")

    assert quote["last_price"] == 5.0
    assert quote["change_percent"] == 0.0


def test_get_quote_raises_when_symbol_has_no_data():
    mock_ticker = MagicMock()
    mock_ticker.history.return_value = _history_frame([])

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        with pytest.raises(ValueError):
            market_data_provider.get_quote("NOPE-USD")


def test_get_market_cap_returns_value_from_info():
    mock_ticker = MagicMock()
    mock_ticker.info = {"marketCap": 123456789}

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        assert market_data_provider.get_market_cap("TEST-USD") == 123456789.0


def test_get_market_cap_returns_none_when_missing():
    mock_ticker = MagicMock()
    mock_ticker.info = {}

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        assert market_data_provider.get_market_cap("TEST-USD") is None


def test_get_market_cap_returns_none_on_exception():
    with patch.object(market_data_provider.yf, "Ticker", side_effect=RuntimeError("boom")):
        assert market_data_provider.get_market_cap("TEST-USD") is None


def test_get_market_cap_is_cached_between_calls():
    mock_ticker = MagicMock()
    mock_ticker.info = {"marketCap": 42}

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        market_data_provider.get_market_cap("TEST-USD")
        market_data_provider.get_market_cap("TEST-USD")

    assert mock_cls.call_count == 1


def _mock_coingecko_response(
    btc_pct: float = 58.0, eth_pct: float = 11.0, total_usd: float = 2_600_000_000_000.0, change_24h: float = -2.4
):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "data": {
            "total_market_cap": {"usd": total_usd},
            "market_cap_change_percentage_24h_usd": change_24h,
            "market_cap_percentage": {"btc": btc_pct, "eth": eth_pct, "usdt": 5.0},
        }
    }
    mock_resp.raise_for_status.return_value = None
    return mock_resp


def test_get_crypto_global_stats_parses_real_shape():
    with patch.object(market_data_provider.requests, "get", return_value=_mock_coingecko_response()) as mock_get:
        stats = market_data_provider.get_crypto_global_stats()

    assert stats["total_market_cap_usd"] == pytest.approx(2_600_000_000_000.0)
    assert stats["market_cap_change_percentage_24h"] == pytest.approx(-2.4)
    assert stats["btc_dominance"] == pytest.approx(58.0)
    assert stats["eth_dominance"] == pytest.approx(11.0)
    assert stats["others_dominance"] == pytest.approx(31.0)
    mock_get.assert_called_once_with(market_data_provider.COINGECKO_GLOBAL_URL, timeout=10)


def test_get_crypto_global_stats_is_cached_between_calls():
    with patch.object(market_data_provider.requests, "get", return_value=_mock_coingecko_response()) as mock_get:
        market_data_provider.get_crypto_global_stats()
        market_data_provider.get_crypto_global_stats()

    assert mock_get.call_count == 1


def test_get_crypto_global_stats_raises_on_http_error():
    mock_resp = MagicMock()
    mock_resp.raise_for_status.side_effect = market_data_provider.requests.RequestException("boom")

    with patch.object(market_data_provider.requests, "get", return_value=mock_resp):
        with pytest.raises(market_data_provider.requests.RequestException):
            market_data_provider.get_crypto_global_stats()


def test_get_crypto_global_stats_does_not_retry_immediately_after_a_failure():
    """A failed attempt (e.g. CoinGecko's free endpoint rate-limiting us with a 429)
    must not be retried on every subsequent call within the cooldown window — that
    would hammer an already-rate-limited endpoint every time the broadcast loop ticks
    (every 60s) instead of backing off, and it would never recover.
    """
    mock_resp = MagicMock()
    mock_resp.raise_for_status.side_effect = market_data_provider.requests.RequestException("rate limited")

    with patch.object(market_data_provider.requests, "get", return_value=mock_resp) as mock_get:
        with pytest.raises(market_data_provider.requests.RequestException):
            market_data_provider.get_crypto_global_stats()
        with pytest.raises(RuntimeError):
            market_data_provider.get_crypto_global_stats()

    assert mock_get.call_count == 1


def _mock_yf_news_entry(
    title="Test Başlığı", url="https://finance.yahoo.com/news/test", publisher="Test Publisher", thumbnail=True
):
    content = {
        "title": title,
        "summary": "Kısa özet metni.",
        "pubDate": "2026-08-20T10:00:00Z",
        "provider": {"displayName": publisher},
        "clickThroughUrl": {"url": url},
        "canonicalUrl": {"url": url},
    }
    if thumbnail:
        content["thumbnail"] = {
            "originalUrl": "https://s.yimg.com/original.jpg",
            "resolutions": [{"url": "https://s.yimg.com/small.jpg", "width": 170, "height": 128}],
        }
    return {"id": f"id-{title}", "content": content}


def test_get_news_parses_real_shape():
    mock_ticker = MagicMock()
    mock_ticker.news = [_mock_yf_news_entry()]

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        items = market_data_provider.get_news("THYAO.IS")

    assert len(items) == 1
    item = items[0]
    assert item["title"] == "Test Başlığı"
    assert item["publisher"] == "Test Publisher"
    assert item["url"] == "https://finance.yahoo.com/news/test"
    assert item["published_at"] == "2026-08-20T10:00:00Z"
    assert item["thumbnail_url"] == "https://s.yimg.com/small.jpg"
    assert item["related_symbol"] == "THYAO.IS"


def test_get_news_skips_entries_without_title_or_url():
    mock_ticker = MagicMock()
    mock_ticker.news = [{"id": "bad", "content": {"title": "", "clickThroughUrl": {"url": "https://x.test"}}}]

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        items = market_data_provider.get_news("THYAO.IS")

    assert items == []


def test_get_news_falls_back_to_original_thumbnail_when_no_resolutions():
    mock_ticker = MagicMock()
    entry = _mock_yf_news_entry()
    entry["content"]["thumbnail"] = {"originalUrl": "https://s.yimg.com/original.jpg", "resolutions": []}
    mock_ticker.news = [entry]

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        items = market_data_provider.get_news("THYAO.IS")

    assert items[0]["thumbnail_url"] == "https://s.yimg.com/original.jpg"


def test_get_news_thumbnail_is_none_without_thumbnail_field():
    mock_ticker = MagicMock()
    mock_ticker.news = [_mock_yf_news_entry(thumbnail=False)]

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        items = market_data_provider.get_news("THYAO.IS")

    assert items[0]["thumbnail_url"] is None


def test_get_news_returns_empty_list_on_exception():
    with patch.object(market_data_provider.yf, "Ticker", side_effect=RuntimeError("boom")):
        assert market_data_provider.get_news("THYAO.IS") == []


def test_get_news_is_cached_between_calls():
    mock_ticker = MagicMock()
    mock_ticker.news = [_mock_yf_news_entry()]

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        market_data_provider.get_news("THYAO.IS")
        market_data_provider.get_news("THYAO.IS")

    assert mock_cls.call_count == 1


def test_get_news_cache_is_keyed_by_limit_not_just_symbol():
    """Regression test: a smaller `limit` call for the same symbol must not overwrite
    (or be served from) the cache entry a larger `limit` call already populated —
    same bug class the OHLCV cache's (symbol, period) keying already guards against."""
    mock_ticker = MagicMock()
    mock_ticker.news = [_mock_yf_news_entry(title="A"), _mock_yf_news_entry(title="B")]

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        many = market_data_provider.get_news("THYAO.IS", limit=6)
        few = market_data_provider.get_news("THYAO.IS", limit=1)

    assert len(many) == 2
    assert len(few) == 1
    assert mock_cls.call_count == 2

    # the limit=6 entry must still be intact, not truncated by the limit=1 call
    cached_many = market_data_provider._news_cache[("THYAO.IS", 6)][1]
    assert len(cached_many) == 2


def test_get_fundamentals_parses_real_shape():
    mock_ticker = MagicMock()
    mock_ticker.info = {
        "trailingPE": 12.5,
        "forwardPE": 10.1,
        "priceToBook": 2.3,
        "priceToSalesTrailing12Months": 1.4,
        "profitMargins": 0.18,
        "returnOnEquity": 0.22,
        "debtToEquity": 45.0,
        "dividendYield": 0.03,
        "beta": 1.1,
        "targetLowPrice": 90.0,
        "targetMeanPrice": 110.0,
        "targetHighPrice": 130.0,
        "recommendationKey": "buy",
        "recommendationMean": 2.1,
        "numberOfAnalystOpinions": 14,
    }

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        result = market_data_provider.get_fundamentals("TEST.IS")

    assert result["trailing_pe"] == 12.5
    assert result["price_to_book"] == 2.3
    assert result["recommendation_key"] == "buy"
    assert result["number_of_analyst_opinions"] == 14


def test_get_fundamentals_missing_fields_are_none_not_fabricated():
    mock_ticker = MagicMock()
    mock_ticker.info = {}

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        result = market_data_provider.get_fundamentals("TEST.IS")

    assert result["trailing_pe"] is None
    assert result["recommendation_key"] is None


def test_get_fundamentals_returns_none_on_exception():
    with patch.object(market_data_provider.yf, "Ticker", side_effect=RuntimeError("boom")):
        assert market_data_provider.get_fundamentals("TEST.IS") is None


def test_get_fundamentals_is_cached_between_calls():
    mock_ticker = MagicMock()
    mock_ticker.info = {"trailingPE": 12.5}

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker) as mock_cls:
        market_data_provider.get_fundamentals("TEST.IS")
        market_data_provider.get_fundamentals("TEST.IS")

    assert mock_cls.call_count == 1


def test_get_recommendations_trend_parses_real_shape():
    mock_ticker = MagicMock()
    mock_ticker.recommendations = pd.DataFrame(
        [
            {"period": "0m", "strongBuy": 5, "buy": 8, "hold": 3, "sell": 1, "strongSell": 0},
            {"period": "-1m", "strongBuy": 4, "buy": 9, "hold": 3, "sell": 1, "strongSell": 0},
        ]
    )

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        result = market_data_provider.get_recommendations_trend("TEST.IS")

    assert len(result) == 2
    assert result[0] == {"period": "0m", "strong_buy": 5, "buy": 8, "hold": 3, "sell": 1, "strong_sell": 0}


def test_get_recommendations_trend_empty_when_no_coverage():
    mock_ticker = MagicMock()
    mock_ticker.recommendations = pd.DataFrame()

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        assert market_data_provider.get_recommendations_trend("TEST.IS") == []


def test_get_recommendations_trend_returns_empty_on_exception():
    with patch.object(market_data_provider.yf, "Ticker", side_effect=RuntimeError("boom")):
        assert market_data_provider.get_recommendations_trend("TEST.IS") == []


def test_get_earnings_calendar_parses_real_shape():
    mock_ticker = MagicMock()
    mock_ticker.calendar = {
        "Earnings Date": [date(2026, 9, 15), date(2026, 9, 16)],
        "Earnings High": 3.2,
        "Earnings Low": 2.8,
        "Earnings Average": 3.0,
        "Revenue High": 500_000_000,
        "Revenue Low": 450_000_000,
        "Revenue Average": 475_000_000,
    }

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        result = market_data_provider.get_earnings_calendar("TEST.IS")

    assert result["earnings_date"] == "2026-09-15"
    assert result["earnings_average"] == 3.0
    assert result["revenue_average"] == 475_000_000


def test_get_earnings_calendar_none_when_no_scheduled_earnings():
    mock_ticker = MagicMock()
    mock_ticker.calendar = {}

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        assert market_data_provider.get_earnings_calendar("TEST.IS") is None


def test_get_earnings_calendar_returns_none_on_exception():
    with patch.object(market_data_provider.yf, "Ticker", side_effect=RuntimeError("boom")):
        assert market_data_provider.get_earnings_calendar("TEST.IS") is None


def test_get_institutional_holders_parses_real_shape():
    mock_ticker = MagicMock()
    mock_ticker.major_holders = pd.DataFrame(
        {"Value": [0.05, 0.72]}, index=["insidersPercentHeld", "institutionsPercentHeld"]
    )
    mock_ticker.institutional_holders = pd.DataFrame(
        [
            {
                "Date Reported": pd.Timestamp("2026-06-30"),
                "Holder": "Vanguard Group Inc",
                "Shares": 1_000_000,
                "Value": 50_000_000,
                "pctHeld": 0.045,
            }
        ]
    )

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        result = market_data_provider.get_institutional_holders("TEST.IS")

    assert result["insider_percent"] == 0.05
    assert result["institutions_percent"] == 0.72
    assert len(result["top_holders"]) == 1
    assert result["top_holders"][0]["holder"] == "Vanguard Group Inc"
    assert result["top_holders"][0]["date_reported"] == "2026-06-30"


def test_get_institutional_holders_none_when_no_data():
    mock_ticker = MagicMock()
    mock_ticker.major_holders = pd.DataFrame()
    mock_ticker.institutional_holders = pd.DataFrame()

    with patch.object(market_data_provider.yf, "Ticker", return_value=mock_ticker):
        assert market_data_provider.get_institutional_holders("TEST.IS") is None


def test_get_institutional_holders_returns_none_on_exception():
    with patch.object(market_data_provider.yf, "Ticker", side_effect=RuntimeError("boom")):
        assert market_data_provider.get_institutional_holders("TEST.IS") is None
