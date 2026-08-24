"""Generates ~1 year of synthetic daily OHLCV bars for a fixed set of BIST
tickers and loads them into the assets/price_history tables. Run from
backend/ with: python -m data.seed_prices

This is placeholder data for local development only. To switch to a real
market data provider, replace this script's price generation with an API
call in services/price_service.py — the assets/price_history schema does
not need to change.
"""

from datetime import date, timedelta

import numpy as np

from database import Base, SessionLocal, engine
from models import Asset, PriceHistory
from services import market_data_provider

SEED = 42
TRADING_DAYS = 252

ASSETS = [
    {"ticker": "THYAO", "name": "Türk Hava Yolları", "start_price": 280.0, "yahoo_symbol": "THYAO.IS", "exchange": "BIST", "currency": "TRY"},
    {"ticker": "ASELS", "name": "Aselsan", "start_price": 65.0, "yahoo_symbol": "ASELS.IS", "exchange": "BIST", "currency": "TRY"},
    {"ticker": "GARAN", "name": "Garanti BBVA", "start_price": 115.0, "yahoo_symbol": "GARAN.IS", "exchange": "BIST", "currency": "TRY"},
    {"ticker": "TUPRS", "name": "Tüpraş", "start_price": 145.0, "yahoo_symbol": "TUPRS.IS", "exchange": "BIST", "currency": "TRY"},
    {"ticker": "AKBNK", "name": "Akbank", "start_price": 65.0, "yahoo_symbol": "AKBNK.IS", "exchange": "BIST", "currency": "TRY"},
]


def trading_dates(count: int) -> list[date]:
    dates = []
    day = date.today() - timedelta(days=1)
    while len(dates) < count:
        if day.weekday() < 5:
            dates.append(day)
        day -= timedelta(days=1)
    return list(reversed(dates))


def generate_ohlcv_bars(start_price: float, count: int, rng: np.random.Generator) -> list[dict]:
    daily_returns = rng.normal(loc=0.0006, scale=0.02, size=count)
    closes = start_price * np.cumprod(1 + daily_returns)

    bars = []
    prev_close = start_price
    for close in closes:
        gap = rng.normal(loc=0.0, scale=0.004)
        open_price = prev_close * (1 + gap)
        wick_up = abs(rng.normal(0.0, 0.006))
        wick_down = abs(rng.normal(0.0, 0.006))
        high = max(open_price, close) * (1 + wick_up)
        low = min(open_price, close) * (1 - wick_down)
        volume = float(rng.integers(1_000_000, 20_000_000))

        bars.append(
            {
                "open": round(float(open_price), 2),
                "high": round(float(high), 2),
                "low": round(float(low), 2),
                "close": round(float(close), 2),
                "volume": volume,
            }
        )
        prev_close = close

    return bars


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    rng = np.random.default_rng(SEED)
    dates = trading_dates(TRADING_DAYS)

    db = SessionLocal()
    try:
        for asset_def in ASSETS:
            asset = db.query(Asset).filter(Asset.ticker == asset_def["ticker"]).first()
            if asset is None:
                asset = Asset(
                    ticker=asset_def["ticker"],
                    name=asset_def["name"],
                    yahoo_symbol=asset_def["yahoo_symbol"],
                    exchange=asset_def["exchange"],
                    currency=asset_def["currency"],
                    is_default=True,
                    sector=market_data_provider.get_sector(asset_def["yahoo_symbol"]),
                )
                db.add(asset)
                db.commit()
                db.refresh(asset)
            else:
                if not asset.is_default:
                    asset.is_default = True  # backfills older DBs seeded before is_default existed
                if asset.sector is None:
                    asset.sector = market_data_provider.get_sector(asset_def["yahoo_symbol"])
                db.commit()

            db.query(PriceHistory).filter(PriceHistory.asset_id == asset.id).delete()

            bars = generate_ohlcv_bars(asset_def["start_price"], TRADING_DAYS, rng)
            db.bulk_save_objects(
                [
                    PriceHistory(
                        asset_id=asset.id,
                        date=d,
                        open_price=bar["open"],
                        high_price=bar["high"],
                        low_price=bar["low"],
                        close_price=bar["close"],
                        volume=bar["volume"],
                    )
                    for d, bar in zip(dates, bars)
                ]
            )
            db.commit()
            print(f"Seeded {len(bars)} OHLCV bars for {asset_def['ticker']}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
