from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset, Portfolio, PortfolioAsset, PriceHistory, User
from routers.public import get_demo_portfolio
from services import demo_service, market_data_provider


@pytest.fixture
def demo_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        symbols = {ticker: preset["currency"] for preset in demo_service.PRESETS.values() for ticker in preset["weights"]}
        for ticker, currency in symbols.items():
            asset = Asset(ticker=ticker, name=ticker, yahoo_symbol=ticker, currency=currency, is_default=True)
            db.add(asset)
            db.flush()
            for day in range(60):
                price = 100 + day * .3 + (day % 7) * .2
                db.add(PriceHistory(asset_id=asset.id, date=date(2025, 1, 1) + timedelta(days=day),
                                    open_price=price, high_price=price, low_price=price, close_price=price, volume=100))
        db.commit()
        with patch.object(market_data_provider, "fetch_ohlcv_cached", return_value=[]):
            yield db
    engine.dispose()


@pytest.mark.parametrize("preset_id", demo_service.PRESETS)
def test_demo_uses_real_history_without_creating_user_records(demo_db, preset_id):
    statements = []

    @event.listens_for(demo_db.bind, "before_cursor_execute")
    def track(_conn, _cursor, statement, *_args):
        statements.append(statement.lstrip().upper())

    result = get_demo_portfolio(preset_id, demo_db)
    assert result["educational"] is True
    assert result["portfolio_id"] == 0
    assert result["portfolio_index"][0]["value"] == pytest.approx(100)
    assert sum(item["weight"] for item in result["weights"]) == pytest.approx(1)
    assert result["data_window"]["observations"] == 60
    assert result["data_window"]["start_date"] == "2025-01-01"
    assert result["data_window"]["end_date"] == "2025-03-01"
    assert not any(sql.startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)
    assert demo_db.query(User).count() == 0
    assert demo_db.query(Portfolio).count() == 0
    assert demo_db.query(PortfolioAsset).count() == 0


def test_demo_never_falls_back_to_a_private_asset(demo_db):
    demo_db.query(Asset).filter_by(ticker="THYAO").one().is_default = False
    demo_db.commit()
    with pytest.raises(HTTPException) as error:
        get_demo_portfolio("bist-five", demo_db)
    assert error.value.status_code == 503


def test_missing_history_is_unavailable_not_fabricated(demo_db):
    asset = demo_db.query(Asset).filter_by(ticker="THYAO").one()
    demo_db.query(PriceHistory).filter_by(asset_id=asset.id).delete()
    demo_db.commit()
    with pytest.raises(HTTPException) as error:
        get_demo_portfolio("concentrated", demo_db)
    assert error.value.status_code == 503


def test_demo_rejects_mislabeled_currency(demo_db):
    demo_db.query(Asset).filter_by(ticker="THYAO").one().currency = "USD"
    demo_db.commit()
    with pytest.raises(HTTPException) as error:
        get_demo_portfolio("bist-five", demo_db)
    assert error.value.status_code == 503


def test_unknown_demo_does_not_query_any_account():
    db = MagicMock()
    with pytest.raises(HTTPException) as error:
        get_demo_portfolio("some-user-portfolio", db)
    assert error.value.status_code == 404
    db.query.assert_not_called()


def test_us_demo_uses_a_us_benchmark(demo_db):
    with patch.object(market_data_provider, "fetch_ohlcv_cached", return_value=[]) as fetch:
        result = get_demo_portfolio("us-tech", demo_db)
    assert result["currency"] == "USD"
    assert result["benchmark_label"] == "S&P 500"
    fetch.assert_called_once_with("^GSPC")
