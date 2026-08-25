"""Provides price history for assets. Reads from the price_history table,
which is populated either by data/seed_prices.py (synthetic demo data) or
by refresh_price_history() below (real data via market_data_provider /
Yahoo Finance). Callers never fetch prices from an external source directly.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Asset, PriceHistory
from services import market_data_provider


def get_price_history(db: Session, asset_id: int) -> list[PriceHistory]:
    return (
        db.query(PriceHistory)
        .filter(PriceHistory.asset_id == asset_id)
        .order_by(PriceHistory.date)
        .all()
    )


def get_latest_prices(db: Session, asset_ids: list[int]) -> dict[int, PriceHistory]:
    """Latest PriceHistory row per asset_id, in a single query — avoids one query per
    asset when pricing many holdings at once (see portfolio_service.value_holdings)."""
    unique_ids = list({aid for aid in asset_ids})
    if not unique_ids:
        return {}
    latest_dates = (
        db.query(PriceHistory.asset_id, func.max(PriceHistory.date).label("max_date"))
        .filter(PriceHistory.asset_id.in_(unique_ids))
        .group_by(PriceHistory.asset_id)
        .subquery()
    )
    rows = (
        db.query(PriceHistory)
        .join(
            latest_dates,
            (PriceHistory.asset_id == latest_dates.c.asset_id) & (PriceHistory.date == latest_dates.c.max_date),
        )
        .all()
    )
    return {row.asset_id: row for row in rows}


SPARKLINE_POINTS = 20


def get_latest_quotes(db: Session, assets: list[Asset]) -> list[dict]:
    """Last price + latest daily change for each asset, for compact watchlist-style
    display. Also returns a short recent-close sparkline. Fetches the last
    SPARKLINE_POINTS rows for every asset in one windowed query instead of one query
    per asset — this backs the sticky Watchlist sidebar shown on most pages, so an N+1
    here scales directly with how many assets a user tracks."""
    if not assets:
        return []
    asset_ids = [a.id for a in assets]
    row_number = (
        func.row_number().over(partition_by=PriceHistory.asset_id, order_by=PriceHistory.date.desc()).label("rn")
    )
    ranked = (
        db.query(PriceHistory.asset_id, PriceHistory.close_price, row_number)
        .filter(PriceHistory.asset_id.in_(asset_ids))
        .subquery()
    )
    rows = db.query(ranked).filter(ranked.c.rn <= SPARKLINE_POINTS).order_by(ranked.c.asset_id, ranked.c.rn).all()

    grouped: dict[int, list] = {}
    for row in rows:
        grouped.setdefault(row.asset_id, []).append(row)

    quotes = []
    for asset in assets:
        asset_rows = grouped.get(asset.id)
        if not asset_rows:
            continue
        last = asset_rows[0]
        prev = asset_rows[1] if len(asset_rows) > 1 else last
        change_percent = ((last.close_price - prev.close_price) / prev.close_price * 100) if prev.close_price else 0.0
        quotes.append(
            {
                "ticker": asset.ticker,
                "name": asset.name,
                "last_price": last.close_price,
                "change_percent": change_percent,
                "currency": asset.currency,
                "sparkline": [r.close_price for r in reversed(asset_rows)],
            }
        )
    return quotes


def refresh_price_history(db: Session, asset: Asset, period: str = "1y") -> int:
    """Replaces an asset's price history with real OHLCV data from Yahoo Finance. Returns the row count."""
    bars = market_data_provider.fetch_ohlcv(asset.yahoo_symbol, period=period)

    db.query(PriceHistory).filter(PriceHistory.asset_id == asset.id).delete()
    db.bulk_save_objects(
        [
            PriceHistory(
                asset_id=asset.id,
                date=bar.date,
                open_price=bar.open,
                high_price=bar.high,
                low_price=bar.low,
                close_price=bar.close,
                volume=bar.volume,
            )
            for bar in bars
        ]
    )
    db.commit()
    return len(bars)
