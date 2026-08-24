"""Provides price history for assets. Reads from the price_history table,
which is populated either by data/seed_prices.py (synthetic demo data) or
by refresh_price_history() below (real data via market_data_provider /
Yahoo Finance). Callers never fetch prices from an external source directly.
"""

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


SPARKLINE_POINTS = 20


def get_latest_quotes(db: Session, assets: list[Asset]) -> list[dict]:
    """Last price + latest daily change for each asset, for compact watchlist-style
    display. Also returns a short recent-close sparkline — free to compute here since
    the row set is already read from price_history, no extra Yahoo Finance call."""
    quotes = []
    for asset in assets:
        rows = (
            db.query(PriceHistory)
            .filter(PriceHistory.asset_id == asset.id)
            .order_by(PriceHistory.date.desc())
            .limit(SPARKLINE_POINTS)
            .all()
        )
        if not rows:
            continue
        last = rows[0]
        prev = rows[1] if len(rows) > 1 else last
        change_percent = ((last.close_price - prev.close_price) / prev.close_price * 100) if prev.close_price else 0.0
        quotes.append(
            {
                "ticker": asset.ticker,
                "name": asset.name,
                "last_price": last.close_price,
                "change_percent": change_percent,
                "currency": asset.currency,
                "sparkline": [r.close_price for r in reversed(rows)],
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
