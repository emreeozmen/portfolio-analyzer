from datetime import date, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset, Holding, PriceHistory
from services import market_data_provider, portfolio_service

USER_ID = 1


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _seed_prices(session, asset_id: int, closes: list[float], start: date):
    session.add_all(
        [
            PriceHistory(
                asset_id=asset_id,
                date=start + timedelta(days=i),
                open_price=c,
                high_price=c,
                low_price=c,
                close_price=c,
                volume=100,
            )
            for i, c in enumerate(closes)
        ]
    )


def test_holdings_value_history_single_currency(db_session):
    asset = Asset(ticker="THYAO", name="Türk Hava Yolları", yahoo_symbol="THYAO.IS", currency="TRY")
    db_session.add(asset)
    db_session.commit()
    start = date(2026, 1, 1)
    _seed_prices(db_session, asset.id, [10.0, 12.0, 15.0, 20.0], start)
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="THYAO",
            quantity=10,
            purchase_price=10.0,
            purchase_date=datetime.combine(start, datetime.min.time()),
        )
    )
    db_session.commit()

    result = portfolio_service.holdings_value_history(db_session, USER_ID)

    assert result["currency"] == "TRY"
    assert result["fx_unavailable"] is False
    assert result["excluded_tickers"] == []
    assert len(result["points"]) == 4
    assert result["points"][0]["market_value"] == pytest.approx(100.0)
    assert result["points"][0]["cost_basis"] == pytest.approx(100.0)
    assert result["points"][-1]["market_value"] == pytest.approx(200.0)
    assert result["points"][-1]["cost_basis"] == pytest.approx(100.0)


def test_holdings_value_history_purchase_mid_series_only_counts_after(db_session):
    asset = Asset(ticker="THYAO", name="Türk Hava Yolları", yahoo_symbol="THYAO.IS", currency="TRY")
    db_session.add(asset)
    db_session.commit()
    start = date(2026, 1, 1)
    _seed_prices(db_session, asset.id, [10.0, 12.0, 15.0], start)
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="THYAO",
            quantity=5,
            purchase_price=12.0,
            purchase_date=datetime.combine(start + timedelta(days=1), datetime.min.time()),
        )
    )
    db_session.commit()

    result = portfolio_service.holdings_value_history(db_session, USER_ID)

    assert len(result["points"]) == 2  # day 0 (before purchase) is excluded — nothing held yet
    assert result["points"][0]["date"] == (start + timedelta(days=1)).isoformat()
    assert result["points"][0]["market_value"] == pytest.approx(60.0)


def test_holdings_value_history_no_holdings_returns_empty(db_session):
    result = portfolio_service.holdings_value_history(db_session, USER_ID)
    assert result == {"points": [], "currency": "TRY", "fx_unavailable": False, "excluded_tickers": []}


def test_holdings_value_history_excludes_ticker_without_price_data(db_session):
    asset = Asset(ticker="NOPRICE", name="No Price", yahoo_symbol="NOPRICE.IS", currency="TRY")
    db_session.add(asset)
    db_session.commit()
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="NOPRICE",
            quantity=1,
            purchase_price=1.0,
            purchase_date=datetime(2026, 1, 1),
        )
    )
    db_session.commit()

    result = portfolio_service.holdings_value_history(db_session, USER_ID)

    assert result["points"] == []
    assert result["excluded_tickers"] == ["NOPRICE"]


def test_holdings_value_history_converts_foreign_currency_via_historical_fx(db_session):
    asset = Asset(ticker="AAPL", name="Apple", yahoo_symbol="AAPL", currency="USD")
    db_session.add(asset)
    db_session.commit()
    start = date(2026, 1, 1)
    _seed_prices(db_session, asset.id, [100.0, 110.0], start)
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="AAPL",
            quantity=2,
            purchase_price=100.0,
            purchase_date=datetime.combine(start, datetime.min.time()),
        )
    )
    db_session.commit()

    fx_bars = [
        market_data_provider.OhlcvBar(date=start, open=30, high=30, low=30, close=30.0, volume=0),
        market_data_provider.OhlcvBar(date=start + timedelta(days=1), open=32, high=32, low=32, close=32.0, volume=0),
    ]

    with patch.object(market_data_provider, "fetch_ohlcv_cached", return_value=fx_bars) as mock_fetch:
        result = portfolio_service.holdings_value_history(db_session, USER_ID)

    mock_fetch.assert_called_once_with("USDTRY=X")
    assert result["fx_unavailable"] is False
    assert result["points"][0]["market_value"] == pytest.approx(2 * 100.0 * 30.0)
    assert result["points"][1]["market_value"] == pytest.approx(2 * 110.0 * 32.0)


def test_holdings_value_history_flags_fx_unavailable(db_session):
    asset = Asset(ticker="AAPL", name="Apple", yahoo_symbol="AAPL", currency="USD")
    db_session.add(asset)
    db_session.commit()
    start = date(2026, 1, 1)
    _seed_prices(db_session, asset.id, [100.0], start)
    db_session.add(
        Holding(
            user_id=USER_ID,
            ticker="AAPL",
            quantity=1,
            purchase_price=100.0,
            purchase_date=datetime.combine(start, datetime.min.time()),
        )
    )
    db_session.commit()

    with patch.object(market_data_provider, "fetch_ohlcv_cached", side_effect=ValueError("no data")):
        result = portfolio_service.holdings_value_history(db_session, USER_ID)

    assert result["fx_unavailable"] is True
    assert result["excluded_tickers"] == ["AAPL"]
    assert result["points"] == []
