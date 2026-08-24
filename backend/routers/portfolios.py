from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from database import get_db
from i18n import get_lang, localize
from models import Portfolio, User
from routers.auth import get_current_user
from services import analysis_service, portfolio_builder_service, price_service

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


def _load_portfolio_series(db: Session, portfolio: Portfolio) -> tuple[dict, dict, float]:
    """Shared by /optimize, /montecarlo, /goal, and /backtest: loads each constituent's
    price history as a pandas Series, its current target weight, and the portfolio's
    weight-blended risk-free rate (see analysis_service.risk_free_rate_for). Raises
    HTTPException(400) for a constituent with no price data, same as each endpoint did
    inline before this was factored out.
    """
    portfolio_assets = portfolio_builder_service.get_portfolio_assets(db, portfolio.id)
    price_series_by_ticker: dict = {}
    weights: dict = {}
    risk_free_rate = 0.0
    for pa, asset in portfolio_assets:
        price_rows = price_service.get_price_history(db, asset.id)
        if not price_rows:
            raise HTTPException(status_code=400, detail=f"{asset.ticker} için fiyat verisi bulunamadı")
        price_series_by_ticker[asset.ticker] = analysis_service.prices_to_series(price_rows)
        weights[asset.ticker] = pa.weight
        risk_free_rate += pa.weight * analysis_service.risk_free_rate_for(asset.currency)
    return price_series_by_ticker, weights, risk_free_rate


class PortfolioAssetInput(BaseModel):
    ticker: str
    weight: float


class PortfolioCreate(BaseModel):
    name: str
    assets: list[PortfolioAssetInput]
    benchmark_symbol: str | None = None
    benchmark_label: str | None = None


class PortfolioResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class PortfolioDetailResponse(BaseModel):
    id: int
    name: str
    assets: list[PortfolioAssetInput]
    benchmark_symbol: str | None = None
    benchmark_label: str | None = None
    share_token: str | None = None


class ShareLinkResponse(BaseModel):
    share_token: str


