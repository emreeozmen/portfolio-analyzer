from datetime import date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset, PriceHistory
from services import market_data_provider, portfolio_service

USER_ID = 1


@pytest.fixture(autouse=True)
def _no_network_dividends(monkeypatch):
    # value_holding() looks up real dividend history unconditionally; default it to
    # "no dividends" here so unrelated tests don't make a live yfinance call. Tests that
    # care about dividend income override this via their own monkeypatch.setattr.
    monkeypatch.setattr(market_data_provider, "get_dividends", lambda yahoo_symbol: [])


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    asset = Asset(ticker="THYAO", name="Türk Hava Yolları", yahoo_symbol="THYAO.IS", currency="TRY")
    session.add(asset)
    session.commit()
    session.add_all(
        [
            PriceHistory(asset_id=asset.id, date=date(2026, 1, 1), open_price=90, high_price=92, low_price=89, close_price=90, volume=1000),
            PriceHistory(asset_id=asset.id, date=date(2026, 1, 2), open_price=90, high_price=102, low_price=90, close_price=100, volume=1200),
        ]
    )
    session.commit()
    yield session
    session.close()


def test_add_and_list_holding(db_session):
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="thyao", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    assert holding.ticker == "THYAO"
    holdings = portfolio_service.list_holdings(db_session, USER_ID)
    assert len(holdings) == 1


def test_update_holding_changes_fields(db_session):
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    updated = portfolio_service.update_holding(
        db_session,
        user_id=USER_ID,
        holding_id=holding.id,
        ticker="THYAO",
        quantity=20,
        purchase_price=85,
        purchase_date=datetime(2026, 1, 1),
    )

    assert updated.quantity == 20
    assert updated.purchase_price == 85


def test_update_holding_wrong_user_returns_none(db_session):
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    result = portfolio_service.update_holding(
        db_session,
        user_id=999,
        holding_id=holding.id,
        ticker="THYAO",
        quantity=20,
        purchase_price=85,
        purchase_date=datetime(2026, 1, 1),
    )
    assert result is None


def test_delete_holding(db_session):
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    assert portfolio_service.delete_holding(db_session, USER_ID, holding.id) is True
    assert portfolio_service.list_holdings(db_session, USER_ID) == []


def test_value_holding_computes_unrealized_pl(db_session):
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    valued = portfolio_service.value_holding(db_session, holding)

    assert valued["current_price"] == 100
    assert valued["cost_basis"] == 800
    assert valued["market_value"] == 1000
    assert valued["unrealized_pl"] == 200
    assert valued["unrealized_pl_percent"] == pytest.approx(25.0)


def test_value_holding_unknown_ticker_has_null_valuation(db_session):
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="UNKNOWN", quantity=5, purchase_price=10, purchase_date=datetime(2026, 1, 1)
    )

    valued = portfolio_service.value_holding(db_session, holding)

    assert valued["current_price"] is None
    assert valued["market_value"] is None
    assert valued["unrealized_pl"] is None


def test_valuation_summary_aggregates_priced_holdings(db_session):
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )
    unpriced = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="UNKNOWN", quantity=5, purchase_price=10, purchase_date=datetime(2026, 1, 1)
    )
    valued = [portfolio_service.value_holding(db_session, h) for h in (holding, unpriced)]

    summary = portfolio_service.valuation_summary(valued)

    assert summary["total_cost_basis"] == 800
    assert summary["total_market_value"] == 1000
    assert summary["total_unrealized_pl"] == 200
    assert summary["priced_count"] == 1
    assert summary["unpriced_count"] == 1
    assert summary["mixed_currency"] is False


def test_value_holding_includes_try_conversion(db_session, monkeypatch):
    monkeypatch.setattr(market_data_provider, "get_fx_rate", lambda frm, to: 1.0 if frm == to else 30.0)

    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )
    valued = portfolio_service.value_holding(db_session, holding)

    # THYAO is already TRY, so the "conversion" is a no-op (rate 1.0)
    assert valued["market_value_try"] == pytest.approx(valued["market_value"])
    assert valued["cost_basis_try"] == pytest.approx(valued["cost_basis"])


def test_value_holding_respects_custom_aggregate_currency(db_session, monkeypatch):
    calls = []

    def fake_get_fx_rate(frm, to):
        calls.append((frm, to))
        return 1.0 if frm == to else 0.03  # e.g. TRY -> USD

    monkeypatch.setattr(market_data_provider, "get_fx_rate", fake_get_fx_rate)

    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )
    valued = portfolio_service.value_holding(db_session, holding, aggregate_currency="USD")

    assert calls[-1] == ("TRY", "USD")
    assert valued["market_value_try"] == pytest.approx(valued["market_value"] * 0.03)


