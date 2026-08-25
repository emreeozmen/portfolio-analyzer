from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import minimize

TRADING_DAYS_PER_YEAR = 252


def daily_returns(prices: pd.Series) -> pd.Series:
    return prices.pct_change().dropna()


def total_return(prices: pd.Series) -> float:
    if len(prices) < 2:
        return 0.0
    return float(prices.iloc[-1] / prices.iloc[0] - 1)


def annualized_volatility(returns: pd.Series) -> float:
    return float(returns.std() * np.sqrt(TRADING_DAYS_PER_YEAR))


def sharpe_ratio(returns: pd.Series, risk_free_rate: float = 0.0) -> float:
    if returns.std() == 0:
        return 0.0
    excess_daily_rf = risk_free_rate / TRADING_DAYS_PER_YEAR
    excess_returns = returns - excess_daily_rf
    return float(
        excess_returns.mean() / returns.std() * np.sqrt(TRADING_DAYS_PER_YEAR)
    )


def rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's RSI (relative strength index), ported to match the frontend's
    `rsi()` in `frontend/src/lib/indicators.ts` value-for-value: the first average
    gain/loss is a simple mean over the first `period` diffs, then each subsequent
    value is smoothed as `(prev * (period - 1) + current) / period`. Used by
    `services/alert_service` to evaluate RSI-based price alerts against real OHLCV
    history — never fabricated.
    """
    values = prices.to_numpy(dtype=float)
    result = np.full(len(values), np.nan)
    if len(values) <= period:
        return pd.Series(result, index=prices.index)

    diffs = np.diff(values)
    gains = np.where(diffs > 0, diffs, 0.0)
    losses = np.where(diffs < 0, -diffs, 0.0)

    avg_gain = float(gains[:period].mean())
    avg_loss = float(losses[:period].mean())
    result[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)

    for i in range(period, len(diffs)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        result[i + 1] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)

    return pd.Series(result, index=prices.index)


def ema(prices: pd.Series, period: int) -> pd.Series:
    """Exponential moving average, ported to match the frontend's `ema()` in
    frontend/src/lib/indicators.ts value-for-value: seeded with a simple mean of the
    first `period` values, then smoothed forward with k = 2/(period+1).
    """
    values = prices.to_numpy(dtype=float)
    result = np.full(len(values), np.nan)
    if len(values) < period:
        return pd.Series(result, index=prices.index)

    k = 2.0 / (period + 1)
    prev = float(values[:period].mean())
    result[period - 1] = prev
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
        result[i] = prev
    return pd.Series(result, index=prices.index)


def macd_line_and_signal(prices: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Standard MACD(12,26,9), ported to match the frontend's `macd()` in
    frontend/src/lib/indicators.ts (MACD line = EMA(12) - EMA(26), signal = a
    9-period EMA of the MACD line itself). Unlike the frontend version — which only
    returns the latest snapshot value for a live technicals display — this returns
    the full series for both lines, since services/alert_service needs at least the
    last two points to detect a crossover, not just the current level.
    """
    macd_full = ema(prices, 12) - ema(prices, 26)
    macd_valid = macd_full.dropna()
    if macd_valid.empty:
        empty = pd.Series(np.nan, index=prices.index)
        return empty, empty
    signal_full = ema(macd_valid, 9).reindex(prices.index)
    return macd_full, signal_full


def max_drawdown(prices: pd.Series) -> float:
    running_max = prices.cummax()
    drawdown = prices / running_max - 1
    return float(drawdown.min())


def portfolio_allocation(holdings: dict[str, float]) -> dict[str, float]:
    total_value = sum(holdings.values())
    if total_value == 0:
        return {ticker: 0.0 for ticker in holdings}
    return {ticker: value / total_value for ticker, value in holdings.items()}


def summarize_portfolio(prices: pd.Series, risk_free_rate: float = 0.0) -> dict[str, float]:
    returns = daily_returns(prices)
    return {
        "total_return": total_return(prices),
        "annualized_volatility": annualized_volatility(returns),
        "sharpe_ratio": sharpe_ratio(returns, risk_free_rate),
        "max_drawdown": max_drawdown(prices),
    }


