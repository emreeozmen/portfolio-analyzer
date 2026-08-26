"""Fetches real market data from Yahoo Finance (via yfinance for OHLCV bars,
and Yahoo's public search endpoint for symbol lookup). This is the live
counterpart to data/seed_prices.py's synthetic data — price_service calls
into this module and writes results into the price_history table, so the
rest of the app never talks to Yahoo Finance directly.
"""

import logging
import time
from dataclasses import dataclass
from datetime import date

import requests
import sentry_sdk
import yfinance as yf

from services import redis_client

logger = logging.getLogger("uvicorn.error")

BIST_SUFFIX = ".IS"  # Yahoo Finance's suffix for Borsa Istanbul tickers
SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
BIST100_SYMBOL = "XU100.IS"  # BIST 100 index, used as the portfolio benchmark

_ohlcv_cache: dict[tuple[str, str], tuple[float, "list[OhlcvBar]"]] = {}
_CACHE_TTL_SECONDS = 900  # avoid hammering Yahoo Finance on every portfolio-analysis view

_fx_cache: dict[tuple[str, str], tuple[float, float]] = {}
_FX_CACHE_TTL_SECONDS = 900


@dataclass
class OhlcvBar:
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class SymbolResult:
    yahoo_symbol: str
    ticker: str
    name: str
    exchange: str


def get_currency(yahoo_symbol: str) -> str:
    """Best-effort lookup of the trading currency for a symbol (e.g. 'USD', 'TRY')."""
    try:
        fast_info = yf.Ticker(yahoo_symbol).fast_info
        currency = fast_info.get("currency")
    except Exception:
        currency = None
    return currency or "USD"


def get_fx_rate(from_currency: str, to_currency: str) -> float | None:
    """Best-effort spot FX rate for converting an amount in from_currency into
    to_currency (1 from_currency = N to_currency), via Yahoo Finance's
    "{FROM}{TO}=X" currency-pair symbols. Returns None if the pair can't be
    resolved — callers must degrade gracefully (skip conversion) rather than
    fabricate a rate.
    """
    from_currency = from_currency.upper()
    to_currency = to_currency.upper()
    if from_currency == to_currency:
        return 1.0

    cache_key = (from_currency, to_currency)
    now = time.time()
    cached = _fx_cache.get(cache_key)
    if cached and now - cached[0] < _FX_CACHE_TTL_SECONDS:
        return cached[1]

    redis_key = f"pa:cache:fx:{from_currency}:{to_currency}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        _fx_cache[cache_key] = (now, shared)
        return shared

    try:
        fast_info = yf.Ticker(f"{from_currency}{to_currency}=X").fast_info
        rate = fast_info.get("lastPrice")
    except Exception:
        rate = None

    if rate is None:
        return None
    _fx_cache[cache_key] = (now, float(rate))
    redis_client.cache_set_json(redis_key, float(rate), _FX_CACHE_TTL_SECONDS)
    return float(rate)


_market_cap_cache: dict[str, tuple[float, float | None]] = {}
_MARKET_CAP_CACHE_TTL_SECONDS = 6 * 60 * 60  # market cap ranking doesn't need to be live-fresh


def get_market_cap(yahoo_symbol: str) -> float | None:
    """Best-effort market cap via yfinance's slower `.info` endpoint, cached for
    6h since this is only used for ranking display order, not a live figure.
    Returns None (never a guessed value) if unavailable.
    """
    now = time.time()
    cached = _market_cap_cache.get(yahoo_symbol)
    if cached and now - cached[0] < _MARKET_CAP_CACHE_TTL_SECONDS:
        return cached[1]

    # Only a non-None hit is trusted here — cache_get_json can't distinguish "not
    # cached" from "cached as null" (market cap genuinely unavailable), so an
    # unavailable market cap is simply retried more often across processes rather
    # than shared, which is an acceptable, harmless degradation.
    redis_key = f"pa:cache:marketcap:{yahoo_symbol}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        _market_cap_cache[yahoo_symbol] = (now, shared)
        return shared

    try:
        market_cap = yf.Ticker(yahoo_symbol).info.get("marketCap")
    except Exception as exc:
        logger.warning("market cap lookup failed for %s: %r", yahoo_symbol, exc)
        sentry_sdk.capture_exception(exc)
        market_cap = None

    market_cap = float(market_cap) if market_cap else None
    _market_cap_cache[yahoo_symbol] = (now, market_cap)
    redis_client.cache_set_json(redis_key, market_cap, _MARKET_CAP_CACHE_TTL_SECONDS)
    return market_cap


