from datetime import date, timedelta
from unittest.mock import patch

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset, PriceHistory
from services import market_data_provider
from services.analysis_service import (
    backtest_analysis,
    goal_planning_analysis,
    monte_carlo_analysis,
    portfolio_analysis,
    portfolio_value_series,
)
from services.portfolio_builder_service import compute_portfolio_analysis_payload, create_portfolio


def make_price_series(values: list[float]) -> pd.Series:
    dates = pd.date_range("2024-01-01", periods=len(values))
    return pd.Series(values, index=dates)


def test_portfolio_value_series_equal_weights():
    prices_a = make_price_series([100, 110, 121])  # +21% total
    prices_b = make_price_series([50, 50, 50])  # flat

    index = portfolio_value_series({"A": prices_a, "B": prices_b}, {"A": 0.5, "B": 0.5})

    assert index.iloc[0] == pytest.approx(100)
    assert index.iloc[1] == pytest.approx(105)
    assert index.iloc[2] == pytest.approx(110.5)


def test_portfolio_value_series_respects_weights():
    prices_a = make_price_series([100, 200])  # +100%
    prices_b = make_price_series([100, 100])  # flat

    index = portfolio_value_series({"A": prices_a, "B": prices_b}, {"A": 0.25, "B": 0.75})

    # 25% * 2.0 + 75% * 1.0 = 1.25 -> 125
    assert index.iloc[1] == pytest.approx(125)


def test_portfolio_analysis_total_return_and_length():
    prices_a = make_price_series([100, 110, 121])
    prices_b = make_price_series([50, 50, 50])

    result = portfolio_analysis({"A": prices_a, "B": prices_b}, {"A": 0.5, "B": 0.5})

    assert result["summary"]["total_return"] == pytest.approx(0.105)
    assert len(result["portfolio_index"]) == 3
    assert result["portfolio_index"][0]["value"] == pytest.approx(100)
    assert "sharpe_ratio" in result["summary"]


def test_portfolio_analysis_summary_includes_advanced_risk_metrics():
    prices_a = make_price_series([100, 110, 105, 121, 130, 128, 135])
    prices_b = make_price_series([50, 52, 50, 53, 55, 54, 56])

    result = portfolio_analysis({"A": prices_a, "B": prices_b}, {"A": 0.5, "B": 0.5})

    summary = result["summary"]
    for key in ("sortino_ratio", "calmar_ratio", "skewness", "kurtosis", "historical_var_95", "historical_cvar_95"):
        assert key in summary


def _multi_day_price_series(seed: int, n_days: int = 120, drift: float = 0.0006, vol: float = 0.015) -> pd.Series:
    import numpy as np

    rng = np.random.default_rng(seed)
    returns = rng.normal(drift, vol, n_days)
    prices = 100 * np.cumprod(1 + returns)
    return pd.Series(prices, index=pd.date_range("2025-01-01", periods=n_days))


def test_monte_carlo_analysis_returns_expected_shape():
    series = {"A": _multi_day_price_series(1), "B": _multi_day_price_series(2)}
    result = monte_carlo_analysis(series, {"A": 0.5, "B": 0.5}, horizon_days=30, n_simulations=300)

    assert result is not None
    assert result["horizon_days"] == 30
    assert len(result["days"]) == 31


def test_goal_planning_analysis_returns_probability():
    series = {"A": _multi_day_price_series(3), "B": _multi_day_price_series(4)}
    result = goal_planning_analysis(
        series, {"A": 0.5, "B": 0.5}, initial_value=100.0, monthly_contribution=10.0,
        target_value=500.0, horizon_months=36, n_simulations=300,
    )

    assert result is not None
    assert 0 <= result["probability_within_horizon"] <= 1


def test_backtest_analysis_includes_worst_drawdown_period():
    series = {"A": _multi_day_price_series(5), "B": _multi_day_price_series(6)}
    result = backtest_analysis(series, {"A": 0.5, "B": 0.5}, window_days=21)

    assert result is not None
    assert "worst_drawdown_period" in result


def test_backtest_analysis_insufficient_history_returns_none():
    series = {"A": make_price_series([100, 101, 102]), "B": make_price_series([50, 51, 52])}
    assert backtest_analysis(series, {"A": 0.5, "B": 0.5}, window_days=30) is None


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    asset = Asset(ticker="THYAO", name="Türk Hava Yolları", yahoo_symbol="THYAO.IS", currency="TRY")
    session.add(asset)
    session.commit()
    base = date(2026, 1, 1)
    for i in range(10):
        session.add(
            PriceHistory(
                asset_id=asset.id,
                date=base + timedelta(days=i),
                open_price=100 + i,
                high_price=101 + i,
                low_price=99 + i,
                close_price=100 + i,
                volume=1000,
            )
        )
    session.commit()
    yield session
    session.close()


def test_compute_analysis_payload_uses_default_bist100_benchmark(db_session):
    portfolio = create_portfolio(db_session, user_id=1, name="Test", assets_input=[("THYAO", 100)])
    bars = [market_data_provider.OhlcvBar(date=date(2026, 1, i + 1), open=1, high=1, low=1, close=100.0, volume=0) for i in range(10)]

    with patch.object(market_data_provider, "fetch_ohlcv_cached", return_value=bars) as mock_fetch:
        payload = compute_portfolio_analysis_payload(db_session, portfolio)

    mock_fetch.assert_called_once_with(market_data_provider.BIST100_SYMBOL)
    assert payload["benchmark_label"] == "BIST 100"
    assert len(payload["benchmark"]) > 0


def test_compute_analysis_payload_uses_custom_benchmark(db_session):
    portfolio = create_portfolio(
        db_session,
        user_id=1,
        name="Test",
        assets_input=[("THYAO", 100)],
        benchmark_symbol="^GSPC",
        benchmark_label="S&P 500",
    )
    bars = [market_data_provider.OhlcvBar(date=date(2026, 1, i + 1), open=1, high=1, low=1, close=200.0, volume=0) for i in range(10)]

    with patch.object(market_data_provider, "fetch_ohlcv_cached", return_value=bars) as mock_fetch:
        payload = compute_portfolio_analysis_payload(db_session, portfolio)

    mock_fetch.assert_called_once_with("^GSPC")
    assert payload["benchmark_label"] == "S&P 500"


def test_compute_analysis_payload_degrades_gracefully_when_benchmark_fetch_fails(db_session):
    portfolio = create_portfolio(db_session, user_id=1, name="Test", assets_input=[("THYAO", 100)])

    with patch.object(market_data_provider, "fetch_ohlcv_cached", side_effect=RuntimeError("boom")):
        payload = compute_portfolio_analysis_payload(db_session, portfolio)

    assert payload["benchmark"] == []
    assert payload["summary"]["total_return"] is not None


def test_compute_analysis_payload_raises_for_empty_portfolio(db_session):
    portfolio = create_portfolio(db_session, user_id=1, name="Test", assets_input=[("THYAO", 100)])
    from services.portfolio_builder_service import get_portfolio_assets
    from models import PortfolioAsset

    db_session.query(PortfolioAsset).filter(PortfolioAsset.portfolio_id == portfolio.id).delete()
    db_session.commit()
    assert get_portfolio_assets(db_session, portfolio.id) == []

    with pytest.raises(ValueError):
        compute_portfolio_analysis_payload(db_session, portfolio)
