"""Lightweight reference-data endpoints (FX pairs, a curated crypto list,
published country economic indicators — inflation, GDP growth, unemployment)
that don't belong to the user-facing tracked-asset universe in assets.py — no
Asset/PriceHistory rows, no watchlist scoping, just a fixed reference list
plus a live/cached quote.
"""

from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import market_data_provider, worldbank_service

router = APIRouter(prefix="/markets", tags=["markets"])

# label is what's shown in the UI; yahoo_symbol is what's passed to yfinance.
FX_PAIRS = [
    ("USDTRY=X", "USD/TRY"),
    ("EURTRY=X", "EUR/TRY"),
    ("GBPTRY=X", "GBP/TRY"),
    ("EURUSD=X", "EUR/USD"),
    ("GBPUSD=X", "GBP/USD"),
    ("USDJPY=X", "USD/JPY"),
]

# The home page's live strip — deliberately not the same list as FX_PAIRS
# (mixes an index and a commodity future in with currencies), so it gets its
# own small list rather than overloading FX_PAIRS' semantics.
TICKER_STRIP_SYMBOLS = [
    ("XU100.IS", "BIST 100"),
    ("USDTRY=X", "USD/TRY"),
    ("EURTRY=X", "EUR/TRY"),
    ("BTC-USD", "Bitcoin"),
    ("ETH-USD", "Ethereum"),
    ("GC=F", "Altın (Ons)"),  # COMEX gold futures — spot gold symbols (XAUUSD=X, XAU=X) don't resolve on Yahoo
]

# A handful of the world's most-watched equity indices — verified live against
# Yahoo Finance (each of these symbols was confirmed to actually resolve).
MAJOR_INDICES_SYMBOLS = [
    ("^GSPC", "S&P 500"),
    ("^IXIC", "Nasdaq"),
    ("^DJI", "Dow Jones"),
    ("^N225", "Nikkei 225"),
    ("^GDAXI", "DAX"),
    ("XU050.IS", "BIST 50"),
]

# Real Yahoo Finance futures symbols (same CME/ICE-symbol family as GC=F, already
# used for gold on the ticker strip) — no synthetic/estimated prices.
COMMODITY_SYMBOLS = [
    ("BZ=F", "Brent Petrol"),
    ("NG=F", "Doğalgaz"),
    ("HG=F", "Bakır"),
    ("GC=F", "Altın (Ons)"),
]

# A handful of symbols to pull real headlines for on the homepage — major BIST names
# plus a couple of global/crypto symbols, since Yahoo's news feed is keyed per-symbol
# and the BIST 100 index itself (XU100.IS) carries no news of its own (verified empty).
NEWS_SYMBOLS = ["THYAO.IS", "ASELS.IS", "GARAN.IS", "TUPRS.IS", "AKBNK.IS", "^GSPC", "BTC-USD"]