def get_sector(yahoo_symbol: str) -> str | None:
    """Best-effort sector lookup (e.g. 'Technology', 'Financial Services') via
    yfinance's slower `.info` endpoint — called once per asset at track/refresh
    time, not on every request. Returns None (never a made-up value) if
    unavailable.
    """
    try:
        sector = yf.Ticker(yahoo_symbol).info.get("sector")
    except Exception as exc:
        logger.warning("sector lookup failed for %s: %r", yahoo_symbol, exc)
        sentry_sdk.capture_exception(exc)
        return None
    return sector or None


_fundamentals_cache: dict[str, tuple[float, dict | None]] = {}
_recommendations_cache: dict[str, tuple[float, list[dict]]] = {}
_calendar_cache: dict[str, tuple[float, dict | None]] = {}
_holders_cache: dict[str, tuple[float, dict | None]] = {}
_FUNDAMENTALS_CACHE_TTL_SECONDS = 6 * 60 * 60  # valuation/analyst/holders data doesn't need to be live-fresh


def get_fundamentals(yahoo_symbol: str) -> dict | None:
    """Best-effort valuation/profitability ratios plus the analyst target-price summary,
    via yfinance's slower `.info` endpoint (a single call covers all of these fields at
    once). Returns None (never a guessed ratio) if the lookup fails entirely; individual
    fields are None when Yahoo doesn't carry them for this symbol (common for BIST
    tickers, which have thin analyst coverage) rather than fabricated.
    """
    now = time.time()
    cached = _fundamentals_cache.get(yahoo_symbol)
    if cached and now - cached[0] < _FUNDAMENTALS_CACHE_TTL_SECONDS:
        return cached[1]

    redis_key = f"pa:cache:fundamentals:{yahoo_symbol}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        _fundamentals_cache[yahoo_symbol] = (now, shared)
        return shared

    try:
        info = yf.Ticker(yahoo_symbol).info

        def _num(key: str) -> float | None:
            value = info.get(key)
            return float(value) if isinstance(value, (int, float)) else None

        result = {
            "trailing_pe": _num("trailingPE"),
            "forward_pe": _num("forwardPE"),
            "price_to_book": _num("priceToBook"),
            "price_to_sales": _num("priceToSalesTrailing12Months"),
            "profit_margin": _num("profitMargins"),
            "return_on_equity": _num("returnOnEquity"),
            "debt_to_equity": _num("debtToEquity"),
            "dividend_yield": _num("dividendYield"),
            "beta": _num("beta"),
            "target_low_price": _num("targetLowPrice"),
            "target_mean_price": _num("targetMeanPrice"),
            "target_high_price": _num("targetHighPrice"),
            "recommendation_key": info.get("recommendationKey"),
            "recommendation_mean": _num("recommendationMean"),
            "number_of_analyst_opinions": (
                int(info["numberOfAnalystOpinions"]) if isinstance(info.get("numberOfAnalystOpinions"), (int, float)) else None
            ),
        }
    except Exception as exc:
        logger.warning("fundamentals lookup failed for %s: %r", yahoo_symbol, exc)
        sentry_sdk.capture_exception(exc)
        result = None

    _fundamentals_cache[yahoo_symbol] = (now, result)
    redis_client.cache_set_json(redis_key, result, _FUNDAMENTALS_CACHE_TTL_SECONDS)
    return result