def test_value_holding_computes_dividend_income_since_purchase(db_session, monkeypatch):
    monkeypatch.setattr(
        market_data_provider,
        "get_dividends",
        lambda yahoo_symbol: [(date(2025, 12, 1), 2.0), (date(2026, 1, 15), 3.0)],
    )
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    valued = portfolio_service.value_holding(db_session, holding)

    # Only the 2026-01-15 payment falls after the 2026-01-01 purchase date
    assert valued["dividend_income"] == pytest.approx(30.0)


def test_value_holding_no_dividends_is_zero_not_none(db_session, monkeypatch):
    monkeypatch.setattr(market_data_provider, "get_dividends", lambda yahoo_symbol: [])
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    valued = portfolio_service.value_holding(db_session, holding)

    assert valued["dividend_income"] == 0.0
    assert valued["dividend_yield_ttm"] == pytest.approx(0.0)


def test_value_holding_unknown_ticker_has_null_dividend_income(db_session):
    holding = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="UNKNOWN", quantity=5, purchase_price=10, purchase_date=datetime(2026, 1, 1)
    )

    valued = portfolio_service.value_holding(db_session, holding)

    assert valued["dividend_income"] is None
    assert valued["dividend_yield_ttm"] is None


def test_sell_holding_reduces_open_lot_and_records_realized_pl(db_session):
    portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    sale = portfolio_service.sell_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=4, sale_price=100, sale_date=datetime(2026, 1, 10)
    )

    assert sale.cost_basis == pytest.approx(4 * 80)
    assert sale.realized_pl == pytest.approx(4 * 100 - 4 * 80)
    remaining = portfolio_service.list_holdings(db_session, USER_ID)
    assert len(remaining) == 1
    assert remaining[0].quantity == pytest.approx(6)


def test_sell_holding_fifo_matches_oldest_lot_first(db_session):
    portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=5, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )
    portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=5, purchase_price=90, purchase_date=datetime(2026, 1, 5)
    )

    # Sells all of the first (cheaper) lot plus 2 shares of the second (pricier) lot
    sale = portfolio_service.sell_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=7, sale_price=110, sale_date=datetime(2026, 1, 10)
    )

    assert sale.cost_basis == pytest.approx(5 * 80 + 2 * 90)
    remaining = portfolio_service.list_holdings(db_session, USER_ID)
    assert len(remaining) == 1
    assert remaining[0].quantity == pytest.approx(3)
    assert remaining[0].purchase_price == pytest.approx(90)


def test_sell_holding_insufficient_quantity_raises(db_session):
    portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=3, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )

    with pytest.raises(ValueError):
        portfolio_service.sell_holding(
            db_session, user_id=USER_ID, ticker="THYAO", quantity=10, sale_price=100, sale_date=datetime(2026, 1, 10)
        )


def test_delete_sale_removes_it(db_session):
    portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )
    sale = portfolio_service.sell_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=4, sale_price=100, sale_date=datetime(2026, 1, 10)
    )

    assert portfolio_service.delete_sale(db_session, USER_ID, sale.id) is True
    assert portfolio_service.list_sales(db_session, USER_ID) == []


def test_delete_sale_wrong_user_returns_false(db_session):
    portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )
    sale = portfolio_service.sell_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=4, sale_price=100, sale_date=datetime(2026, 1, 10)
    )

    assert portfolio_service.delete_sale(db_session, 999, sale.id) is False
    assert len(portfolio_service.list_sales(db_session, USER_ID)) == 1


def test_delete_sale_unknown_id_returns_false(db_session):
    assert portfolio_service.delete_sale(db_session, USER_ID, 12345) is False


def test_import_holdings_csv_english_headers(db_session):
    csv_text = "ticker,quantity,purchase_price,purchase_date\nTHYAO,10,80,2026-01-01\nTHYAO,5,85,02.01.2026\n"

    result = portfolio_service.import_holdings_csv(db_session, USER_ID, csv_text)

    assert result["imported"] == 2
    assert result["errors"] == []
    holdings = portfolio_service.list_holdings(db_session, USER_ID)
    assert len(holdings) == 2


def test_import_holdings_csv_turkish_headers(db_session):
    csv_text = "sembol,miktar,fiyat,tarih\nTHYAO,3,90,01/01/2026\n"

    result = portfolio_service.import_holdings_csv(db_session, USER_ID, csv_text)

    assert result["imported"] == 1
    holdings = portfolio_service.list_holdings(db_session, USER_ID)
    assert holdings[0].quantity == 3