@router.get("", response_model=list[PortfolioResponse])
def get_portfolios(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return portfolio_builder_service.list_portfolios(db, current_user.id)


@router.post("", response_model=PortfolioResponse)
def create_portfolio(
    payload: PortfolioCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    try:
        return portfolio_builder_service.create_portfolio(
            db,
            user_id=current_user.id,
            name=payload.name,
            assets_input=[(a.ticker, a.weight) for a in payload.assets],
            benchmark_symbol=payload.benchmark_symbol,
            benchmark_label=payload.benchmark_label,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc


@router.get("/{portfolio_id}", response_model=PortfolioDetailResponse)
def get_portfolio_detail(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    portfolio = portfolio_builder_service.get_portfolio(db, current_user.id, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    portfolio_assets = portfolio_builder_service.get_portfolio_assets(db, portfolio.id)
    return PortfolioDetailResponse(
        id=portfolio.id,
        name=portfolio.name,
        assets=[PortfolioAssetInput(ticker=asset.ticker, weight=pa.weight * 100) for pa, asset in portfolio_assets],
        benchmark_symbol=portfolio.benchmark_symbol,
        benchmark_label=portfolio.benchmark_label,
        share_token=portfolio.share_token,
    )


@router.put("/{portfolio_id}", response_model=PortfolioResponse)
def update_portfolio(
    portfolio_id: int,
    payload: PortfolioCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    portfolio = portfolio_builder_service.get_portfolio(db, current_user.id, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    try:
        return portfolio_builder_service.update_portfolio(
            db,
            portfolio,
            name=payload.name,
            assets_input=[(a.ticker, a.weight) for a in payload.assets],
            benchmark_symbol=payload.benchmark_symbol,
            benchmark_label=payload.benchmark_label,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = portfolio_builder_service.delete_portfolio(db, current_user.id, portfolio_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Portfolio not found")


@router.post("/{portfolio_id}/share", response_model=ShareLinkResponse)
def create_share_link(
    portfolio_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    token = portfolio_builder_service.generate_share_link(db, current_user.id, portfolio_id)
    if token is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return ShareLinkResponse(share_token=token)


@router.delete("/{portfolio_id}/share", status_code=status.HTTP_204_NO_CONTENT)
def delete_share_link(
    portfolio_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    revoked = portfolio_builder_service.revoke_share_link(db, current_user.id, portfolio_id)
    if not revoked:
        raise HTTPException(status_code=404, detail="Portfolio not found")


@router.get("/{portfolio_id}/analysis")
def get_portfolio_analysis(
    portfolio_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    portfolio = portfolio_builder_service.get_portfolio(db, current_user.id, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    try:
        return portfolio_builder_service.compute_portfolio_analysis_payload(db, portfolio)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc


@router.get("/{portfolio_id}/optimize")
def optimize_portfolio_endpoint(
    portfolio_id: int,
    objective: str = "max_sharpe",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if objective not in ("max_sharpe", "min_variance", "risk_parity"):
        raise HTTPException(status_code=400, detail=localize("Geçersiz optimizasyon hedefi", lang))

    portfolio = portfolio_builder_service.get_portfolio(db, current_user.id, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    portfolio_assets = portfolio_builder_service.get_portfolio_assets(db, portfolio.id)
    if len(portfolio_assets) < 2:
        raise HTTPException(status_code=400, detail=localize("Optimizasyon için en az iki varlık gerekir", lang))

    price_series_by_ticker, current_weights, risk_free_rate = _load_portfolio_series(db, portfolio)

    suggested_weights = analysis_service.optimize_weights(
        price_series_by_ticker, risk_free_rate=risk_free_rate, objective=objective
    )
    suggested_summary = analysis_service.portfolio_analysis(
        price_series_by_ticker, suggested_weights, risk_free_rate=risk_free_rate
    )["summary"]
    current_summary = analysis_service.portfolio_analysis(
        price_series_by_ticker, current_weights, risk_free_rate=risk_free_rate
    )["summary"]

    return {
        "objective": objective,
        "current_weights": [{"ticker": t, "weight": w} for t, w in current_weights.items()],
        "suggested_weights": [{"ticker": t, "weight": w} for t, w in suggested_weights.items()],
        "current_summary": current_summary,
        "suggested_summary": suggested_summary,
        "frontier": analysis_service.compute_efficient_frontier(price_series_by_ticker),
        "current_point": analysis_service.expected_return_and_volatility(price_series_by_ticker, current_weights),
        "suggested_point": analysis_service.expected_return_and_volatility(price_series_by_ticker, suggested_weights),
    }


@router.get("/{portfolio_id}/montecarlo")
def get_portfolio_montecarlo(
    portfolio_id: int,
    horizon_days: int = 252,
    confidence: float = 0.95,
    simulations: int = 2000,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if horizon_days < 1 or horizon_days > 2520:
        raise HTTPException(status_code=400, detail=localize("Geçersiz ufuk (gün)", lang))
    if confidence <= 0 or confidence >= 1:
        raise HTTPException(status_code=400, detail=localize("Geçersiz güven düzeyi", lang))
    if simulations < 100 or simulations > 20000:
        raise HTTPException(status_code=400, detail=localize("Geçersiz simülasyon sayısı", lang))

    portfolio = portfolio_builder_service.get_portfolio(db, current_user.id, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    price_series_by_ticker, weights, _ = _load_portfolio_series(db, portfolio)
    result = analysis_service.monte_carlo_analysis(
        price_series_by_ticker, weights, horizon_days, confidence_level=confidence, n_simulations=simulations
    )
    if result is None:
        raise HTTPException(status_code=400, detail=localize("Simülasyon için yeterli veri yok", lang))
    return result


@router.get("/{portfolio_id}/goal")
def get_portfolio_goal(
    portfolio_id: int,
    initial: float = 0.0,
    monthly: float = 0.0,
    target: float = 100.0,
    horizon_months: int = 120,
    simulations: int = 2000,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if target <= 0 or initial < 0 or monthly < 0:
        raise HTTPException(status_code=400, detail=localize("Geçersiz tutar", lang))
    if horizon_months < 1 or horizon_months > 600:
        raise HTTPException(status_code=400, detail=localize("Geçersiz ufuk (ay)", lang))

    portfolio = portfolio_builder_service.get_portfolio(db, current_user.id, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    price_series_by_ticker, weights, _ = _load_portfolio_series(db, portfolio)
    result = analysis_service.goal_planning_analysis(
        price_series_by_ticker,
        weights,
        initial_value=initial,
        monthly_contribution=monthly,
        target_value=target,
        horizon_months=horizon_months,
        n_simulations=simulations,
    )
    if result is None:
        raise HTTPException(status_code=400, detail=localize("Simülasyon için yeterli veri yok", lang))
    return result


@router.get("/{portfolio_id}/backtest")
def get_portfolio_backtest(
    portfolio_id: int,
    window_days: int = 63,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if window_days < 1:
        raise HTTPException(status_code=400, detail=localize("Geçersiz pencere (gün)", lang))

    portfolio = portfolio_builder_service.get_portfolio(db, current_user.id, portfolio_id)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    price_series_by_ticker, weights, _ = _load_portfolio_series(db, portfolio)
    result = analysis_service.backtest_analysis(price_series_by_ticker, weights, window_days)
    if result is None:
        raise HTTPException(
            status_code=400, detail=localize("Bu pencere için yeterli geçmiş veri yok", lang)
        )
    return result
