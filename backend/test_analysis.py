import numpy as np
import pandas as pd
import pytest

from analysis.portfolio_metrics import (
    TRADING_DAYS_PER_YEAR,
    annualized_volatility,
    calmar_ratio,
    daily_returns,
    efficient_frontier,
    ema,
    goal_projection,
    historical_cvar,
    historical_var,
    macd_line_and_signal,
    max_drawdown,
    monte_carlo_simulation,
    optimize_portfolio_weights,
    portfolio_expected_return_and_volatility,
    return_kurtosis,
    return_skewness,
    risk_parity_weights,
    rolling_backtest,
    rsi,
    sharpe_ratio,
    sortino_ratio,
    total_return,
    worst_drawdown_period,
)


def test_total_return():
    prices = pd.Series([100, 110, 121])
    assert total_return(prices) == pytest.approx(0.21)


def test_daily_returns_length():
    prices = pd.Series([100, 105, 100])
    assert len(daily_returns(prices)) == 2


def test_max_drawdown():
    prices = pd.Series([100, 120, 90, 110])
    assert max_drawdown(prices) == -0.25


def test_annualized_volatility_nonnegative():
    prices = pd.Series([100, 102, 99, 105, 101])
    returns = daily_returns(prices)
    assert annualized_volatility(returns) >= 0


def test_sharpe_ratio_zero_std_returns_zero():
    returns = pd.Series([0.0, 0.0, 0.0])
    assert sharpe_ratio(returns) == 0.0


def _synthetic_returns_df(n_days: int = 500, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    calm = rng.normal(0.0004, 0.005, n_days)
    volatile = rng.normal(0.0008, 0.03, n_days)
    return pd.DataFrame({"CALM": calm, "VOLATILE": volatile})


def _synthetic_returns_df_3assets(n_days: int = 500, seed: int = 1) -> pd.DataFrame:
    # Three uncorrelated assets on a genuine risk/return tradeoff (higher mean return pairs
    # with higher volatility, so none dominates) -- unlike the 2-asset fixture above, which
    # under some seeds has one asset dominate the other and collapse the frontier to a
    # single point. A real tradeoff is needed to exercise the multi-point frontier code path.
    rng = np.random.default_rng(seed)
    low = rng.normal(0.0002, 0.005, n_days)
    med = rng.normal(0.0005, 0.015, n_days)
    high = rng.normal(0.0009, 0.03, n_days)
    return pd.DataFrame({"LOW": low, "MED": med, "HIGH": high})


def test_optimize_portfolio_weights_single_asset():
    returns_df = pd.DataFrame({"AAPL": [0.01, -0.01, 0.02]})
    assert optimize_portfolio_weights(returns_df) == {"AAPL": 1.0}


def test_optimize_portfolio_weights_sum_to_one_and_nonnegative():
    weights = optimize_portfolio_weights(_synthetic_returns_df(), objective="max_sharpe")
    assert sum(weights.values()) == pytest.approx(1.0)
    assert all(w >= 0 for w in weights.values())


def test_optimize_portfolio_weights_min_variance_favors_calmer_asset():
    weights = optimize_portfolio_weights(_synthetic_returns_df(), objective="min_variance")
    assert weights["CALM"] > weights["VOLATILE"]


def test_risk_parity_weights_single_asset():
    returns_df = pd.DataFrame({"AAPL": [0.01, -0.01, 0.02]})
    assert risk_parity_weights(returns_df) == {"AAPL": 1.0}


def test_risk_parity_weights_sum_to_one_and_nonnegative():
    weights = risk_parity_weights(_synthetic_returns_df())
    assert sum(weights.values()) == pytest.approx(1.0)
    assert all(w >= 0 for w in weights.values())


def test_risk_parity_weights_favors_calmer_asset_less_extremely_than_min_variance():
    # Risk parity still tilts away from the volatile asset (it's genuinely riskier),
    # but not all the way to min-variance's more extreme tilt — it's balancing risk
    # *contribution*, not minimizing total variance outright.
    df = _synthetic_returns_df()
    rp_weights = risk_parity_weights(df)
    mv_weights = optimize_portfolio_weights(df, objective="min_variance")

    assert rp_weights["CALM"] > rp_weights["VOLATILE"]
    assert rp_weights["CALM"] < mv_weights["CALM"]


def test_risk_parity_weights_equalizes_risk_contribution():
    df = _synthetic_returns_df()
    weights = risk_parity_weights(df)
    w = np.array([weights["CALM"], weights["VOLATILE"]])
    cov = df.cov().to_numpy() * TRADING_DAYS_PER_YEAR

    portfolio_variance = float(w @ cov @ w)
    marginal = cov @ w
    contributions = w * marginal / np.sqrt(portfolio_variance)

    assert contributions[0] == pytest.approx(contributions[1], rel=0.05)


def test_optimize_portfolio_weights_dispatches_risk_parity_objective():
    df = _synthetic_returns_df()
    assert optimize_portfolio_weights(df, objective="risk_parity") == risk_parity_weights(df)


def test_efficient_frontier_too_few_assets_returns_empty():
    assert efficient_frontier(pd.DataFrame({"AAPL": [0.01, -0.01, 0.02]})) == []


def test_efficient_frontier_sorted_by_ascending_volatility_and_return():
    # Only the upper (efficient) branch of the min-variance frontier is kept, so both
    # volatility and return should rise together with no zig-zagging between branches.
    points = efficient_frontier(_synthetic_returns_df_3assets(), n_points=15)
    assert len(points) > 1
    volatilities = [p["volatility"] for p in points]
    returns_seen = [p["return"] for p in points]
    assert volatilities == sorted(volatilities)
    assert returns_seen == sorted(returns_seen)


def test_efficient_frontier_reaches_the_max_achievable_return():
    returns_df = _synthetic_returns_df_3assets()
    points = efficient_frontier(returns_df, n_points=15)
    annual_returns = returns_df.mean().to_numpy() * 252
    assert max(p["return"] for p in points) == pytest.approx(annual_returns.max(), abs=1e-3)


def test_portfolio_expected_return_and_volatility_matches_single_asset():
    returns_df = _synthetic_returns_df()
    annual_return, annual_vol = portfolio_expected_return_and_volatility(returns_df, {"CALM": 1.0, "VOLATILE": 0.0})
    assert annual_return == pytest.approx(returns_df["CALM"].mean() * 252)
    assert annual_vol == pytest.approx(returns_df["CALM"].std() * (252**0.5))


def test_rsi_too_short_series_is_all_nan():
    result = rsi(pd.Series([100, 101, 102]), period=14)
    assert result.isna().all()


def test_rsi_all_gains_reaches_100():
    prices = pd.Series(range(100, 120))  # strictly increasing -> no losses at all
    result = rsi(prices, period=14)
    assert result.iloc[-1] == pytest.approx(100.0)


def test_rsi_all_losses_reaches_0():
    prices = pd.Series(range(120, 100, -1))  # strictly decreasing -> no gains at all
    result = rsi(prices, period=14)
    assert result.iloc[-1] == pytest.approx(0.0)


def test_rsi_mixed_series_stays_within_bounds():
    rng = np.random.default_rng(2)
    prices = pd.Series(100 + np.cumsum(rng.normal(0, 1, 60)))
    result = rsi(prices, period=14).dropna()
    assert len(result) > 0
    assert result.between(0, 100).all()


def _dated_price_series(values: list[float], start: str = "2025-01-01") -> pd.Series:
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="D"))