def test_import_holdings_csv_missing_columns_raises(db_session):
    csv_text = "ticker,quantity\nTHYAO,10\n"

    with pytest.raises(ValueError):
        portfolio_service.import_holdings_csv(db_session, USER_ID, csv_text)


def test_import_holdings_csv_reports_row_errors_but_keeps_valid_rows(db_session):
    csv_text = (
        "ticker,quantity,purchase_price,purchase_date\n"
        "THYAO,10,80,2026-01-01\n"
        "THYAO,not-a-number,80,2026-01-01\n"
        "THYAO,5,90,not-a-date\n"
        "THYAO,-3,90,2026-01-01\n"
    )

    result = portfolio_service.import_holdings_csv(db_session, USER_ID, csv_text)

    assert result["imported"] == 1
    assert len(result["errors"]) == 3
    assert result["errors"][0]["row"] == 3
    assert "sayısal değil" in result["errors"][0]["message"]
    assert result["errors"][1]["row"] == 4
    assert result["errors"][2]["row"] == 5


def test_import_holdings_csv_sets_portfolio_id(db_session):
    csv_text = "ticker,quantity,purchase_price,purchase_date\nTHYAO,10,80,2026-01-01\n"

    portfolio_service.import_holdings_csv(db_session, USER_ID, csv_text, portfolio_id=7)

    holdings = portfolio_service.list_holdings(db_session, USER_ID)
    assert holdings[0].portfolio_id == 7


def test_import_holdings_csv_empty_input_raises(db_session):
    with pytest.raises(ValueError):
        portfolio_service.import_holdings_csv(db_session, USER_ID, "")


def test_parse_holdings_csv_does_not_write_to_db(db_session):
    csv_text = "ticker,quantity,purchase_price,purchase_date\nTHYAO,10,80,2026-01-01\n"

    result = portfolio_service.parse_holdings_csv(csv_text)

    assert len(result["rows"]) == 1
    assert result["rows"][0]["ticker"] == "THYAO"
    assert result["errors"] == []
    assert portfolio_service.list_holdings(db_session, USER_ID) == []


def test_parse_holdings_csv_reports_same_row_errors_as_import(db_session):
    csv_text = (
        "ticker,quantity,purchase_price,purchase_date\n"
        "THYAO,10,80,2026-01-01\n"
        "THYAO,not-a-number,80,2026-01-01\n"
    )

    parsed = portfolio_service.parse_holdings_csv(csv_text)
    assert len(parsed["rows"]) == 1
    assert len(parsed["errors"]) == 1

    imported = portfolio_service.import_holdings_csv(db_session, USER_ID, csv_text)
    assert imported["imported"] == 1
    assert imported["errors"] == parsed["errors"]


def test_realized_pl_summary_aggregates_sales(db_session):
    portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )
    portfolio_service.sell_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=4, sale_price=100, sale_date=datetime(2026, 1, 10)
    )

    sales = portfolio_service.list_sales(db_session, USER_ID)
    summary = portfolio_service.realized_pl_summary(sales)

    assert summary["sale_count"] == 1
    assert summary["total_realized_pl"] == pytest.approx(4 * 100 - 4 * 80)


def test_valuation_summary_combines_mixed_currency_via_try(db_session, monkeypatch):
    monkeypatch.setattr(market_data_provider, "get_fx_rate", lambda frm, to: 1.0 if frm == to else 30.0)

    asset_usd = Asset(ticker="MSFT", name="Microsoft", yahoo_symbol="MSFT", currency="USD")
    db_session.add(asset_usd)
    db_session.commit()
    db_session.add_all(
        [
            PriceHistory(asset_id=asset_usd.id, date=date(2026, 1, 1), open_price=400, high_price=410, low_price=395, close_price=400, volume=1000),
        ]
    )
    db_session.commit()

    holding_try = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="THYAO", quantity=10, purchase_price=80, purchase_date=datetime(2026, 1, 1)
    )
    holding_usd = portfolio_service.add_holding(
        db_session, user_id=USER_ID, ticker="MSFT", quantity=2, purchase_price=350, purchase_date=datetime(2026, 1, 1)
    )
    valued = [portfolio_service.value_holding(db_session, h) for h in (holding_try, holding_usd)]

    summary = portfolio_service.valuation_summary(valued)

    assert summary["mixed_currency"] is True
    # native-currency totals are meaningless when mixed — left at 0
    assert summary["total_market_value"] == 0.0
    # but the TRY-normalized total combines both: 10*100 (TRY, rate=1) + 2*400*30 (USD->TRY)
    assert summary["total_market_value_try"] == pytest.approx(1000 + 2 * 400 * 30)
    assert summary["fx_unavailable"] is False