def optimize_portfolio_weights(
    returns_df: pd.DataFrame, risk_free_rate: float = 0.0, objective: str = "max_sharpe"
) -> dict[str, float]:
    """Solves for long-only portfolio weights (sum to 1, no shorting, no leverage) that either
    maximize the Sharpe ratio or minimize volatility, given the constituents' historical daily
    returns. Uses SLSQP (scipy.optimize.minimize's default solver for equality/inequality
    constraints) starting from an equal-weight guess. Falls back to equal weights if the
    solver doesn't converge, so callers always get a valid, fully-allocated weight set back.
    """
    if objective == "risk_parity":
        return risk_parity_weights(returns_df)

    tickers = list(returns_df.columns)
    n = len(tickers)
    if n == 0:
        return {}
    equal_weights = np.repeat(1.0 / n, n)
    if n == 1:
        return {tickers[0]: 1.0}

    mean_returns = returns_df.mean().to_numpy()
    cov_matrix = returns_df.cov().to_numpy()

    def portfolio_return_and_vol(weights: np.ndarray) -> tuple[float, float]:
        annual_return = float(weights @ mean_returns) * TRADING_DAYS_PER_YEAR
        annual_vol = float(np.sqrt(weights @ cov_matrix @ weights) * np.sqrt(TRADING_DAYS_PER_YEAR))
        return annual_return, annual_vol

    def negative_sharpe(weights: np.ndarray) -> float:
        annual_return, annual_vol = portfolio_return_and_vol(weights)
        if annual_vol == 0:
            return 0.0
        return -(annual_return - risk_free_rate) / annual_vol

    def annualized_variance(weights: np.ndarray) -> float:
        # Annualized (not raw daily) so its magnitude is comparable to negative_sharpe's,
        # and SLSQP's default ftol=1e-6 doesn't mistake a daily-return-scale (~1e-4) gradient
        # step for convergence and stop after a single iteration at the initial guess.
        return float(weights @ cov_matrix @ weights) * TRADING_DAYS_PER_YEAR

    objective_fn = negative_sharpe if objective == "max_sharpe" else annualized_variance
    constraints = ({"type": "eq", "fun": lambda w: np.sum(w) - 1},)
    bounds = tuple((0.0, 1.0) for _ in range(n))

    result = minimize(
        objective_fn, equal_weights, method="SLSQP", bounds=bounds, constraints=constraints, options={"ftol": 1e-12}
    )
    weights = result.x if result.success else equal_weights
    weights = np.clip(weights, 0, None)
    weights = weights / weights.sum()

    return {ticker: float(w) for ticker, w in zip(tickers, weights)}


def risk_parity_weights(returns_df: pd.DataFrame) -> dict[str, float]:
    """Solves for long-only weights (sum to 1) where every constituent contributes an
    equal share of total portfolio variance, rather than maximizing return or
    minimizing variance outright — a common third optimization objective (alongside
    max_sharpe/min_variance) for someone who wants risk *diversified*, not just
    minimized or return-maximized. Same SLSQP + equal-weight-fallback setup as
    optimize_portfolio_weights, and the same n==0/n==1 shortcuts.
    """
    tickers = list(returns_df.columns)
    n = len(tickers)
    if n == 0:
        return {}
    equal_weights = np.repeat(1.0 / n, n)
    if n == 1:
        return {tickers[0]: 1.0}

    cov_matrix = returns_df.cov().to_numpy() * TRADING_DAYS_PER_YEAR

    def risk_contributions(weights: np.ndarray) -> np.ndarray:
        portfolio_variance = float(weights @ cov_matrix @ weights)
        if portfolio_variance <= 0:
            return np.zeros(n)
        marginal_contribution = cov_matrix @ weights
        return weights * marginal_contribution / np.sqrt(portfolio_variance)

    def objective_fn(weights: np.ndarray) -> float:
        contributions = risk_contributions(weights)
        target = contributions.sum() / n
        return float(np.sum((contributions - target) ** 2))

    constraints = ({"type": "eq", "fun": lambda w: np.sum(w) - 1},)
    bounds = tuple((0.0, 1.0) for _ in range(n))

    result = minimize(
        objective_fn,
        equal_weights,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"ftol": 1e-14, "maxiter": 500},
    )
    weights = result.x if result.success else equal_weights
    weights = np.clip(weights, 0, None)
    total = weights.sum()
    weights = weights / total if total > 0 else equal_weights

    return {ticker: float(w) for ticker, w in zip(tickers, weights)}


