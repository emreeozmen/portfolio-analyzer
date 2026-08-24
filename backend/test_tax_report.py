from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from services import portfolio_service

USER_ID = 1


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _sell(db_session, ticker, quantity, purchase_price, purchase_date, sale_price, sale_date):
    portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker=ticker, quantity=quantity, purchase_price=purchase_price, purchase_date=purchase_date
    )
    return portfolio_service.sell_holding(db_session, USER_ID, ticker, quantity, sale_price, sale_date)


def test_realized_pl_by_year_groups_by_calendar_year(db_session):
    _sell(db_session, "THYAO", 10, 100, datetime(2024, 1, 1), 120, datetime(2024, 6, 1))
    _sell(db_session, "THYAO", 5, 100, datetime(2025, 1, 1), 90, datetime(2025, 3, 1))
    _sell(db_session, "ASELS", 8, 50, datetime(2025, 1, 1), 70, datetime(2025, 9, 1))

    sales = portfolio_service.list_sales(db_session, USER_ID)
    years = portfolio_service.realized_pl_by_year(sales)

    assert [y["year"] for y in years] == [2025, 2024]  # newest first

    year_2025 = years[0]
    assert year_2025["sale_count"] == 2
    assert {t["ticker"] for t in year_2025["tickers"]} == {"THYAO", "ASELS"}

    year_2024 = years[1]
    assert year_2024["sale_count"] == 1
    assert year_2024["total_realized_pl"] == pytest.approx((120 - 100) * 10)


def test_realized_pl_by_year_per_ticker_totals_are_correct(db_session):
    _sell(db_session, "THYAO", 10, 100, datetime(2025, 1, 1), 150, datetime(2025, 6, 1))  # +500
    _sell(db_session, "ASELS", 10, 50, datetime(2025, 1, 1), 40, datetime(2025, 6, 1))  # -100

    years = portfolio_service.realized_pl_by_year(portfolio_service.list_sales(db_session, USER_ID))
    tickers_by_name = {t["ticker"]: t for t in years[0]["tickers"]}

    assert tickers_by_name["THYAO"]["total_realized_pl"] == pytest.approx(500)
    assert tickers_by_name["ASELS"]["total_realized_pl"] == pytest.approx(-100)
    assert years[0]["total_realized_pl"] == pytest.approx(400)


def test_realized_pl_by_year_empty_sales_returns_empty_list():
    assert portfolio_service.realized_pl_by_year([]) == []