def get_recommendations_trend(yahoo_symbol: str) -> list[dict]:
    """Analyst recommendation counts (strong buy/buy/hold/sell/strong sell) by recent
    period, via yfinance's `Ticker.recommendations`. Returns [] (never a fabricated
    distribution) if the symbol has no analyst coverage.
    """
    now = time.time()
    cached = _recommendations_cache.get(yahoo_symbol)
    if cached and now - cached[0] < _FUNDAMENTALS_CACHE_TTL_SECONDS:
        return cached[1]

    redis_key = f"pa:cache:recommendations:{yahoo_symbol}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        _recommendations_cache[yahoo_symbol] = (now, shared)
        return shared

    try:
        df = yf.Ticker(yahoo_symbol).recommendations
        rows = [] if df is None or df.empty else df.to_dict("records")
    except Exception as exc:
        logger.warning("recommendations lookup failed for %s: %r", yahoo_symbol, exc)
        sentry_sdk.capture_exception(exc)
        rows = []

    result = [
        {
            "period": row.get("period"),
            "strong_buy": int(row.get("strongBuy") or 0),
            "buy": int(row.get("buy") or 0),
            "hold": int(row.get("hold") or 0),
            "sell": int(row.get("sell") or 0),
            "strong_sell": int(row.get("strongSell") or 0),
        }
        for row in rows
    ]

    _recommendations_cache[yahoo_symbol] = (now, result)
    redis_client.cache_set_json(redis_key, result, _FUNDAMENTALS_CACHE_TTL_SECONDS)
    return result


def get_earnings_calendar(yahoo_symbol: str) -> dict | None:
    """Next earnings date plus the analyst revenue/earnings estimate range for it, via
    yfinance's `Ticker.calendar`. Returns None (never a guessed date) if the symbol has
    no scheduled earnings event on record.
    """
    now = time.time()
    cached = _calendar_cache.get(yahoo_symbol)
    if cached and now - cached[0] < _FUNDAMENTALS_CACHE_TTL_SECONDS:
        return cached[1]

    redis_key = f"pa:cache:calendar:{yahoo_symbol}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        _calendar_cache[yahoo_symbol] = (now, shared)
        return shared

    try:
        calendar = yf.Ticker(yahoo_symbol).calendar or {}
        earnings_dates = calendar.get("Earnings Date") or []
        next_date = earnings_dates[0] if earnings_dates else None
        result = (
            {
                "earnings_date": next_date.isoformat() if hasattr(next_date, "isoformat") else None,
                "earnings_low": calendar.get("Earnings Low"),
                "earnings_high": calendar.get("Earnings High"),
                "earnings_average": calendar.get("Earnings Average"),
                "revenue_low": calendar.get("Revenue Low"),
                "revenue_high": calendar.get("Revenue High"),
                "revenue_average": calendar.get("Revenue Average"),
            }
            if next_date is not None
            else None
        )
    except Exception as exc:
        logger.warning("earnings calendar lookup failed for %s: %r", yahoo_symbol, exc)
        sentry_sdk.capture_exception(exc)
        result = None

    _calendar_cache[yahoo_symbol] = (now, result)
    redis_client.cache_set_json(redis_key, result, _FUNDAMENTALS_CACHE_TTL_SECONDS)
    return result


def get_institutional_holders(yahoo_symbol: str) -> dict | None:
    """Insider/institutional ownership percentages plus the largest real institutional
    holders on record, via yfinance's `Ticker.major_holders`/`Ticker.institutional_holders`.
    Returns None (never a guessed percentage) if neither is available for this symbol —
    common for BIST tickers, which Yahoo covers much more thinly than US large-caps.
    """
    now = time.time()
    cached = _holders_cache.get(yahoo_symbol)
    if cached and now - cached[0] < _FUNDAMENTALS_CACHE_TTL_SECONDS:
        return cached[1]

    redis_key = f"pa:cache:holders:{yahoo_symbol}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        _holders_cache[yahoo_symbol] = (now, shared)
        return shared

    try:
        ticker = yf.Ticker(yahoo_symbol)

        insider_percent = None
        institutions_percent = None
        try:
            major = ticker.major_holders
            if major is not None and not major.empty:
                if "insidersPercentHeld" in major.index:
                    insider_percent = float(major.loc["insidersPercentHeld", "Value"])
                if "institutionsPercentHeld" in major.index:
                    institutions_percent = float(major.loc["institutionsPercentHeld", "Value"])
        except Exception:
            pass

        top_holders: list[dict] = []
        try:
            institutional = ticker.institutional_holders
            if institutional is not None and not institutional.empty:
                for _, row in institutional.head(10).iterrows():
                    reported = row.get("Date Reported")
                    top_holders.append(
                        {
                            "holder": row.get("Holder"),
                            "shares": float(row["Shares"]) if row.get("Shares") is not None else None,
                            "date_reported": reported.date().isoformat() if hasattr(reported, "date") else None,
                            "percent_out": float(row["pctHeld"]) if row.get("pctHeld") is not None else None,
                            "value": float(row["Value"]) if row.get("Value") is not None else None,
                        }
                    )
        except Exception:
            pass

        result = (
            {"insider_percent": insider_percent, "institutions_percent": institutions_percent, "top_holders": top_holders}
            if insider_percent is not None or institutions_percent is not None or top_holders
            else None
        )
    except Exception as exc:
        logger.warning("institutional holders lookup failed for %s: %r", yahoo_symbol, exc)
        sentry_sdk.capture_exception(exc)
        result = None

    _holders_cache[yahoo_symbol] = (now, result)
    redis_client.cache_set_json(redis_key, result, _FUNDAMENTALS_CACHE_TTL_SECONDS)
    return result