def portfolio_expected_return_and_volatility(returns_df: pd.DataFrame, weights: dict[str, float]) -> tuple[float, float]:
    """Annualized (expected return, volatility) for an arbitrary weight set, on the same
    mean/variance basis `optimize_portfolio_weights` and `efficient_frontier` use — so a
    portfolio's point can be plotted directly against the frontier they trace.
    """
    w = np.array([weights.get(ticker, 0.0) for ticker in returns_df.columns])
    mean_returns = returns_df.mean().to_numpy()
    cov_matrix = returns_df.cov().to_numpy()
    annual_return = float(w @ mean_returns) * TRADING_DAYS_PER_YEAR
    annual_vol = float(np.sqrt(w @ cov_matrix @ w) * np.sqrt(TRADING_DAYS_PER_YEAR))
    return annual_return, annual_vol


def efficient_frontier(returns_df: pd.DataFrame, n_points: int = 20) -> list[dict[str, float]]:
    """Traces the long-only efficient frontier: for `n_points` target annual returns spanning
    the achievable range, solves for the minimum-variance weight set hitting that target
    (same SLSQP setup as `optimize_portfolio_weights`, plus a return-equality constraint).
    Points where the solver doesn't converge are skipped. For any volatility level there are
    generally two such minimum-variance points (a "Markowitz bullet" has an upper, efficient
    branch and a lower, inefficient one — the same variance can be hit by a higher or a lower
    return); this keeps only the upper branch (return at or above the global minimum-variance
    point), so the result traces the frontier as a single curve rather than zig-zagging between
    branches. Returns points sorted by ascending volatility, each `{"return": ..., "volatility":
    ...}` (annualized).
    """
    tickers = list(returns_df.columns)
    n = len(tickers)
    if n < 2:
        return []

    mean_returns = returns_df.mean().to_numpy()
    cov_matrix = returns_df.cov().to_numpy()
    annual_returns = mean_returns * TRADING_DAYS_PER_YEAR

    min_target, max_target = float(annual_returns.min()), float(annual_returns.max())
    if min_target == max_target:
        return []

    equal_weights = np.repeat(1.0 / n, n)
    bounds = tuple((0.0, 1.0) for _ in range(n))

    def annualized_variance(weights: np.ndarray) -> float:
        return float(weights @ cov_matrix @ weights) * TRADING_DAYS_PER_YEAR

    points: list[dict[str, float]] = []
    for target in np.linspace(min_target, max_target, n_points):
        constraints = (
            {"type": "eq", "fun": lambda w: np.sum(w) - 1},
            {"type": "eq", "fun": lambda w, t=target: float(w @ annual_returns) - t},
        )
        result = minimize(
            annualized_variance,
            equal_weights,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
            options={"ftol": 1e-12},
        )
        if not result.success:
            continue
        weights = np.clip(result.x, 0, None)
        weights = weights / weights.sum()
        annual_return = float(weights @ annual_returns)
        annual_vol = float(np.sqrt(weights @ cov_matrix @ weights) * np.sqrt(TRADING_DAYS_PER_YEAR))
        points.append({"return": annual_return, "volatility": annual_vol})

    if not points:
        return []

    min_vol_return = min(points, key=lambda p: p["volatility"])["return"]
    efficient_points = [p for p in points if p["return"] >= min_vol_return]
    efficient_points.sort(key=lambda p: p["volatility"])
    return efficient_points


