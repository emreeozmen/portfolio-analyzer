import secrets

from sqlalchemy.orm import Session

from models import Asset, Holding, HoldingSale, Portfolio, PortfolioAsset
from services import analysis_service, audit_service, market_data_provider, price_service

WEIGHT_SUM_TOLERANCE = 0.5  # percentage points


def validate_portfolio_input(db: Session, name: str, assets_input: list[tuple[str, float]]) -> list[Asset]:
    if not name or not name.strip():
        raise ValueError("Portföy adı boş olamaz")
    if not assets_input:
        raise ValueError("En az bir varlık seçilmelidir")

    tickers = [ticker.upper() for ticker, _ in assets_input]
    if len(set(tickers)) != len(tickers):
        raise ValueError("Aynı varlık birden fazla kez eklenemez")

    resolved_assets = []
    for ticker, weight in assets_input:
        if weight is None or weight <= 0:
            raise ValueError(f"{ticker} için geçersiz ağırlık: ağırlık pozitif bir sayı olmalıdır")
        asset = db.query(Asset).filter(Asset.ticker == ticker.upper()).first()
        if asset is None:
            raise ValueError(f"Geçersiz varlık: {ticker}")
        resolved_assets.append(asset)

    total_weight = sum(weight for _, weight in assets_input)
    if abs(total_weight - 100.0) > WEIGHT_SUM_TOLERANCE:
        raise ValueError(f"Ağırlıkların toplamı %100 olmalıdır (şu an %{total_weight:.2f})")

    return resolved_assets


def create_portfolio(
    db: Session,
    user_id: int,
    name: str,
    assets_input: list[tuple[str, float]],
    benchmark_symbol: str | None = None,
    benchmark_label: str | None = None,
) -> Portfolio:
    resolved_assets = validate_portfolio_input(db, name, assets_input)

    portfolio = Portfolio(
        user_id=user_id, name=name.strip(), benchmark_symbol=benchmark_symbol, benchmark_label=benchmark_label
    )
    db.add(portfolio)
    db.commit()
    db.refresh(portfolio)

    for asset, (_, weight) in zip(resolved_assets, assets_input):
        db.add(PortfolioAsset(portfolio_id=portfolio.id, asset_id=asset.id, weight=weight / 100))
    db.commit()
    audit_service.log_action(db, user_id, "portfolio.create", portfolio.name)
    return portfolio


def update_portfolio(
    db: Session,
    portfolio: Portfolio,
    name: str,
    assets_input: list[tuple[str, float]],
    benchmark_symbol: str | None = None,
    benchmark_label: str | None = None,
) -> Portfolio:
    resolved_assets = validate_portfolio_input(db, name, assets_input)

    portfolio.name = name.strip()
    portfolio.benchmark_symbol = benchmark_symbol
    portfolio.benchmark_label = benchmark_label
    db.query(PortfolioAsset).filter(PortfolioAsset.portfolio_id == portfolio.id).delete()
    for asset, (_, weight) in zip(resolved_assets, assets_input):
        db.add(PortfolioAsset(portfolio_id=portfolio.id, asset_id=asset.id, weight=weight / 100))
    db.commit()
    db.refresh(portfolio)
    audit_service.log_action(db, portfolio.user_id, "portfolio.update", portfolio.name)
    return portfolio


def delete_portfolio(db: Session, user_id: int, portfolio_id: int) -> bool:
    portfolio = get_portfolio(db, user_id, portfolio_id)
    if portfolio is None:
        return False
    portfolio_name = portfolio.name
    db.query(PortfolioAsset).filter(PortfolioAsset.portfolio_id == portfolio.id).delete()
    # Holdings/sales grouped under this portfolio aren't deleted — they just stop
    # being grouped under any portfolio (portfolio_id is nullable exactly for this).
    # Also required since holdings.portfolio_id now carries a real FK constraint
    # (see migrations/versions/9ef7c625bc0c_*) — deleting the portfolio without this
    # would fail the DELETE outright instead of silently orphaning the reference.
    db.query(Holding).filter(Holding.portfolio_id == portfolio.id).update({"portfolio_id": None})
    db.query(HoldingSale).filter(HoldingSale.portfolio_id == portfolio.id).update({"portfolio_id": None})
    db.delete(portfolio)
    db.commit()
    audit_service.log_action(db, user_id, "portfolio.delete", portfolio_name)
    return True


