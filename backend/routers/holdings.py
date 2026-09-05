from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from database import get_db
from i18n import get_lang, localize
from models import User
from routers.auth import get_current_user
from services import portfolio_builder_service, portfolio_service

router = APIRouter(prefix="/holdings", tags=["holdings"])


def _verify_portfolio_ownership(db: Session, user_id: int, portfolio_id: int | None) -> None:
    """A holding's portfolio_id was previously accepted as-is with no ownership check
    — harmless in practice (every holdings query already filters by user_id first, so
    another user's portfolio_id could never actually surface someone else's data), but
    still let a holding end up silently linked to a portfolio_id its owner has no way
    to see or manage. Raises 404 (matches the plain, un-localized "Portfolio not found"
    routers/portfolios.py already uses for a portfolio_id that isn't yours or doesn't
    exist) rather than silently accepting it.
    """
    if portfolio_id is None:
        return
    if portfolio_builder_service.get_portfolio(db, user_id, portfolio_id) is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")


def _validate_holding_numbers(quantity: float, price: float) -> None:
    """A zero/negative quantity or negative price has no real-world meaning for a
    position and would otherwise silently corrupt cost-basis/valuation math downstream
    — enforced here rather than as a Field() constraint on HoldingCreate so it applies
    only to new input, not to HoldingResponse's reuse of the same fields when
    serializing an already-stored row back out.
    """
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Miktar sıfırdan büyük olmalıdır")
    if price < 0:
        raise HTTPException(status_code=400, detail="Fiyat negatif olamaz")


class HoldingCreate(BaseModel):
    ticker: str = Field(max_length=30)
    quantity: float
    purchase_price: float
    purchase_date: datetime
    portfolio_id: int | None = None