_dividends_cache: dict[str, tuple[float, "list[tuple[date, float]]"]] = {}
_DIVIDENDS_CACHE_TTL_SECONDS = 900


def get_dividends(yahoo_symbol: str) -> list[tuple[date, float]]:
    """Real per-share cash dividend payments (ex-dividend date, amount) via yfinance,
    cached like fetch_ohlcv_cached since this is a network call. Returns an empty list
    (never a guessed figure) if the symbol pays no dividends or the lookup fails —
    used by portfolio_service to compute actual dividend income received on a holding.
    """
    now = time.time()
    cached = _dividends_cache.get(yahoo_symbol)
    if cached and now - cached[0] < _DIVIDENDS_CACHE_TTL_SECONDS:
        return cached[1]

    redis_key = f"pa:cache:dividends:{yahoo_symbol}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        payments = [(date.fromisoformat(d), amount) for d, amount in shared]
        _dividends_cache[yahoo_symbol] = (now, payments)
        return payments

    try:
        series = yf.Ticker(yahoo_symbol).dividends
        payments = [(idx.date(), float(amount)) for idx, amount in series.items()]
    except Exception:
        payments = []

    _dividends_cache[yahoo_symbol] = (now, payments)
    redis_client.cache_set_json(
        redis_key, [[d.isoformat(), amount] for d, amount in payments], _DIVIDENDS_CACHE_TTL_SECONDS
    )
    return payments


_news_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}
_NEWS_CACHE_TTL_SECONDS = 900  # news doesn't need to be second-fresh; also keeps us polite to Yahoo


def get_news(yahoo_symbol: str, limit: int = 6) -> list[dict]:
    """Real headlines for a symbol via yfinance's `Ticker.news` (Yahoo Finance's own
    news feed) — title, summary, publisher, publish time, article link, and thumbnail
    are all real fields straight from the feed, nothing synthesized. Returns [] (never
    a fabricated headline) if the symbol has no news or the lookup fails. Cached like
    fetch_ohlcv_cached since this is a network call shared across every homepage
    visitor, not refetched per request. Keyed on (symbol, limit) — not symbol alone —
    since a smaller `limit` call would otherwise silently overwrite a larger cached
    list for the same symbol; see fetch_ohlcv_cached's docstring for the same bug class.
    """
    now = time.time()
    cache_key = (yahoo_symbol, limit)
    cached = _news_cache.get(cache_key)
    if cached and now - cached[0] < _NEWS_CACHE_TTL_SECONDS:
        return cached[1]

    redis_key = f"pa:cache:news:{yahoo_symbol}:{limit}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        _news_cache[cache_key] = (now, shared)
        return shared

    try:
        raw = yf.Ticker(yahoo_symbol).news
    except Exception:
        raw = []

    items = []
    for entry in raw[:limit]:
        content = entry.get("content") or {}
        url = (content.get("clickThroughUrl") or {}).get("url") or (content.get("canonicalUrl") or {}).get("url")
        title = content.get("title")
        if not title or not url:
            continue  # a headline with no real article link isn't usable

        thumbnail = content.get("thumbnail") or {}
        resolutions = thumbnail.get("resolutions") or []
        thumbnail_url = resolutions[0]["url"] if resolutions else thumbnail.get("originalUrl")

        items.append(
            {
                "id": entry.get("id") or content.get("id") or url,
                "title": title,
                "summary": content.get("summary") or "",
                "publisher": (content.get("provider") or {}).get("displayName") or "Yahoo Finance",
                "url": url,
                "published_at": content.get("pubDate"),
                "thumbnail_url": thumbnail_url,
                "related_symbol": yahoo_symbol,
            }
        )

    _news_cache[cache_key] = (now, items)
    redis_client.cache_set_json(redis_key, items, _NEWS_CACHE_TTL_SECONDS)
    return items