def test_sortino_ratio_zero_downside_returns_zero():
    returns = pd.Series([0.01, 0.02, 0.015])  # no negative excess returns at all
    assert sortino_ratio(returns) == 0.0


def test_sortino_ratio_penalizes_only_downside():
    returns = pd.Series([0.03, -0.01, 0.02, -0.02, 0.01])
    assert sortino_ratio(returns) != 0.0


def test_calmar_ratio_zero_drawdown_returns_zero():
    prices = _dated_price_series([100, 101, 102, 103])  # strictly increasing -> no drawdown
    returns = daily_returns(prices)
    assert calmar_ratio(returns, prices) == 0.0


def test_calmar_ratio_positive_for_net_uptrend_with_a_dip():
    prices = _dated_price_series([100, 110, 95, 120])
    returns = daily_returns(prices)
    assert calmar_ratio(returns, prices) > 0


def test_return_skewness_and_kurtosis_finite_for_synthetic_data():
    returns = _synthetic_returns_df()["VOLATILE"]
    assert np.isfinite(return_skewness(returns))
    assert np.isfinite(return_kurtosis(returns))


def test_return_skewness_zero_for_too_short_series():
    assert return_skewness(pd.Series([0.01, -0.01])) == 0.0


def test_historical_var_and_cvar_nonnegative_and_ordered():
    returns = _synthetic_returns_df()["VOLATILE"]
    var_95 = historical_var(returns, 0.95)
    cvar_95 = historical_cvar(returns, 0.95)
    assert var_95 >= 0
    assert cvar_95 >= 0
    # CVaR averages the tail beyond VaR's boundary, so it's at least as large.
    assert cvar_95 >= var_95 - 1e-9


