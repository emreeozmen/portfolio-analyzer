"""Builds the content for the opt-in weekly/monthly portfolio-performance digest email
(see models/user.py's digest_frequency, email_service.send_portfolio_digest_email, and
main.py's _digest_email_loop). Deliberately reuses the same price history and
analysis_service functions /portfolios/{id}/analysis is built on rather than a separate
calculation, so a digest number always agrees with what the app itself would show.
"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from models import User
from services import analysis_service, portfolio_builder_service, price_service

FREQUENCY_DAYS: dict[str, int] = {"weekly": 7, "monthly": 30}
FREQUENCY_LABELS: dict[str, str] = {"weekly": "Haftalık", "monthly": "Aylık"}


def users_due_for_digest(db: Session, frequency: str) -> list[User]:
    """Users opted into `frequency` whose last digest (if any) is old enough that
    another one is due. Compares elapsed time rather than tracking calendar week/month
    boundaries — simpler, and consistent with how this app's other background loops
    (see main.py's _auto_refresh_loop and friends) just sleep-and-recheck on a fixed
    interval rather than using a job-scheduler library.
    """
    cutoff = datetime.utcnow() - timedelta(days=FREQUENCY_DAYS[frequency])
    return (
        db.query(User)
        .filter(User.digest_frequency == frequency)
        .filter((User.last_digest_sent_at.is_(None)) | (User.last_digest_sent_at <= cutoff))
        .all()
    )


def _period_return_percent(values: list[float], days: int) -> float | None:
    if len(values) < 2:
        return None
    start_index = max(0, len(values) - 1 - days)
    start, latest = values[start_index], values[-1]
    if start == 0:
        return None
    return (latest / start - 1) * 100


def build_digest_content(db: Session, user: User, frequency: str) -> list[dict] | None:
    """One summary row per portfolio the user owns: its own period return, plus its
    best/worst-performing constituent over the same window (by that asset's own price
    return, not its weighted contribution). A portfolio is skipped if any of its
    constituents is missing price history, same strictness compute_portfolio_analysis
    _payload applies for the live analysis endpoint. Returns None if nothing could be
    computed, so the caller can skip sending an empty digest.
    """
    days = FREQUENCY_DAYS[frequency]
    rows: list[dict] = []

    for portfolio in portfolio_builder_service.list_portfolios(db, user.id):
        portfolio_assets = portfolio_builder_service.get_portfolio_assets(db, portfolio.id)
        if not portfolio_assets:
            continue

        price_series_by_ticker = {}
        weights = {}
        asset_returns: list[tuple[str, float]] = []
        for pa, asset in portfolio_assets:
            price_rows = price_service.get_price_history(db, asset.id)
            if not price_rows:
                continue
            series = analysis_service.prices_to_series(price_rows)
            price_series_by_ticker[asset.ticker] = series
            weights[asset.ticker] = pa.weight
            asset_return = _period_return_percent(series.tolist(), days)
            if asset_return is not None:
                asset_returns.append((asset.ticker, asset_return))

        if len(price_series_by_ticker) != len(portfolio_assets) or not asset_returns:
            continue

        portfolio_index = analysis_service.portfolio_value_series(price_series_by_ticker, weights)
        period_return = _period_return_percent(portfolio_index.tolist(), days)
        if period_return is None:
            continue

        best_ticker, best_return = max(asset_returns, key=lambda x: x[1])
        worst_ticker, worst_return = min(asset_returns, key=lambda x: x[1])
        rows.append(
            {
                "name": portfolio.name,
                "period_return_percent": period_return,
                "best_ticker": best_ticker,
                "best_return_percent": best_return,
                "worst_ticker": worst_ticker,
                "worst_return_percent": worst_return,
            }
        )

    return rows if rows else None