def fetch_ohlcv(yahoo_symbol: str, period: str = "1y") -> list[OhlcvBar]:
    history = yf.Ticker(yahoo_symbol).history(period=period)

    if history.empty and period != "max":
        # Some real, valid symbols (recent IPOs, thinly-traded tickers) come back empty
        # for a fixed lookback window even though Yahoo does have history for them —
        # fall back to "max" (yfinance's full available history) before giving up, so
        # we show whatever real data exists instead of erroring the whole track/refresh.
        history = yf.Ticker(yahoo_symbol).history(period="max")

    if history.empty:
        raise ValueError(f"Yahoo Finance'ten '{yahoo_symbol}' için veri alınamadı")

    # The most recent bar (today's still-forming session, or a no-trade day for a
    # thin ticker) can come back with NaN OHLC values — a real NaN, not a fabricated
    # number, so we simply drop that unusable row rather than writing NaN into the
    # database (which MSSQL's driver rejects outright, failing the entire batch).
    history = history.dropna(subset=["Open", "High", "Low", "Close"])

    if history.empty:
        raise ValueError(f"Yahoo Finance'ten '{yahoo_symbol}' için kullanılabilir veri alınamadı")

    return [
        OhlcvBar(
            # Rounded to 8dp, not 2 — 2dp was fine for share prices but silently
            # zeroed out sub-cent assets (e.g. SHIB at ~$0.000009) once crypto
            # symbols started flowing through this same fetch path.
            date=idx.date(),
            open=round(float(row["Open"]), 8),
            high=round(float(row["High"]), 8),
            low=round(float(row["Low"]), 8),
            close=round(float(row["Close"]), 8),
            volume=float(row["Volume"]),
        )
        for idx, row in history.iterrows()
    ]


def fetch_ohlcv_cached(yahoo_symbol: str, period: str = "1y") -> list[OhlcvBar]:
    """Same as fetch_ohlcv but memoized briefly in-process — used for the BIST 100
    benchmark overlay, which would otherwise re-fetch on every portfolio view.

    Cache key is (symbol, period), not just symbol — get_quote() calls this with
    period="5d" for lightweight quotes, and a symbol-only key let that overwrite a
    same-symbol "1y" entry (e.g. XU100.IS, fetched elsewhere for the BIST 100 history
    chart/portfolio benchmark) with only 5 days of data, silently truncating it until
    the cache expired. This was a latent bug even before WebSocket broadcasting made
    get_quote("XU100.IS") run on a recurring background loop instead of only per
    request — that just made it fire reliably enough to actually notice.
    """
    now = time.time()
    cache_key = (yahoo_symbol, period)
    cached = _ohlcv_cache.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    redis_key = f"pa:cache:ohlcv:{yahoo_symbol}:{period}"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        bars = [
            OhlcvBar(
                date=date.fromisoformat(b["date"]),
                open=b["open"],
                high=b["high"],
                low=b["low"],
                close=b["close"],
                volume=b["volume"],
            )
            for b in shared
        ]
        _ohlcv_cache[cache_key] = (now, bars)
        return bars

    bars = fetch_ohlcv(yahoo_symbol, period)
    _ohlcv_cache[cache_key] = (now, bars)
    redis_client.cache_set_json(
        redis_key,
        [
            {"date": b.date.isoformat(), "open": b.open, "high": b.high, "low": b.low, "close": b.close, "volume": b.volume}
            for b in bars
        ],
        _CACHE_TTL_SECONDS,
    )
    return bars