# A broad curated list, not literally "every coin" (yfinance has no such
# listing endpoint) — each symbol is fetched individually and one that
# doesn't actually resolve on Yahoo Finance is just skipped, not fatal, so
# it's safe to cast a wide net here.
CRYPTO_SYMBOLS = [
    ("BTC-USD", "Bitcoin"),
    ("ETH-USD", "Ethereum"),
    ("USDT-USD", "Tether"),
    ("XRP-USD", "XRP"),
    ("BNB-USD", "BNB"),
    ("SOL-USD", "Solana"),
    ("USDC-USD", "USD Coin"),
    ("DOGE-USD", "Dogecoin"),
    ("ADA-USD", "Cardano"),
    ("TRX-USD", "TRON"),
    ("AVAX-USD", "Avalanche"),
    ("LINK-USD", "Chainlink"),
    ("TON-USD", "Toncoin"),
    ("SHIB-USD", "Shiba Inu"),
    ("SUI-USD", "Sui"),
    ("DOT-USD", "Polkadot"),
    ("BCH-USD", "Bitcoin Cash"),
    ("LTC-USD", "Litecoin"),
    ("NEAR-USD", "NEAR Protocol"),
    ("UNI-USD", "Uniswap"),
    ("DAI-USD", "Dai"),
    ("APT-USD", "Aptos"),
    ("ICP-USD", "Internet Computer"),
    ("PEPE-USD", "Pepe"),
    ("XLM-USD", "Stellar"),
    ("ETC-USD", "Ethereum Classic"),
    ("XMR-USD", "Monero"),
    ("FIL-USD", "Filecoin"),
    ("HBAR-USD", "Hedera"),
    ("INJ-USD", "Injective"),
    ("VET-USD", "VeChain"),
    ("ATOM-USD", "Cosmos"),
    ("ARB-USD", "Arbitrum"),
    ("OP-USD", "Optimism"),
    ("MKR-USD", "Maker"),
    ("AAVE-USD", "Aave"),
    ("ALGO-USD", "Algorand"),
    ("QNT-USD", "Quant"),
    ("GRT-USD", "The Graph"),
    ("LDO-USD", "Lido DAO"),
    ("SAND-USD", "The Sandbox"),
    ("MANA-USD", "Decentraland"),
    ("EGLD-USD", "MultiversX"),
    ("XTZ-USD", "Tezos"),
    ("THETA-USD", "Theta Network"),
    ("EOS-USD", "EOS"),
    ("FLOW-USD", "Flow"),
    ("CHZ-USD", "Chiliz"),
    ("CRV-USD", "Curve DAO"),
    ("IMX-USD", "Immutable"),
    ("RUNE-USD", "THORChain"),
    ("KAVA-USD", "Kava"),
    ("ZEC-USD", "Zcash"),
    ("DASH-USD", "Dash"),
    ("COMP-USD", "Compound"),
    ("MATIC-USD", "Polygon"),
]


class FxQuote(BaseModel):
    pair: str
    label: str
    rate: float
    change_percent: float


class CryptoQuote(BaseModel):
    symbol: str
    name: str
    last_price: float
    change_percent: float
    market_cap: float | None = None
    currency: str = "USD"


class TickerStripQuote(BaseModel):
    symbol: str
    label: str
    value: float
    change_percent: float


class CountryIndicatorValue(BaseModel):
    country_code: str
    country_name: str
    value: float
    year: int


class CryptoGlobalStats(BaseModel):
    total_market_cap_usd: float
    market_cap_change_percentage_24h: float
    btc_dominance: float
    eth_dominance: float
    others_dominance: float


class IndexHistoryPoint(BaseModel):
    date: str
    close: float


class NewsItem(BaseModel):
    id: str
    title: str
    summary: str
    publisher: str
    url: str
    published_at: str | None
    thumbnail_url: str | None
    related_symbol: str


def compute_fx_quotes() -> list[dict]:
    quotes = []
    for symbol, label in FX_PAIRS:
        try:
            q = market_data_provider.get_quote(symbol)
        except ValueError:
            continue  # one bad symbol shouldn't blank out the whole strip
        quotes.append({"pair": symbol, "label": label, "rate": q["last_price"], "change_percent": q["change_percent"]})
    return quotes


@router.get("/fx", response_model=list[FxQuote])
def get_fx_quotes():
    return compute_fx_quotes()


def _fetch_crypto_quote(entry: tuple[str, str]) -> dict | None:
    symbol, name = entry
    try:
        q = market_data_provider.get_quote(symbol)
    except ValueError:
        return None
    return {
        "symbol": symbol.removesuffix("-USD"),
        "name": name,
        "last_price": q["last_price"],
        "change_percent": q["change_percent"],
        "market_cap": market_data_provider.get_market_cap(symbol),
    }


def compute_crypto_quotes() -> list[dict]:
    # Each entry is 1-2 blocking yfinance HTTP calls; sequentially that's ~50
    # round-trips (tens of seconds) on a cold cache. Both calls are I/O-bound,
    # so a thread pool gets the wall time down to roughly the slowest single
    # request instead of the sum of all of them.
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(_fetch_crypto_quote, CRYPTO_SYMBOLS))

    quotes = [q for q in results if q is not None]
    # Most valuable first; a symbol whose market cap we couldn't resolve sinks
    # to the bottom rather than being dropped, so it's still visible.
    quotes.sort(key=lambda q: q["market_cap"] if q["market_cap"] is not None else -1, reverse=True)
    return quotes


@router.get("/crypto", response_model=list[CryptoQuote])
def get_crypto_quotes():
    return compute_crypto_quotes()


def _compute_quotes_for(symbols: list[tuple[str, str]]) -> list[dict]:
    quotes = []
    for symbol, label in symbols:
        try:
            q = market_data_provider.get_quote(symbol)
        except ValueError:
            continue
        quotes.append({"symbol": symbol, "label": label, "value": q["last_price"], "change_percent": q["change_percent"]})
    return quotes


def compute_ticker_strip() -> list[dict]:
    return _compute_quotes_for(TICKER_STRIP_SYMBOLS)


@router.get("/ticker-strip", response_model=list[TickerStripQuote])
def get_ticker_strip():
    return compute_ticker_strip()


def compute_major_indices() -> list[dict]:
    return _compute_quotes_for(MAJOR_INDICES_SYMBOLS)


@router.get("/indices", response_model=list[TickerStripQuote])
def get_major_indices():
    return compute_major_indices()


def compute_commodities() -> list[dict]:
    return _compute_quotes_for(COMMODITY_SYMBOLS)


@router.get("/commodities", response_model=list[TickerStripQuote])
def get_commodities():
    return compute_commodities()


@router.get("/crypto/global", response_model=CryptoGlobalStats)
def get_crypto_global():
    try:
        stats = market_data_provider.get_crypto_global_stats()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kripto piyasa özeti alınamadı: {exc}") from exc
    return CryptoGlobalStats(**stats)


@router.get("/bist100-history", response_model=list[IndexHistoryPoint])
def get_bist100_history():
    """A year of BIST 100 daily closes for the homepage's hero chart — shares the
    same cache entry portfolios' benchmark overlay already uses, so this doesn't
    add any extra load on top of what the app already fetches.
    """
    try:
        bars = market_data_provider.fetch_ohlcv_cached(market_data_provider.BIST100_SYMBOL)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [IndexHistoryPoint(date=bar.date.isoformat(), close=bar.close) for bar in bars]


def compute_market_news() -> list[dict]:
    """Real headlines aggregated across NEWS_SYMBOLS (see market_data_provider.get_news
    for what's real vs. omitted). The same story is often carried under more than one
    symbol (e.g. a general "stock market today" piece shows up for both an index and a
    crypto symbol) — deduped by id, then by title as a fallback since Yahoo doesn't
    always reuse the same id for a syndicated story. Sorted newest first.
    """
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(market_data_provider.get_news, NEWS_SYMBOLS))

    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    merged: list[dict] = []
    for items in results:
        for item in items:
            if item["id"] in seen_ids or item["title"] in seen_titles:
                continue
            seen_ids.add(item["id"])
            seen_titles.add(item["title"])
            merged.append(item)

    merged.sort(key=lambda x: x["published_at"] or "", reverse=True)
    return merged[:12]


@router.get("/news", response_model=list[NewsItem])
def get_market_news():
    return compute_market_news()


@router.get("/inflation", response_model=list[CountryIndicatorValue])
def get_inflation():
    try:
        rows = worldbank_service.get_inflation_by_country()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [
        CountryIndicatorValue(country_code=r.country_code, country_name=r.country_name, value=r.value, year=r.year)
        for r in rows
    ]


@router.get("/gdp-growth", response_model=list[CountryIndicatorValue])
def get_gdp_growth():
    try:
        rows = worldbank_service.get_gdp_growth_by_country()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [
        CountryIndicatorValue(country_code=r.country_code, country_name=r.country_name, value=r.value, year=r.year)
        for r in rows
    ]


@router.get("/unemployment", response_model=list[CountryIndicatorValue])
def get_unemployment():
    try:
        rows = worldbank_service.get_unemployment_by_country()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [
        CountryIndicatorValue(country_code=r.country_code, country_name=r.country_name, value=r.value, year=r.year)
        for r in rows
    ]