def sortino_ratio(returns: pd.Series, risk_free_rate: float = 0.0) -> float:
    """Like sharpe_ratio, but only penalizes downside volatility (returns below the
    risk-free rate) rather than total volatility — a portfolio with large upside swings
    and no downside ones scores well here even though sharpe_ratio would flatten both
    into the same std-dev term.
    """
    excess_daily_rf = risk_free_rate / TRADING_DAYS_PER_YEAR
    excess_returns = returns - excess_daily_rf
    downside = excess_returns[excess_returns < 0]
    downside_std = downside.std()
    if not downside_std or np.isnan(downside_std):
        return 0.0
    return float(excess_returns.mean() / downside_std * np.sqrt(TRADING_DAYS_PER_YEAR))


def calmar_ratio(returns: pd.Series, prices: pd.Series) -> float:
    """Annualized return divided by the magnitude of the worst peak-to-trough
    drawdown — how much return was earned per unit of the worst pain actually
    experienced, rather than per unit of day-to-day volatility (sharpe_ratio) or
    downside volatility (sortino_ratio).
    """
    drawdown = max_drawdown(prices)
    if drawdown == 0:
        return 0.0
    annual_return = float(returns.mean() * TRADING_DAYS_PER_YEAR)
    return float(annual_return / abs(drawdown))


def return_skewness(returns: pd.Series) -> float:
    if len(returns) < 3:
        return 0.0
    return float(stats.skew(returns.to_numpy(dtype=float), bias=False))


def return_kurtosis(returns: pd.Series) -> float:
    """Excess kurtosis (0 = normal distribution) of the daily return series — a
    positive value flags fat tails (extreme days more frequent than a normal
    distribution would predict), relevant alongside skewness for judging whether the
    parametric assumption behind monte_carlo_simulation's normal-distribution draw is
    a reasonable approximation for this particular portfolio's real history.
    """
    if len(returns) < 4:
        return 0.0
    return float(stats.kurtosis(returns.to_numpy(dtype=float), bias=False))


def historical_var(returns: pd.Series, confidence: float = 0.95) -> float:
    """Historical (non-parametric) single-day Value-at-Risk: the loss, as a positive
    fraction, not expected to be exceeded on `confidence` of days, read directly off
    the real historical daily-return distribution rather than a simulated one.
    """
    if len(returns) == 0:
        return 0.0
    quantile = float(np.percentile(returns.to_numpy(dtype=float), (1 - confidence) * 100))
    return float(max(0.0, -quantile))


def historical_cvar(returns: pd.Series, confidence: float = 0.95) -> float:
    """Historical Conditional VaR (Expected Shortfall): the average loss on the worst
    (1 - confidence) fraction of historical days, not just the boundary loss
    historical_var reports.
    """
    if len(returns) == 0:
        return 0.0
    values = returns.to_numpy(dtype=float)
    quantile = np.percentile(values, (1 - confidence) * 100)
    tail = values[values <= quantile]
    if len(tail) == 0:
        return 0.0
    return float(max(0.0, -tail.mean()))


