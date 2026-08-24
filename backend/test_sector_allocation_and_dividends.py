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


def _add_price(session, asset_id: int, close: float):
    session.add(
        PriceHistory(
            asset_id=asset_id,
            date=date.today(),
            open_price=close,
            high_price=close,
            low_price=close,
            close_price=close,
            volume=100,
        )
    )


# --- sector_allocation ---


def test_sector_allocation_weights_by_market_value_try(db_session):
    thyao = Asset(ticker="THYAO", name="THY", yahoo_symbol="THYAO.IS", currency="TRY", sector="Industrials")
    akbnk = Asset(ticker="AKBNK", name="Akbank", yahoo_symbol="AKBNK.IS", currency="TRY", sector="Financial Services")
    db_session.add_all([thyao, akbnk])
    db_session.commit()
    _add_price(db_session, thyao.id, 100.0)
    _add_price(db_session, akbnk.id, 50.0)
    db_session.commit()

    h1 = Holding(user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=90, purchase_date=datetime(2026, 1, 1))
    h2 = Holding(user_id=USER_ID, ticker="AKBNK", quantity=10, purchase_price=40, purchase_date=datetime(2026, 1, 1))
    db_session.add_all([h1, h2])
    db_session.commit()

    valued = [portfolio_service.value_holding(db_session, h) for h in [h1, h2]]
    result = portfolio_service.sector_allocation(valued)

    by_label = {r["label"]: r["weight"] for r in result}
    assert by_label["Industrials"] == pytest.approx(1000 / 1500)
    assert by_label["Financial Services"] == pytest.approx(500 / 1500)


def test_sector_allocation_groups_missing_sector_as_bilinmiyor(db_session):
    asset = Asset(ticker="XYZ", name="XYZ Corp", yahoo_symbol="XYZ", currency="TRY", sector=None)
    db_session.add(asset)
    db_session.commit()
    _add_price(db_session, asset.id, 10.0)
    db_session.commit()

    h = Holding(user_id=USER_ID, ticker="XYZ", quantity=5, purchase_price=9, purchase_date=datetime(2026, 1, 1))
    db_session.add(h)
    db_session.commit()

    valued = [portfolio_service.value_holding(db_session, h)]
    result = portfolio_service.sector_allocation(valued)

    assert result == [{"label": "Bilinmiyor", "weight": pytest.approx(1.0)}]


def test_sector_allocation_empty_when_nothing_priced(db_session):
    assert portfolio_service.sector_allocation([]) == []


# --- dividend_history ---


def test_dividend_history_combines_lots_of_same_ticker(db_session):
    asset = Asset(ticker="THYAO", name="THY", yahoo_symbol="THYAO.IS", currency="TRY", sector="Industrials")
    db_session.add(asset)
    db_session.commit()

    pay_date = date.today() - timedelta(days=10)
    early_lot = Holding(
        user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=90,
        purchase_date=datetime.combine(pay_date - timedelta(days=30), datetime.min.time()),
    )
    late_lot = Holding(
        user_id=USER_ID, ticker="THYAO", quantity=5, purchase_price=95,
        purchase_date=datetime.combine(pay_date + timedelta(days=1), datetime.min.time()),
    )
    db_session.add_all([early_lot, late_lot])
    db_session.commit()

    with patch.object(market_data_provider, "get_dividends", return_value=[(pay_date, 2.0)]):
        with patch.object(market_data_provider, "get_fx_rate", return_value=1.0):
            rows = portfolio_service.dividend_history(db_session, USER_ID)

    # late_lot was purchased *after* the ex-dividend date, so only early_lot's 10
    # shares count toward this payment — not both lots' 15.
    assert len(rows) == 1
    assert rows[0]["ticker"] == "THYAO"
    assert rows[0]["quantity"] == 10
    assert rows[0]["amount"] == pytest.approx(20.0)
    assert rows[0]["amount_try"] == pytest.approx(20.0)


def test_dividend_history_excludes_payments_before_any_lot_was_held(db_session):
    asset = Asset(ticker="THYAO", name="THY", yahoo_symbol="THYAO.IS", currency="TRY")
    db_session.add(asset)
    db_session.commit()

    purchase_date = date.today()
    h = Holding(
        user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=90,
        purchase_date=datetime.combine(purchase_date, datetime.min.time()),
    )
    db_session.add(h)
    db_session.commit()

    old_payment = purchase_date - timedelta(days=5)
    with patch.object(market_data_provider, "get_dividends", return_value=[(old_payment, 2.0)]):
        rows = portfolio_service.dividend_history(db_session, USER_ID)

    assert rows == []


def test_dividend_history_sorted_newest_first(db_session):
    asset = Asset(ticker="THYAO", name="THY", yahoo_symbol="THYAO.IS", currency="TRY")
    db_session.add(asset)
    db_session.commit()

    h = Holding(
        user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=90,
        purchase_date=datetime(2020, 1, 1),
    )
    db_session.add(h)
    db_session.commit()

    payments = [(date(2026, 1, 1), 1.0), (date(2026, 6, 1), 1.5), (date(2026, 3, 1), 1.2)]
    with patch.object(market_data_provider, "get_dividends", return_value=payments):
        with patch.object(market_data_provider, "get_fx_rate", return_value=1.0):
            rows = portfolio_service.dividend_history(db_session, USER_ID)

    assert [r["pay_date"] for r in rows] == ["2026-06-01", "2026-03-01", "2026-01-01"]


def test_dividend_history_no_holdings_returns_empty(db_session):
    assert portfolio_service.dividend_history(db_session, USER_ID) == []
