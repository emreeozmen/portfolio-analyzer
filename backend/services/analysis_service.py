import pandas as pd

from analysis.portfolio_metrics import (
    annualized_volatility,
    calmar_ratio,
    daily_returns,
    efficient_frontier,
    goal_projection,
    historical_cvar,
    historical_var,
    max_drawdown,
    monte_carlo_simulation,
    optimize_portfolio_weights,
    portfolio_expected_return_and_volatility,
    return_kurtosis,
    return_skewness,
    rolling_backtest,
    sharpe_ratio,
    sortino_ratio,
    total_return,
    worst_drawdown_period,
)
from models import PriceHistory

# Approximate annual risk-free rate assumptions by currency, used only for Sharpe ratio.
# These are rough, hand-set placeholders (TL mevduat/tahvil ~ TRY, T-bill ~ USD/EUR) rather
# than a live rate feed this project has no licensed source for — kept as an explicit,
# documented assumption instead of silently assuming 0% for every currency.
RISK_FREE_RATES: dict[str, float] = {
    "TRY": 0.45,
    "USD": 0.045,
    "EUR": 0.03,
    "GBP": 0.045,
}


def risk_free_rate_for(currency: str) -> float:
    return RISK_FREE_RATES.get(currency.upper(), 0.0)


def prices_to_series(price_rows: list[PriceHistory]) -> pd.Series:
    return pd.Series(
        data=[row.close_price for row in price_rows],
        index=pd.DatetimeIndex([row.date for row in price_rows]),
    )


def asset_analysis(price_rows: list[PriceHistory], currency: str = "USD") -> dict:
    prices = prices_to_series(price_rows)
    returns = daily_returns(prices)
    risk_free_rate = risk_free_rate_for(currency)

    daily = [
        {
            "date": row.date.isoformat(),
            "open_price": row.open_price,
            "high_price": row.high_price,
            "low_price": row.low_price,
            "close_price": row.close_price,
            "volume": row.volume,
            "daily_return": float(returns.loc[pd.Timestamp(row.date)]) if pd.Timestamp(row.date) in returns.index else None,
        }
        for row in price_rows
    ]

    return {
        "prices": daily,
        "summary": {
            "average_return": float(returns.mean()) if not returns.empty else 0.0,
            "volatility": annualized_volatility(returns),
            "max_drawdown": max_drawdown(prices),
            "sharpe_ratio": sharpe_ratio(returns, risk_free_rate),
        },
    }


def portfolio_value_series(price_series_by_ticker: dict[str, pd.Series], weights: dict[str, float]) -> pd.Series:
    """Combines per-asset price series into a single weighted index, normalized to start at 100."""
    df = pd.DataFrame(price_series_by_ticker).dropna()
    normalized = df / df.iloc[0]
    weighted = sum(normalized[ticker] * weights[ticker] for ticker in weights)
    return weighted * 100


def _aligned_returns(price_series_by_ticker: dict[str, pd.Series]) -> pd.DataFrame:
    """Daily pct-change returns for every constituent, aligned on their overlapping
    dates only (rows with any missing ticker dropped) — the shared basis for
    optimization, the efficient frontier, and the Monte Carlo/goal-planning
    simulations below, so all of them agree on exactly the same historical window.
    """
    df = pd.DataFrame(price_series_by_ticker).dropna()
    return df.pct_change().dropna()


def portfolio_analysis(
    price_series_by_ticker: dict[str, pd.Series], weights: dict[str, float], risk_free_rate: float = 0.0
) -> dict:
    portfolio_index = portfolio_value_series(price_series_by_ticker, weights)
    returns = daily_returns(portfolio_index)

    return {
        "portfolio_index": [
            {"date": d.date().isoformat(), "value": float(v)} for d, v in portfolio_index.items()
        ],
        "summary": {
            "total_return": total_return(portfolio_index),
            "average_return": float(returns.mean()) if not returns.empty else 0.0,
            "volatility": annualized_volatility(returns),
            "max_drawdown": max_drawdown(portfolio_index),
            "sharpe_ratio": sharpe_ratio(returns, risk_free_rate),
            "sortino_ratio": sortino_ratio(returns, risk_free_rate) if not returns.empty else 0.0,
            "calmar_ratio": calmar_ratio(returns, portfolio_index) if not returns.empty else 0.0,
            "skewness": return_skewness(returns),
            "kurtosis": return_kurtosis(returns),
            "historical_var_95": historical_var(returns, 0.95),
            "historical_cvar_95": historical_cvar(returns, 0.95),
        },
    }


def monte_carlo_analysis(
    price_series_by_ticker: dict[str, pd.Series],
    weights: dict[str, float],
    horizon_days: int,
    confidence_level: float = 0.95,
    n_simulations: int = 2000,
) -> dict | None:
    """Multi-asset, correlation-aware Monte Carlo projection for the given portfolio —
    see analysis.portfolio_metrics.monte_carlo_simulation for the simulation itself."""
    returns = _aligned_returns(price_series_by_ticker)
    return monte_carlo_simulation(
        returns, weights, horizon_days, confidence_level=confidence_level, n_simulations=n_simulations
    )