def test_monte_carlo_simulation_basic_shape_and_bounds():
    returns_df = _synthetic_returns_df()
    weights = {"CALM": 0.5, "VOLATILE": 0.5}
    result = monte_carlo_simulation(returns_df, weights, horizon_days=30, n_simulations=500, seed=42)
    assert result is not None
    assert len(result["days"]) == 31
    assert len(result["lower_bound"]) == len(result["p50"]) == len(result["upper_bound"]) == 31
    assert result["lower_bound"][-1] <= result["p50"][-1] <= result["upper_bound"][-1]
    assert 0 <= result["value_at_risk_percent"]
    assert result["conditional_value_at_risk_percent"] >= result["value_at_risk_percent"] - 1e-9
    assert 0 <= result["probability_of_loss"] <= 1


def test_monte_carlo_simulation_deterministic_with_seed():
    returns_df = _synthetic_returns_df()
    weights = {"CALM": 0.5, "VOLATILE": 0.5}
    a = monte_carlo_simulation(returns_df, weights, horizon_days=20, n_simulations=200, seed=7)
    b = monte_carlo_simulation(returns_df, weights, horizon_days=20, n_simulations=200, seed=7)
    assert a == b


def test_monte_carlo_simulation_no_assets_returns_none():
    assert monte_carlo_simulation(pd.DataFrame(), {}, horizon_days=10) is None


def test_goal_projection_probability_within_bounds():
    returns_df = _synthetic_returns_df()
    weights = {"CALM": 0.5, "VOLATILE": 0.5}
    result = goal_projection(
        returns_df, weights, initial_value=100.0, monthly_contribution=5.0,
        target_value=150.0, horizon_months=24, n_simulations=500, seed=42,
    )
    assert result is not None
    assert 0 <= result["probability_within_horizon"] <= 1
    assert len(result["months"]) == 25


def test_goal_projection_already_reached_gives_zero_median_months():
    returns_df = _synthetic_returns_df()
    weights = {"CALM": 0.5, "VOLATILE": 0.5}
    result = goal_projection(
        returns_df, weights, initial_value=1000.0, monthly_contribution=0.0,
        target_value=1.0, horizon_months=12, n_simulations=200, seed=1,
    )
    assert result["median_months_to_goal"] == 0
    assert result["probability_within_horizon"] == 1.0


def test_goal_projection_invalid_inputs_return_none():
    returns_df = _synthetic_returns_df()
    weights = {"CALM": 0.5, "VOLATILE": 0.5}
    assert goal_projection(returns_df, weights, 100.0, 0.0, target_value=0.0, horizon_months=12) is None
    assert goal_projection(returns_df, weights, -1.0, 0.0, target_value=100.0, horizon_months=12) is None


def test_rolling_backtest_insufficient_data_returns_none():
    prices = _dated_price_series([100, 101, 102])
    assert rolling_backtest(prices, window_days=30) is None


def test_rolling_backtest_basic_stats():
    prices = _dated_price_series([100, 105, 110, 108, 115, 120])
    result = rolling_backtest(prices, window_days=2)
    assert result is not None
    assert result["sample_count"] == 4
    assert result["worst_return_percent"] <= result["mean_return_percent"] <= result["best_return_percent"]
    assert 0 <= result["positive_rate"] <= 1


def test_worst_drawdown_period_detects_known_drawdown():
    prices = _dated_price_series([100, 120, 90, 130])
    result = worst_drawdown_period(prices)
    assert result is not None
    assert result["drawdown_percent"] == pytest.approx((90 / 120 - 1) * 100)
    assert result["recovery_date"] is not None  # recovers to a new high (130) before the series ends


def test_worst_drawdown_period_no_decline_returns_none():
    prices = _dated_price_series([100, 101, 102, 103])
    assert worst_drawdown_period(prices) is None


def test_ema_too_short_series_is_all_nan():
    result = ema(pd.Series([1.0, 2.0, 3.0]), period=5)
    assert result.isna().all()


def test_ema_seeds_with_simple_mean_of_first_period():
    prices = pd.Series([10.0, 20.0, 30.0])
    result = ema(prices, period=3)
    assert result.iloc[2] == pytest.approx(20.0)  # mean(10, 20, 30)


def test_ema_smooths_forward_after_seed():
    prices = pd.Series([10.0, 20.0, 30.0, 40.0])
    result = ema(prices, period=3)
    k = 2 / 4
    expected = 40.0 * k + 20.0 * (1 - k)
    assert result.iloc[3] == pytest.approx(expected)


def test_macd_line_and_signal_returns_full_length_series():
    prices = pd.Series(100.0 + np.cumsum(np.random.default_rng(1).normal(0, 1, 60)))
    macd_line, signal_line = macd_line_and_signal(prices)
    assert len(macd_line) == len(prices)
    assert len(signal_line) == len(prices)
    assert macd_line.iloc[:25].isna().all()  # EMA(26) isn't defined yet


def test_macd_line_and_signal_too_short_series_returns_all_nan():
    macd_line, signal_line = macd_line_and_signal(pd.Series([1.0, 2.0, 3.0]))
    assert macd_line.isna().all()
    assert signal_line.isna().all()