def get_quote(yahoo_symbol: str) -> dict:
    """Last close + daily change for a symbol that isn't a tracked Asset row —
    used for lightweight reference panels (FX pairs, the crypto leaderboard)
    that don't belong in the user-facing tracked-asset universe. Reuses
    fetch_ohlcv_cached rather than yfinance's fast_info so it gets the same
    NaN-handling / "1y then max" fallback robustness as everything else.
    """
    bars = fetch_ohlcv_cached(yahoo_symbol, period="5d")
    if not bars:
        raise ValueError(f"'{yahoo_symbol}' için veri alınamadı")
    last = bars[-1]
    prev = bars[-2] if len(bars) > 1 else last
    change_percent = ((last.close - prev.close) / prev.close * 100) if prev.close else 0.0
    return {"last_price": last.close, "change_percent": change_percent, "date": last.date.isoformat()}


COINGECKO_GLOBAL_URL = "https://api.coingecko.com/api/v3/global"
_crypto_global_cache: tuple[float, dict] | None = None
_CRYPTO_GLOBAL_CACHE_TTL_SECONDS = 300  # CoinGecko's free, key-less endpoint is rate-limited by IP
_crypto_global_last_attempt = 0.0
# Without this, a single 429 leaves _crypto_global_cache permanently unset, and every
# subsequent call (the broadcast loop calls this every 60s) immediately retries CoinGecko
# instead of respecting the cache TTL — hammering an endpoint that's already rate-limiting
# us, so it can never recover. This cooldown applies to failed attempts specifically,
# separately from the success cache above.
_CRYPTO_GLOBAL_RETRY_COOLDOWN_SECONDS = 300


def get_crypto_global_stats() -> dict:
    """Total crypto market cap, its 24h change, and BTC/ETH/other dominance — real,
    live figures from CoinGecko's free, key-less /global endpoint (not available on
    Yahoo Finance at all). Cached briefly since this is a public, rate-limited endpoint
    shared across every visitor, not fetched per-request. Raises on failure — callers
    degrade gracefully (omit the card) rather than fabricate a figure.
    """
    global _crypto_global_cache, _crypto_global_last_attempt
    now = time.time()
    if _crypto_global_cache and now - _crypto_global_cache[0] < _CRYPTO_GLOBAL_CACHE_TTL_SECONDS:
        return _crypto_global_cache[1]

    redis_key = "pa:cache:crypto-global"
    shared = redis_client.cache_get_json(redis_key)
    if shared is not None:
        _crypto_global_cache = (now, shared)
        return shared

    if now - _crypto_global_last_attempt < _CRYPTO_GLOBAL_RETRY_COOLDOWN_SECONDS:
        raise RuntimeError("CoinGecko global stats recently failed; waiting out the cooldown before retrying")
    _crypto_global_last_attempt = now

    resp = requests.get(COINGECKO_GLOBAL_URL, timeout=10)
    resp.raise_for_status()
    data = resp.json()["data"]

    market_cap_percentage = data.get("market_cap_percentage", {})
    btc_dominance = float(market_cap_percentage.get("btc", 0.0))
    eth_dominance = float(market_cap_percentage.get("eth", 0.0))

    result = {
        "total_market_cap_usd": float(data["total_market_cap"]["usd"]),
        "market_cap_change_percentage_24h": float(data["market_cap_change_percentage_24h_usd"]),
        "btc_dominance": btc_dominance,
        "eth_dominance": eth_dominance,
        "others_dominance": max(0.0, 100.0 - btc_dominance - eth_dominance),
    }
    _crypto_global_cache = (now, result)
    redis_client.cache_set_json(redis_key, result, _CRYPTO_GLOBAL_CACHE_TTL_SECONDS)
    return result


def search_symbols(query: str, limit: int = 8) -> list[SymbolResult]:
    """Looks up tickers by name/symbol via Yahoo Finance's public search endpoint."""
    try:
        resp = requests.get(
            SEARCH_URL,
            params={"q": query, "quotesCount": limit, "newsCount": 0},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        raise ValueError(f"Sembol araması başarısız oldu: {exc}") from exc

    results = []
    for quote in data.get("quotes", []):
        symbol = quote.get("symbol")
        quote_type = quote.get("quoteType", "")
        if not symbol or quote_type not in ("EQUITY", "ETF"):
            continue
        display_ticker = symbol.split(".")[0]
        results.append(
            SymbolResult(
                yahoo_symbol=symbol,
                ticker=display_ticker,
                name=quote.get("shortname") or quote.get("longname") or symbol,
                exchange=quote.get("exchange", ""),
            )
        )
    return results