def goal_planning_analysis(
    price_series_by_ticker: dict[str, pd.Series],
    weights: dict[str, float],
    initial_value: float,
    monthly_contribution: float,
    target_value: float,
    horizon_months: int,
    n_simulations: int = 2000,
) -> dict | None:
    returns = _aligned_returns(price_series_by_ticker)
    return goal_projection(
        returns,
        weights,
        initial_value=initial_value,
        monthly_contribution=monthly_contribution,
        target_value=target_value,
        horizon_months=horizon_months,
        n_simulations=n_simulations,
    )


def backtest_analysis(
    price_series_by_ticker: dict[str, pd.Series], weights: dict[str, float], window_days: int
) -> dict | None:
    """Rolling-window backtest over the portfolio's real realized index history, plus
    the worst peak-to-trough drawdown actually present in that same history — see
    analysis.portfolio_metrics.rolling_backtest / worst_drawdown_period.
    """
    portfolio_index = portfolio_value_series(price_series_by_ticker, weights)
    backtest = rolling_backtest(portfolio_index, window_days)
    if backtest is None:
        return None
    backtest["worst_drawdown_period"] = worst_drawdown_period(portfolio_index)
    return backtest


def correlation_matrix(price_series_by_ticker: dict[str, pd.Series]) -> dict:
    """Pairwise Pearson correlation of daily returns between portfolio constituents.
    Needs at least two assets with overlapping price history to be meaningful.
    """
    tickers = list(price_series_by_ticker.keys())
    if len(tickers) < 2:
        return {"tickers": tickers, "matrix": [[1.0] * len(tickers)] if tickers else []}

    df = pd.DataFrame(price_series_by_ticker).dropna()
    returns = df.pct_change().dropna()
    corr = returns.corr()
    return {
        "tickers": tickers,
        "matrix": [[float(corr.loc[t1, t2]) for t2 in tickers] for t1 in tickers],
    }


def optimize_weights(
    price_series_by_ticker: dict[str, pd.Series], risk_free_rate: float = 0.0, objective: str = "max_sharpe"
) -> dict[str, float]:
    """Suggests long-only weights for the given constituents that either maximize the
    Sharpe ratio or minimize volatility, based on their overlapping historical daily returns.
    """
    returns = _aligned_returns(price_series_by_ticker)
    return optimize_portfolio_weights(returns, risk_free_rate=risk_free_rate, objective=objective)


def compute_efficient_frontier(price_series_by_ticker: dict[str, pd.Series], n_points: int = 20) -> list[dict]:
    """Traces the long-only efficient frontier for the given constituents, based on their
    overlapping historical daily returns.
    """
    returns = _aligned_returns(price_series_by_ticker)
    return efficient_frontier(returns, n_points=n_points)


def expected_return_and_volatility(price_series_by_ticker: dict[str, pd.Series], weights: dict[str, float]) -> dict:
    """A weight set's annualized (expected return, volatility), on the same basis the
    efficient frontier is traced on, so it can be plotted against it directly."""
    returns = _aligned_returns(price_series_by_ticker)
    annual_return, annual_vol = portfolio_expected_return_and_volatility(returns, weights)
    return {"return": annual_return, "volatility": annual_vol}


def group_weights_by_attribute(items: list[tuple[str | None, float]]) -> list[dict]:
    """Sums portfolio weight by an arbitrary per-asset attribute (sector, currency, ...).
    `None`/empty values (e.g. a sector yfinance never reported) are grouped under
    "Bilinmiyor" rather than dropped, so the breakdown still accounts for 100% of the
    portfolio. Returned sorted by descending weight.
    """
    totals: dict[str, float] = {}
    for attr, weight in items:
        key = attr if attr else "Bilinmiyor"
        totals[key] = totals.get(key, 0.0) + weight
    return sorted(
        ({"label": label, "weight": weight} for label, weight in totals.items()),
        key=lambda row: -row["weight"],
    )


def benchmark_index_series(benchmark_prices: dict[str, float], reference_dates: list[str]) -> list[dict]:
    """Aligns a benchmark's raw close prices onto the portfolio's own date axis and
    normalizes it to the same base=100 starting point, so it can be overlaid directly
    on the portfolio index chart.
    """
    if not benchmark_prices or not reference_dates:
        return []
    series = pd.Series(benchmark_prices)
    aligned = series.reindex(reference_dates).ffill().bfill()
    if aligned.empty or aligned.iloc[0] in (0, None) or pd.isna(aligned.iloc[0]):
        return []
    normalized = aligned / aligned.iloc[0] * 100
    return [{"date": d, "value": float(v)} for d, v in normalized.items()]