def monte_carlo_simulation(
    returns_df: pd.DataFrame,
    weights: dict[str, float],
    horizon_days: int,
    confidence_level: float = 0.95,
    n_simulations: int = 2000,
    seed: int | None = None,
) -> dict | None:
    """Multi-asset Monte Carlo projection of a portfolio's future value. Each simulated
    day's per-asset returns are drawn jointly from a multivariate normal distribution
    fit to the constituents' own historical mean/covariance (returns_df.mean()/.cov()),
    so simulated paths inherit the real correlation structure between assets —
    diversification benefit (or its absence) shows up in the resulting spread, unlike
    resampling a single already-combined portfolio series which discards
    constituent-level correlation entirely. Uses initial_value=100 (matches the
    portfolio_index base) so callers scale to a real currency amount if needed.
    """
    tickers = list(returns_df.columns)
    n = len(tickers)
    if n == 0 or horizon_days < 1 or n_simulations < 1:
        return None

    weight_vector = np.array([weights.get(ticker, 0.0) for ticker in tickers])
    mean_returns = returns_df.mean().to_numpy()
    cov_matrix = returns_df.cov().to_numpy()

    rng = np.random.default_rng(seed)
    sampled = rng.multivariate_normal(mean_returns, cov_matrix, size=(n_simulations, horizon_days))
    portfolio_daily_returns = sampled @ weight_vector  # (n_simulations, horizon_days)
    growth = np.cumprod(1 + portfolio_daily_returns, axis=1)

    initial_value = 100.0
    paths = np.concatenate([np.full((n_simulations, 1), initial_value), initial_value * growth], axis=1)

    lower_p = (1 - confidence_level) * 100
    upper_p = confidence_level * 100
    lower_bound, p50, upper_bound = np.percentile(paths, [lower_p, 50, upper_p], axis=0)

    final_values = np.sort(paths[:, -1])
    quantile_index = min(len(final_values) - 1, max(0, round((1 - confidence_level) * (len(final_values) - 1))))
    quantile_value = final_values[quantile_index]
    value_at_risk_percent = max(0.0, (initial_value - quantile_value) / initial_value)
    tail = final_values[: quantile_index + 1]
    conditional_value_at_risk_percent = max(0.0, (initial_value - float(tail.mean())) / initial_value)
    probability_of_loss = float((final_values < initial_value).mean())

    return {
        "days": list(range(horizon_days + 1)),
        "lower_bound": lower_bound.tolist(),
        "p50": p50.tolist(),
        "upper_bound": upper_bound.tolist(),
        "value_at_risk_percent": float(value_at_risk_percent),
        "conditional_value_at_risk_percent": float(conditional_value_at_risk_percent),
        "probability_of_loss": probability_of_loss,
        "expected_value": float(final_values.mean()),
        "best_case": float(final_values[-1]),
        "worst_case": float(final_values[0]),
        "confidence_level": confidence_level,
        "horizon_days": horizon_days,
    }


def goal_projection(
    returns_df: pd.DataFrame,
    weights: dict[str, float],
    initial_value: float,
    monthly_contribution: float,
    target_value: float,
    horizon_months: int,
    n_simulations: int = 2000,
    seed: int | None = None,
) -> dict | None:
    """Goal-based savings projection sharing monte_carlo_simulation's correlated
    multi-asset draw, but simulated month-by-month (21 trading days per month) with a
    recurring contribution added at the end of each month — the actual mechanic a
    savings goal needs, which a lump-sum VaR/CVaR projection doesn't model.
    """
    tickers = list(returns_df.columns)
    n = len(tickers)
    if (
        n == 0
        or horizon_months < 1
        or target_value <= 0
        or initial_value < 0
        or monthly_contribution < 0
        or n_simulations < 1
    ):
        return None

    weight_vector = np.array([weights.get(ticker, 0.0) for ticker in tickers])
    mean_returns = returns_df.mean().to_numpy()
    cov_matrix = returns_df.cov().to_numpy()
    trading_days_per_month = 21

    rng = np.random.default_rng(seed)
    sampled = rng.multivariate_normal(
        mean_returns, cov_matrix, size=(n_simulations, horizon_months * trading_days_per_month)
    )
    portfolio_daily_returns = (sampled @ weight_vector).reshape(n_simulations, horizon_months, trading_days_per_month)
    month_growth = np.prod(1 + portfolio_daily_returns, axis=2)  # (n_simulations, horizon_months)

    values = np.empty((n_simulations, horizon_months + 1))
    values[:, 0] = initial_value
    months_to_goal = np.full(n_simulations, -1, dtype=int)
    months_to_goal[values[:, 0] >= target_value] = 0

    current = np.full(n_simulations, initial_value)
    for month in range(1, horizon_months + 1):
        current = current * month_growth[:, month - 1] + monthly_contribution
        values[:, month] = current
        newly_reached = (months_to_goal == -1) & (current >= target_value)
        months_to_goal[newly_reached] = month

    lower_path = np.percentile(values, 10, axis=0).tolist()
    median_path = np.percentile(values, 50, axis=0).tolist()
    upper_path = np.percentile(values, 90, axis=0).tolist()

    reached_months = months_to_goal[months_to_goal >= 0]

    def _percentile_or_none(arr: np.ndarray, p: float) -> float | None:
        return float(np.percentile(arr, p)) if len(arr) > 0 else None

    return {
        "horizon_months": horizon_months,
        "target_value": target_value,
        "median_months_to_goal": _percentile_or_none(reached_months, 50),
        "optimistic_months_to_goal": _percentile_or_none(reached_months, 10),
        "pessimistic_months_to_goal": _percentile_or_none(reached_months, 90),
        "probability_within_horizon": float(len(reached_months) / n_simulations),
        "months": list(range(horizon_months + 1)),
        "median_path": median_path,
        "lower_path": lower_path,
        "upper_path": upper_path,
    }