class HoldingResponse(HoldingCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int


class HoldingValuation(HoldingResponse):
    currency: str
    sector: str | None
    current_price: float | None
    cost_basis: float
    market_value: float | None
    unrealized_pl: float | None
    unrealized_pl_percent: float | None
    market_value_try: float | None
    cost_basis_try: float | None
    dividend_income: float | None
    dividend_yield_ttm: float | None
    dividend_income_try: float | None


class ValuationSummary(BaseModel):
    total_cost_basis: float
    total_market_value: float
    total_unrealized_pl: float
    total_unrealized_pl_percent: float
    currency: str | None
    mixed_currency: bool
    priced_count: int
    unpriced_count: int
    total_cost_basis_try: float
    total_market_value_try: float
    total_unrealized_pl_try: float
    total_unrealized_pl_percent_try: float
    fx_unavailable: bool
    total_dividend_income: float
    total_dividend_income_try: float


class SectorWeight(BaseModel):
    label: str
    weight: float


class ValuationResponse(BaseModel):
    holdings: list[HoldingValuation]
    summary: ValuationSummary
    sector_allocation: list[SectorWeight]


class DividendPayment(BaseModel):
    ticker: str
    pay_date: str
    amount_per_share: float
    quantity: float
    amount: float
    currency: str
    amount_try: float | None


class ValueHistoryPoint(BaseModel):
    date: str
    market_value: float
    cost_basis: float


class ValueHistoryResponse(BaseModel):
    points: list[ValueHistoryPoint]
    currency: str
    fx_unavailable: bool
    excluded_tickers: list[str]


class HoldingSaleCreate(BaseModel):
    ticker: str = Field(max_length=30)
    quantity: float
    sale_price: float
    sale_date: datetime
    portfolio_id: int | None = None


class HoldingSaleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    portfolio_id: int | None
    ticker: str
    quantity: float
    sale_price: float
    sale_date: datetime
    cost_basis: float
    realized_pl: float


class RealizedPLSummary(BaseModel):
    total_realized_pl: float
    total_proceeds: float
    total_cost_basis: float
    sale_count: int


class TickerRealizedPL(RealizedPLSummary):
    ticker: str


class YearlyRealizedPL(RealizedPLSummary):
    year: int
    tickers: list[TickerRealizedPL]


class HoldingImportRequest(BaseModel):
    # ~2MB is generous for a holdings CSV (thousands of rows) while still ruling out
    # an arbitrarily large body being parsed on every request.
    csv_text: str = Field(max_length=2_000_000)
    portfolio_id: int | None = None


class HoldingImportRowError(BaseModel):
    row: int
    message: str


class HoldingImportResponse(BaseModel):
    imported: int
    errors: list[HoldingImportRowError]


class HoldingImportPreviewRow(BaseModel):
    ticker: str
    quantity: float
    purchase_price: float
    purchase_date: datetime


class HoldingImportPreviewResponse(BaseModel):
    rows: list[HoldingImportPreviewRow]
    errors: list[HoldingImportRowError]


@router.get("", response_model=list[HoldingResponse])
def get_holdings(
    portfolio_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return portfolio_service.list_holdings(db, current_user.id, portfolio_id)


@router.get("/valuation", response_model=ValuationResponse)
def get_holdings_valuation(
    portfolio_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    holdings = portfolio_service.list_holdings(db, current_user.id, portfolio_id)
    valued = portfolio_service.value_holdings(db, holdings, current_user.base_currency)
    return ValuationResponse(
        holdings=valued,
        summary=portfolio_service.valuation_summary(valued),
        sector_allocation=portfolio_service.sector_allocation(valued),
    )


@router.get("/dividends", response_model=list[DividendPayment])
def get_dividend_history(
    portfolio_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return portfolio_service.dividend_history(db, current_user.id, portfolio_id, current_user.base_currency)


@router.get("/value-history", response_model=ValueHistoryResponse)
def get_holdings_value_history(
    portfolio_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return portfolio_service.holdings_value_history(db, current_user.id, portfolio_id, current_user.base_currency)


@router.post("", response_model=HoldingResponse)
def create_holding(
    payload: HoldingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _verify_portfolio_ownership(db, current_user.id, payload.portfolio_id)
    _validate_holding_numbers(payload.quantity, payload.purchase_price)
    return portfolio_service.add_holding(
        db,
        user_id=current_user.id,
        ticker=payload.ticker,
        quantity=payload.quantity,
        purchase_price=payload.purchase_price,
        purchase_date=payload.purchase_date,
        portfolio_id=payload.portfolio_id,
    )


@router.put("/{holding_id}", response_model=HoldingResponse)
def update_holding(
    holding_id: int,
    payload: HoldingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _verify_portfolio_ownership(db, current_user.id, payload.portfolio_id)
    _validate_holding_numbers(payload.quantity, payload.purchase_price)
    updated = portfolio_service.update_holding(
        db,
        user_id=current_user.id,
        holding_id=holding_id,
        ticker=payload.ticker,
        quantity=payload.quantity,
        purchase_price=payload.purchase_price,
        purchase_date=payload.purchase_date,
        portfolio_id=payload.portfolio_id,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Holding not found")
    return updated


@router.delete("/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holding(
    holding_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = portfolio_service.delete_holding(db, current_user.id, holding_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Holding not found")


@router.post("/sell", response_model=HoldingSaleResponse)
def sell_holding(
    payload: HoldingSaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    _verify_portfolio_ownership(db, current_user.id, payload.portfolio_id)
    _validate_holding_numbers(payload.quantity, payload.sale_price)
    try:
        return portfolio_service.sell_holding(
            db,
            user_id=current_user.id,
            ticker=payload.ticker,
            quantity=payload.quantity,
            sale_price=payload.sale_price,
            sale_date=payload.sale_date,
            portfolio_id=payload.portfolio_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc


@router.get("/sales", response_model=list[HoldingSaleResponse])
def get_sales(
    portfolio_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return portfolio_service.list_sales(db, current_user.id, portfolio_id)


@router.get("/sales/summary", response_model=RealizedPLSummary)
def get_sales_summary(
    portfolio_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sales = portfolio_service.list_sales(db, current_user.id, portfolio_id)
    return portfolio_service.realized_pl_summary(sales)


@router.get("/sales/tax-report", response_model=list[YearlyRealizedPL])
def get_tax_report(
    portfolio_id: int | None = None,
    year: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All years' realized gains/losses grouped by year and, within each year, by
    ticker — for a "what did I realize in tax year X" view. `year` optionally narrows
    the response to a single year (still returned as a one-element list, same shape,
    so the frontend doesn't need two different response handlers)."""
    sales = portfolio_service.list_sales(db, current_user.id, portfolio_id)
    years = portfolio_service.realized_pl_by_year(sales)
    if year is not None:
        years = [y for y in years if y["year"] == year]
    return years


@router.delete("/sales/{sale_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if not portfolio_service.delete_sale(db, current_user.id, sale_id):
        raise HTTPException(status_code=404, detail=localize("Satış kaydı bulunamadı", lang))


@router.post("/import", response_model=HoldingImportResponse)
def import_holdings(
    payload: HoldingImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    _verify_portfolio_ownership(db, current_user.id, payload.portfolio_id)
    try:
        return portfolio_service.import_holdings_csv(
            db, user_id=current_user.id, csv_text=payload.csv_text, portfolio_id=payload.portfolio_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc


@router.post("/import/preview", response_model=HoldingImportPreviewResponse)
def preview_import_holdings(
    payload: HoldingImportRequest,
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    """Parses and validates the CSV without writing anything, so the frontend can show
    the user what will be imported before they confirm (current_user is required only
    to gate this behind auth, same as the commit endpoint)."""
    try:
        return portfolio_service.parse_holdings_csv(payload.csv_text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc
