import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from database import get_db
from i18n import get_lang, localize
from models import User
from routers.auth import get_current_user, get_current_user_optional
from services import alert_service, analysis_service, asset_service, market_data_provider, price_service, rate_limit

router = APIRouter(prefix="/assets", tags=["assets"])


class AssetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticker: str
    name: str
    exchange: str | None = None
    currency: str = "USD"
    sector: str | None = None
    is_default: bool = False


class AssetQuote(BaseModel):
    ticker: str
    name: str
    last_price: float
    change_percent: float
    currency: str = "USD"
    sparkline: list[float] = []


class SymbolSearchResult(BaseModel):
    yahoo_symbol: str
    ticker: str
    name: str
    exchange: str
    already_tracked: bool


class TrackAssetRequest(BaseModel):
    yahoo_symbol: str
    ticker: str
    name: str
    exchange: str | None = None


@router.get("", response_model=list[AssetResponse])
def get_assets(db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user_optional)):
    return asset_service.list_visible_assets(db, current_user)


@router.get("/quotes", response_model=list[AssetQuote])
def get_asset_quotes(db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user_optional)):
    return price_service.get_latest_quotes(db, asset_service.list_visible_assets(db, current_user))


@router.get("/search", response_model=list[SymbolSearchResult])
def search_assets(
    q: str, db: Session = Depends(get_db), current_user: User | None = Depends(get_current_user_optional)
):
    query = q.strip()
    if not query:
        return []

    try:
        results = market_data_provider.search_symbols(query)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    visible_symbols = {a.yahoo_symbol for a in asset_service.list_visible_assets(db, current_user)}
    return [
        SymbolSearchResult(
            yahoo_symbol=r.yahoo_symbol,
            ticker=r.ticker,
            name=r.name,
            exchange=r.exchange,
            already_tracked=r.yahoo_symbol in visible_symbols,
        )
        for r in results
    ]


@router.post("/track", response_model=AssetResponse, dependencies=[Depends(rate_limit.throttle(10, 300))])
def track_asset(
    payload: TrackAssetRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    asset = asset_service.get_or_create_asset(
        db,
        ticker=payload.ticker,
        name=payload.name,
        yahoo_symbol=payload.yahoo_symbol,
        exchange=payload.exchange,
    )

    # Only add to the user's watchlist once we know there's real price data behind
    # it — otherwise a failed backfill would strand a dataless asset in their list
    # that they can never see (analysis 404s) and can't retry (search shows it as
    # already tracked).
    existing_prices = price_service.get_price_history(db, asset.id)
    if not existing_prices:
        try:
            price_service.refresh_price_history(db, asset)
        except ValueError as exc:
            raise HTTPException(
                status_code=502, detail=f"'{asset.ticker}' için fiyat verisi çekilemedi: {exc}"
            ) from exc

        asset.currency = market_data_provider.get_currency(asset.yahoo_symbol)
        asset.sector = market_data_provider.get_sector(asset.yahoo_symbol)
        db.commit()
        db.refresh(asset)

    asset_service.add_to_watchlist(db, current_user.id, asset.id)

    return asset


@router.post("/{ticker}/watchlist", response_model=AssetResponse)
def rewatch_asset(ticker: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Re-adds an already-known asset (one that exists in the shared pool but isn't
    in this user's watchlist right now — e.g. they untracked it earlier) without
    needing the full search-result payload /track requires. 404s if the ticker isn't
    a known asset at all; use /track for that case instead.
    """
    asset = asset_service.get_asset_by_ticker(db, ticker)
    if asset is None:
        raise HTTPException(status_code=404, detail=f"Asset '{ticker}' not found")
    asset_service.add_to_watchlist(db, current_user.id, asset.id)
    return asset


@router.delete("/{ticker}/track", status_code=204)
def untrack_asset(
    ticker: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    asset = asset_service.get_asset_by_ticker(db, ticker)
    if asset is None:
        raise HTTPException(status_code=404, detail=f"Asset '{ticker}' not found")
    if asset.is_default:
        raise HTTPException(status_code=400, detail=localize("Varsayılan varlıklar izlemeden çıkarılamaz", lang))

    removed = asset_service.remove_from_watchlist(db, current_user.id, asset.id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"'{asset.ticker}' izleme listende değil")


@router.get("/{ticker}/analysis")
def get_asset_analysis(ticker: str, db: Session = Depends(get_db)):
    asset = asset_service.get_asset_by_ticker(db, ticker)
    if asset is None:
        raise HTTPException(status_code=404, detail=f"Asset '{ticker}' not found")

    price_rows = price_service.get_price_history(db, asset.id)
    if not price_rows:
        raise HTTPException(status_code=404, detail=f"No price data for '{ticker}'")

    analysis = analysis_service.asset_analysis(price_rows, currency=asset.currency)
    return {
        "ticker": asset.ticker,
        "name": asset.name,
        "exchange": asset.exchange,
        "currency": asset.currency,
        "sector": asset.sector,
        "is_default": asset.is_default,
        **analysis,
    }


@router.get("/{ticker}/fundamentals")
async def get_asset_fundamentals(ticker: str, db: Session = Depends(get_db)):
    # to_thread even for this DB lookup, not just the Yahoo Finance calls below — a
    # plain synchronous db.query() call here would otherwise block the whole event
    # loop (every other concurrent request/WebSocket connection this worker is
    # serving) for its round-trip, the exact thing this module's other async work
    # already goes out of its way to avoid.
    asset = await asyncio.to_thread(asset_service.get_asset_by_ticker, db, ticker)
    if asset is None:
        raise HTTPException(status_code=404, detail=f"Asset '{ticker}' not found")

    # Each of these is its own Yahoo Finance round trip (6h-cached, so this fires
    # regularly on a cold cache) — run concurrently instead of stacking 4 sequential
    # network calls' worth of latency behind the Temeller tab.
    valuation, recommendations, earnings, holders = await asyncio.gather(
        asyncio.to_thread(market_data_provider.get_fundamentals, asset.yahoo_symbol),
        asyncio.to_thread(market_data_provider.get_recommendations_trend, asset.yahoo_symbol),
        asyncio.to_thread(market_data_provider.get_earnings_calendar, asset.yahoo_symbol),
        asyncio.to_thread(market_data_provider.get_institutional_holders, asset.yahoo_symbol),
    )

    return {
        "ticker": asset.ticker,
        "valuation": valuation,
        "analyst_recommendations": recommendations,
        "earnings_calendar": earnings,
        "holders": holders,
    }


@router.post("/{ticker}/refresh", dependencies=[Depends(rate_limit.throttle(20, 60))])
def refresh_asset(ticker: str, db: Session = Depends(get_db)):
    asset = asset_service.get_asset_by_ticker(db, ticker)
    if asset is None:
        raise HTTPException(status_code=404, detail=f"Asset '{ticker}' not found")

    try:
        row_count = price_service.refresh_price_history(db, asset)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    asset.currency = market_data_provider.get_currency(asset.yahoo_symbol)
    if asset.sector is None:
        asset.sector = market_data_provider.get_sector(asset.yahoo_symbol)
    db.commit()
    db.refresh(asset)
    alert_service.check_alerts_for_asset(db, asset.id)

    price_rows = price_service.get_price_history(db, asset.id)
    analysis = analysis_service.asset_analysis(price_rows, currency=asset.currency)
    return {
        "ticker": asset.ticker,
        "name": asset.name,
        "exchange": asset.exchange,
        "currency": asset.currency,
        "sector": asset.sector,
        "is_default": asset.is_default,
        "rows_updated": row_count,
        **analysis,
    }


@router.post("/refresh-all", dependencies=[Depends(rate_limit.throttle(3, 300))])
def refresh_all_assets(db: Session = Depends(get_db)):
    refreshed: list[str] = []
    failed: list[dict[str, str]] = []

    for asset in asset_service.list_assets(db):
        try:
            price_service.refresh_price_history(db, asset)
            refreshed.append(asset.ticker)
        except ValueError as exc:
            failed.append({"ticker": asset.ticker, "error": str(exc)})

    return {"refreshed": refreshed, "failed": failed}