def _format_date(value) -> str:
    """Formats a pandas Timestamp/date-like index value as a plain ISO date
    ("2025-09-25"), not str()'s default "2025-09-25 00:00:00" — every other date
    already surfaced by this app (e.g. analysis_service.portfolio_analysis's
    portfolio_index) is date-only, so these should match rather than looking like a
    different kind of value to the frontend.
    """
    if hasattr(value, "date"):
        return value.date().isoformat()
    return str(value)


def rolling_backtest(portfolio_index: pd.Series, window_days: int) -> dict | None:
    """Rolling-window backtest: for every possible start date in the portfolio's real
    realized index history, what return would a fixed-length holding window starting
    there have produced? Replays the actual historical series (no resampling), so this
    is a real empirical distribution of outcomes, not a simulated one — the backend
    counterpart of the frontend's now-retired `lib/backtest.ts`.
    """
    n = len(portfolio_index)
    if n <= window_days or window_days < 1:
        return None

    values = portfolio_index.to_numpy(dtype=float)
    dates = portfolio_index.index
    points: list[dict] = []
    for i in range(0, n - window_days):
        start_value = values[i]
        if start_value <= 0:
            continue
        end_value = values[i + window_days]
        points.append({"start_date": _format_date(dates[i]), "return_percent": float((end_value / start_value - 1) * 100)})

    if not points:
        return None

    returns_arr = np.array([p["return_percent"] for p in points])
    sorted_arr = np.sort(returns_arr)

    return {
        "window_days": window_days,
        "sample_count": len(points),
        "mean_return_percent": float(returns_arr.mean()),
        "median_return_percent": float(np.median(returns_arr)),
        "best_return_percent": float(sorted_arr[-1]),
        "worst_return_percent": float(sorted_arr[0]),
        "positive_rate": float((returns_arr > 0).mean()),
        "points": points,
    }


def worst_drawdown_period(prices: pd.Series) -> dict | None:
    """Detects the single largest peak-to-trough decline actually present in the given
    price history — the peak date, the trough date, its magnitude, and (if the series
    recovers to a new high before its end) the recovery date. Deliberately not a
    hardcoded crisis window (e.g. "2008" or "2020 Covid"): this app's price history is
    only ~1 year deep, and inventing a period the data doesn't cover would violate the
    project's real-data-only rule — this instead reports whatever the worst decline
    actually was within the data on hand.
    """
    if len(prices) < 2:
        return None

    values = prices.to_numpy(dtype=float)
    dates = prices.index
    running_max = np.maximum.accumulate(values)
    drawdown = values / running_max - 1
    trough_idx = int(np.argmin(drawdown))
    if drawdown[trough_idx] >= 0:
        return None

    peak_value = running_max[trough_idx]
    peak_idx = int(np.where(values[: trough_idx + 1] == peak_value)[0][-1])
    recovery_idx = next((i for i in range(trough_idx + 1, len(values)) if values[i] >= peak_value), None)

    return {
        "peak_date": _format_date(dates[peak_idx]),
        "trough_date": _format_date(dates[trough_idx]),
        "recovery_date": _format_date(dates[recovery_idx]) if recovery_idx is not None else None,
        "drawdown_percent": float(drawdown[trough_idx] * 100),
    }