def generate_share_link(db: Session, user_id: int, portfolio_id: int) -> str | None:
    """Generates (or regenerates, invalidating any previous link) a random, unguessable
    token that makes GET /public/portfolios/{token}/analysis serve this portfolio's
    analysis with no authentication required. Returns None if the portfolio isn't
    owned by user_id (same 404-not-403 pattern as everything else in this module)."""
    portfolio = get_portfolio(db, user_id, portfolio_id)
    if portfolio is None:
        return None
    portfolio.share_token = secrets.token_urlsafe(32)
    db.commit()
    audit_service.log_action(db, user_id, "portfolio.share_enable", portfolio.name)
    return portfolio.share_token


def revoke_share_link(db: Session, user_id: int, portfolio_id: int) -> bool:
    portfolio = get_portfolio(db, user_id, portfolio_id)
    if portfolio is None:
        return False
    portfolio.share_token = None
    db.commit()
    audit_service.log_action(db, user_id, "portfolio.share_disable", portfolio.name)
    return True


def get_portfolio_by_share_token(db: Session, token: str) -> Portfolio | None:
    return db.query(Portfolio).filter(Portfolio.share_token == token).first()


def list_portfolios(db: Session, user_id: int) -> list[Portfolio]:
    return db.query(Portfolio).filter(Portfolio.user_id == user_id).all()


def get_portfolio(db: Session, user_id: int, portfolio_id: int) -> Portfolio | None:
    return db.query(Portfolio).filter(Portfolio.id == portfolio_id, Portfolio.user_id == user_id).first()


def get_portfolio_assets(db: Session, portfolio_id: int) -> list[tuple[PortfolioAsset, Asset]]:
    return (
        db.query(PortfolioAsset, Asset)
        .join(Asset, Asset.id == PortfolioAsset.asset_id)
        .filter(PortfolioAsset.portfolio_id == portfolio_id)
        .all()
    )


def compute_portfolio_analysis_payload(db: Session, portfolio: Portfolio) -> dict:
    """Builds the full /portfolios/{id}/analysis response body — shared by the owner
    route (routers/portfolios.py) and the public, unauthenticated route
    (routers/public.py) so a shared portfolio's public view is byte-for-byte the same
    computation the owner sees, not a second parallel implementation. Raises
    ValueError for business-rule failures (no assets, no price data) — callers
    translate that to an HTTP 400.
    """
    portfolio_assets = get_portfolio_assets(db, portfolio.id)
    if not portfolio_assets:
        raise ValueError("Portföyde varlık bulunamadı")

    price_series_by_ticker = {}
    weights = {}
    risk_free_rate = 0.0
    sector_items: list[tuple[str | None, float]] = []
    currency_items: list[tuple[str | None, float]] = []
    for pa, asset in portfolio_assets:
        price_rows = price_service.get_price_history(db, asset.id)
        if not price_rows:
            raise ValueError(f"{asset.ticker} için fiyat verisi bulunamadı")
        price_series_by_ticker[asset.ticker] = analysis_service.prices_to_series(price_rows)
        weights[asset.ticker] = pa.weight
        risk_free_rate += pa.weight * analysis_service.risk_free_rate_for(asset.currency)
        sector_items.append((asset.sector, pa.weight))
        currency_items.append((asset.currency, pa.weight))

    analysis = analysis_service.portfolio_analysis(price_series_by_ticker, weights, risk_free_rate=risk_free_rate)
    correlation = analysis_service.correlation_matrix(price_series_by_ticker)
    sector_allocation = analysis_service.group_weights_by_attribute(sector_items)
    currency_allocation = analysis_service.group_weights_by_attribute(currency_items)

    benchmark_symbol = portfolio.benchmark_symbol or market_data_provider.BIST100_SYMBOL
    benchmark_label = portfolio.benchmark_label or "BIST 100"
    benchmark: list[dict] = []
    try:
        reference_dates = [p["date"] for p in analysis["portfolio_index"]]
        bars = market_data_provider.fetch_ohlcv_cached(benchmark_symbol)
        benchmark_prices = {bar.date.isoformat(): bar.close for bar in bars}
        benchmark = analysis_service.benchmark_index_series(benchmark_prices, reference_dates)
    except Exception:
        benchmark = []  # benchmark is best-effort; portfolio analysis must still succeed without it

    return {
        "portfolio_id": portfolio.id,
        "name": portfolio.name,
        "weights": [{"ticker": t, "weight": w} for t, w in weights.items()],
        "correlation": correlation,
        "benchmark_label": benchmark_label,
        "benchmark": benchmark,
        "sector_allocation": sector_allocation,
        "currency_allocation": currency_allocation,
        **analysis,
    }
