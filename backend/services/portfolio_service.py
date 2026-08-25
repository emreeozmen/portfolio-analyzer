import csv
import io
from datetime import date, datetime, timedelta

import pandas as pd
from sqlalchemy.orm import Session

from models import Holding, HoldingSale
from services import analysis_service, asset_service, audit_service, market_data_provider, price_service

# TRY is the platform's home currency (BIST-first) — used only to give a single combined
# total across a mixed-currency portfolio (e.g. BIST + US stocks); every holding still
# shows its own native-currency figures too, this is purely an additional roll-up.
AGGREGATE_CURRENCY = "TRY"


def list_holdings(db: Session, user_id: int, portfolio_id: int | None = None) -> list[Holding]:
    query = db.query(Holding).filter(Holding.user_id == user_id)
    if portfolio_id is not None:
        query = query.filter(Holding.portfolio_id == portfolio_id)
    return query.order_by(Holding.purchase_date.desc()).all()


def add_holding(
    db: Session,
    user_id: int,
    ticker: str,
    quantity: float,
    purchase_price: float,
    purchase_date,
    portfolio_id: int | None = None,
) -> Holding:
    holding = Holding(
        user_id=user_id,
        portfolio_id=portfolio_id,
        ticker=ticker.upper(),
        quantity=quantity,
        purchase_price=purchase_price,
        purchase_date=purchase_date,
    )
    db.add(holding)
    db.commit()
    db.refresh(holding)
    audit_service.log_action(db, user_id, "holding.create", holding.ticker)
    return holding


def get_holding(db: Session, user_id: int, holding_id: int) -> Holding | None:
    return db.query(Holding).filter(Holding.id == holding_id, Holding.user_id == user_id).first()


def update_holding(
    db: Session,
    user_id: int,
    holding_id: int,
    ticker: str,
    quantity: float,
    purchase_price: float,
    purchase_date,
    portfolio_id: int | None = None,
) -> Holding | None:
    holding = get_holding(db, user_id, holding_id)
    if holding is None:
        return None
    holding.ticker = ticker.upper()
    holding.quantity = quantity
    holding.purchase_price = purchase_price
    holding.purchase_date = purchase_date
    holding.portfolio_id = portfolio_id
    db.commit()
    db.refresh(holding)
    audit_service.log_action(db, user_id, "holding.update", holding.ticker)
    return holding


def delete_holding(db: Session, user_id: int, holding_id: int) -> bool:
    holding = get_holding(db, user_id, holding_id)
    if holding is None:
        return False
    ticker = holding.ticker
    db.delete(holding)
    db.commit()
    audit_service.log_action(db, user_id, "holding.delete", ticker)
    return True


def _dividend_income_since(dividends: list[tuple[date, float]], since: date, quantity: float) -> float:
    return sum(amount for pay_date, amount in dividends if pay_date >= since) * quantity


def _dividend_yield_ttm(dividends: list[tuple[date, float]], current_price: float | None) -> float | None:
    if not current_price:
        return None
    cutoff = date.today() - timedelta(days=365)
    per_share = sum(amount for pay_date, amount in dividends if pay_date >= cutoff)
    return per_share / current_price * 100


def value_holding(db: Session, holding: Holding, aggregate_currency: str = AGGREGATE_CURRENCY) -> dict:
    """Attaches a live valuation to a single holding — see value_holdings() for the
    batched version used when valuing many holdings at once (e.g. the "Pozisyonlar"
    panel), which this now delegates to so both paths share one implementation.
    """
    return value_holdings(db, [holding], aggregate_currency)[0]


def value_holdings(
    db: Session, holdings: list[Holding], aggregate_currency: str = AGGREGATE_CURRENCY
) -> list[dict]:
    """Attaches a live valuation (current price, market value, unrealized P&L, dividend
    income) to each holding by looking up its ticker's latest close price and real
    dividend history. Falls back to null valuation fields if the ticker isn't tracked or
    has no price history yet, rather than failing the whole request. `aggregate_currency`
    defaults to the platform-wide TRY assumption but is normally the caller's own
    User.base_currency (see routers/holdings.py) — the `_try`-suffixed field names
    below are kept as-is (not renamed) to avoid an unrelated churn migration; they now
    mean "in aggregate_currency", which just happens to still be TRY by default.

    Batches the Asset and latest-price lookups into one query each across every
    distinct ticker, instead of one query per holding — this backs GET
    /holdings/valuation, which is re-fetched on every "prices-updated" WebSocket
    signal, so an N+1 here scales directly with how many positions a user has open.
    """
    if not holdings:
        return []

    tickers = {h.ticker for h in holdings}
    assets_by_ticker = asset_service.get_assets_by_tickers(db, tickers)
    latest_prices = price_service.get_latest_prices(db, [a.id for a in assets_by_ticker.values()])

    return [
        _value_holding_with(holding, assets_by_ticker.get(holding.ticker), latest_prices, aggregate_currency)
        for holding in holdings
    ]


def _value_holding_with(
    holding: Holding,
    asset,
    latest_prices: dict[int, "price_service.PriceHistory"],
    aggregate_currency: str,
) -> dict:
    current_price = None
    currency = "TRY"
    sector = None
    dividend_income = None
    dividend_yield_ttm = None
    if asset is not None:
        currency = asset.currency
        sector = asset.sector
        price_row = latest_prices.get(asset.id)
        if price_row is not None:
            current_price = price_row.close_price

        dividends = market_data_provider.get_dividends(asset.yahoo_symbol)
        purchase_date = holding.purchase_date.date()
        dividend_income = _dividend_income_since(dividends, purchase_date, holding.quantity)
        dividend_yield_ttm = _dividend_yield_ttm(dividends, current_price)

    cost_basis = holding.quantity * holding.purchase_price
    market_value = holding.quantity * current_price if current_price is not None else None
    unrealized_pl = market_value - cost_basis if market_value is not None else None
    unrealized_pl_percent = (unrealized_pl / cost_basis * 100) if unrealized_pl is not None and cost_basis else None

    fx_rate = market_data_provider.get_fx_rate(currency, aggregate_currency)
    cost_basis_try = cost_basis * fx_rate if fx_rate is not None else None
    market_value_try = market_value * fx_rate if market_value is not None and fx_rate is not None else None
    dividend_income_try = dividend_income * fx_rate if dividend_income is not None and fx_rate is not None else None

    return {
        "id": holding.id,
        "portfolio_id": holding.portfolio_id,
        "ticker": holding.ticker,
        "quantity": holding.quantity,
        "purchase_price": holding.purchase_price,
        "purchase_date": holding.purchase_date,
        "currency": currency,
        "sector": sector,
        "current_price": current_price,
        "cost_basis": cost_basis,
        "market_value": market_value,
        "unrealized_pl": unrealized_pl,
        "unrealized_pl_percent": unrealized_pl_percent,
        "market_value_try": market_value_try,
        "cost_basis_try": cost_basis_try,
        "dividend_income": dividend_income,
        "dividend_yield_ttm": dividend_yield_ttm,
        "dividend_income_try": dividend_income_try,
    }


def dividend_history(
    db: Session, user_id: int, portfolio_id: int | None = None, aggregate_currency: str = AGGREGATE_CURRENCY
) -> list[dict]:
    """Every real dividend payment the user's currently-open holdings actually
    received, one row per (ticker, ex-dividend date) — lots of the same ticker bought
    at different times are combined into a single row per payment date rather than
    duplicated, only counting the quantity that was already held by that date.
    Sourced from market_data_provider.get_dividends() (yfinance's own per-share
    dividend history), which only has *past* payments — there is no real "upcoming
    dividend" data source available here, so this is a payment history, not a
    forward-looking calendar. Never fabricates a projected future payment.
    """
    holdings = list_holdings(db, user_id, portfolio_id)
    if not holdings:
        return []

    by_ticker: dict[str, list[Holding]] = {}
    for h in holdings:
        by_ticker.setdefault(h.ticker, []).append(h)

    assets_by_ticker = asset_service.get_assets_by_tickers(db, by_ticker.keys())

    rows: list[dict] = []
    for ticker, lots in by_ticker.items():
        asset = assets_by_ticker.get(ticker)
        if asset is None:
            continue
        dividends = market_data_provider.get_dividends(asset.yahoo_symbol)
        if not dividends:
            continue

        fx_rate = market_data_provider.get_fx_rate(asset.currency, aggregate_currency)

        for pay_date, per_share in dividends:
            held_quantity = sum(lot.quantity for lot in lots if lot.purchase_date.date() <= pay_date)
            if held_quantity <= 0:
                continue
            amount = held_quantity * per_share
            rows.append(
                {
                    "ticker": ticker,
                    "pay_date": pay_date.isoformat(),
                    "amount_per_share": per_share,
                    "quantity": held_quantity,
                    "amount": amount,
                    "currency": asset.currency,
                    "amount_try": amount * fx_rate if fx_rate is not None else None,
                }
            )

    rows.sort(key=lambda r: r["pay_date"], reverse=True)
    return rows


def valuation_summary(valued_holdings: list[dict]) -> dict:
    priced = [h for h in valued_holdings if h["market_value"] is not None]
    currencies = {h["currency"] for h in priced}
    mixed_currency = len(currencies) > 1

    # Same-currency totals — the clean, no-conversion path, shown as the primary total
    # when every priced holding already shares one currency.
    total_cost = 0.0 if mixed_currency else sum(h["cost_basis"] for h in priced)
    total_value = 0.0 if mixed_currency else sum(h["market_value"] for h in priced)
    total_pl = total_value - total_cost
    total_pl_percent = (total_pl / total_cost * 100) if total_cost else 0.0

    # TRY-normalized totals — always computed (not just when mixed) so a mixed-currency
    # portfolio still gets one combined figure, converted via a real spot FX rate rather
    # than skipped. A holding whose FX rate couldn't be resolved is left out and flagged
    # via fx_unavailable, rather than silently under-counted.
    convertible = [h for h in priced if h["market_value_try"] is not None]
    fx_unavailable = len(convertible) < len(priced)
    total_cost_try = sum(h["cost_basis_try"] for h in convertible)
    total_value_try = sum(h["market_value_try"] for h in convertible)
    total_pl_try = total_value_try - total_cost_try
    total_pl_try_percent = (total_pl_try / total_cost_try * 100) if total_cost_try else 0.0

    total_dividend_income = 0.0 if mixed_currency else sum(h["dividend_income"] or 0.0 for h in priced)
    dividend_convertible = [h for h in valued_holdings if h.get("dividend_income_try") is not None]
    total_dividend_income_try = sum(h["dividend_income_try"] for h in dividend_convertible)

    return {
        "total_cost_basis": total_cost,
        "total_market_value": total_value,
        "total_unrealized_pl": total_pl,
        "total_unrealized_pl_percent": total_pl_percent,
        "currency": next(iter(currencies)) if len(currencies) == 1 else None,
        "mixed_currency": mixed_currency,
        "priced_count": len(priced),
        "unpriced_count": len(valued_holdings) - len(priced),
        "total_cost_basis_try": total_cost_try,
        "total_market_value_try": total_value_try,
        "total_unrealized_pl_try": total_pl_try,
        "total_unrealized_pl_percent_try": total_pl_try_percent,
        "fx_unavailable": fx_unavailable,
        "total_dividend_income": total_dividend_income,
        "total_dividend_income_try": total_dividend_income_try,
    }


def sector_allocation(valued_holdings: list[dict]) -> list[dict]:
    """Real-money sector exposure across every open holding — unlike the per-portfolio
    sector donut in routers/portfolios.py (which is weighted by a portfolio's target
    weights), this is weighted by each holding's actual current TRY-normalized market
    value, so it reflects what you're really holding right now across every portfolio
    combined. Reuses analysis_service.group_weights_by_attribute() (unmapped sectors
    grouped under "Bilinmiyor") by pre-dividing each holding's value by the priced
    total, so the summed-per-sector output is already fractions, the same shape the
    frontend's existing sector DonutChart/ExposureBreakdown rendering expects.
    """
    priced = [h for h in valued_holdings if h.get("market_value_try") is not None]
    total = sum(h["market_value_try"] for h in priced)
    if total <= 0:
        return []
    items = [(h.get("sector"), h["market_value_try"] / total) for h in priced]
    return analysis_service.group_weights_by_attribute(items)


def holdings_value_history(
    db: Session, user_id: int, portfolio_id: int | None = None, aggregate_currency: str = AGGREGATE_CURRENCY
) -> dict:
    """Reconstructs total market value and cost basis over time from the user's
    currently-open Holding lots and each asset's real daily close-price history — no
    snapshot table or background job is needed, since the price history already lets
    us compute what today's positions were worth on any past trading day they'd already
    been bought by. Mixed-currency holdings are converted to TRY using the real
    historical daily FX rate for each date (not today's spot rate applied
    retroactively), the same yfinance "{FROM}TRY=X" pairs used elsewhere in this app.

    Caveat, surfaced via `excluded_tickers`/`fx_unavailable` rather than silently
    dropped: this traces only currently-open lots back to their purchase date, so a
    since-fully-sold position contributes nothing and a partially-sold lot is shown at
    today's (reduced) quantity for its whole holding period — this is "value of what
    you hold today, since you bought it", not a full historical audit trail through
    every past buy/sell.
    """
    holdings = list_holdings(db, user_id, portfolio_id)
    if not holdings:
        return {"points": [], "currency": aggregate_currency, "fx_unavailable": False, "excluded_tickers": []}

    price_series_by_ticker: dict[str, pd.Series] = {}
    currency_by_ticker: dict[str, str] = {}
    excluded_tickers: set[str] = set()

    assets_by_ticker = asset_service.get_assets_by_tickers(db, {h.ticker for h in holdings})

    for h in holdings:
        if h.ticker in price_series_by_ticker or h.ticker in excluded_tickers:
            continue
        asset = assets_by_ticker.get(h.ticker)
        if asset is None:
            excluded_tickers.add(h.ticker)
            continue
        rows = price_service.get_price_history(db, asset.id)
        if not rows:
            excluded_tickers.add(h.ticker)
            continue
        price_series_by_ticker[h.ticker] = pd.Series(
            data=[r.close_price for r in rows],
            index=pd.DatetimeIndex([r.date for r in rows]),
        )
        currency_by_ticker[h.ticker] = asset.currency.upper()

    usable_holdings = [h for h in holdings if h.ticker in price_series_by_ticker]
    if not usable_holdings:
        return {
            "points": [],
            "currency": aggregate_currency,
            "fx_unavailable": False,
            "excluded_tickers": sorted(excluded_tickers),
        }

    all_dates = sorted(set().union(*(set(s.index) for s in price_series_by_ticker.values())))
    date_index = pd.DatetimeIndex(all_dates)

    fx_unavailable = False
    fx_series_by_currency: dict[str, pd.Series] = {}
    for currency in set(currency_by_ticker.values()):
        if currency == aggregate_currency:
            continue
        try:
            bars = market_data_provider.fetch_ohlcv_cached(f"{currency}{aggregate_currency}=X")
            series = pd.Series({pd.Timestamp(b.date): b.close for b in bars})
            fx_series_by_currency[currency] = series.reindex(date_index).ffill().bfill()
        except ValueError:
            fx_unavailable = True

    total_value = pd.Series(0.0, index=date_index)
    total_cost = pd.Series(0.0, index=date_index)

    for h in usable_holdings:
        currency = currency_by_ticker[h.ticker]
        prices = price_series_by_ticker[h.ticker].reindex(date_index).ffill()

        fx = None
        if currency != aggregate_currency:
            fx = fx_series_by_currency.get(currency)
            if fx is None:
                excluded_tickers.add(h.ticker)
                continue  # already flagged via fx_unavailable
            prices = prices * fx

        held_mask = (date_index >= pd.Timestamp(h.purchase_date.date())) & prices.notna()
        total_value = total_value.add(prices.where(held_mask, 0.0) * h.quantity, fill_value=0.0)

        cost_value = h.quantity * h.purchase_price
        cost_series = pd.Series(cost_value, index=date_index) * (fx if fx is not None else 1.0)
        total_cost = total_cost.add(cost_series.where(held_mask, 0.0), fill_value=0.0)

    points = [
        {"date": d.date().isoformat(), "market_value": float(v), "cost_basis": float(c)}
        for d, v, c in zip(date_index, total_value, total_cost)
        if v > 1e-9 or c > 1e-9
    ]

    return {
        "points": points,
        "currency": aggregate_currency,
        "fx_unavailable": fx_unavailable,
        "excluded_tickers": sorted(excluded_tickers),
    }


def sell_holding(
    db: Session,
    user_id: int,
    ticker: str,
    quantity: float,
    sale_price: float,
    sale_date,
    portfolio_id: int | None = None,
) -> HoldingSale:
    """Matches a sale against the user's existing open lots for this ticker (and
    portfolio scope) oldest-first (FIFO): the matched lots' `Holding.quantity` is
    reduced (or the row deleted once fully consumed), and the resulting realized P&L
    is computed from the actual matched cost basis and stored as a `HoldingSale` row.
    Raises ValueError if there isn't enough open quantity to sell.
    """
    if quantity <= 0:
        raise ValueError("Satış miktarı pozitiften büyük olmalıdır")

    ticker = ticker.upper()
    query = db.query(Holding).filter(Holding.user_id == user_id, Holding.ticker == ticker)
    if portfolio_id is not None:
        query = query.filter(Holding.portfolio_id == portfolio_id)
    lots = query.order_by(Holding.purchase_date.asc(), Holding.id.asc()).all()

    available = sum(lot.quantity for lot in lots)
    if quantity > available:
        raise ValueError(f"Yetersiz miktar: elinizde {available:g} adet {ticker} var")

    remaining = quantity
    matched_cost = 0.0
    for lot in lots:
        if remaining <= 0:
            break
        take = min(lot.quantity, remaining)
        matched_cost += take * lot.purchase_price
        lot.quantity -= take
        remaining -= take
        if lot.quantity <= 1e-9:
            db.delete(lot)

    sale = HoldingSale(
        user_id=user_id,
        portfolio_id=portfolio_id,
        ticker=ticker,
        quantity=quantity,
        sale_price=sale_price,
        sale_date=sale_date,
        cost_basis=matched_cost,
        realized_pl=quantity * sale_price - matched_cost,
    )
    db.add(sale)
    db.commit()
    db.refresh(sale)
    audit_service.log_action(db, user_id, "holding.sell", f"{ticker} x{quantity:g}")
    return sale


def list_sales(db: Session, user_id: int, portfolio_id: int | None = None) -> list[HoldingSale]:
    query = db.query(HoldingSale).filter(HoldingSale.user_id == user_id)
    if portfolio_id is not None:
        query = query.filter(HoldingSale.portfolio_id == portfolio_id)
    return query.order_by(HoldingSale.sale_date.desc()).all()


def delete_sale(db: Session, user_id: int, sale_id: int) -> bool:
    """Removes a realized-sale record (e.g. one entered by mistake). This only clears
    the history entry — it does not restore quantity to a `Holding` lot, since the
    lots it was originally matched against (via FIFO) may since have been edited,
    deleted, or partially consumed by other sales, so there's no single correct lot to
    credit it back to. A user who sold in error should re-add the position instead.
    """
    sale = db.query(HoldingSale).filter(HoldingSale.id == sale_id, HoldingSale.user_id == user_id).first()
    if sale is None:
        return False
    db.delete(sale)
    db.commit()
    return True


def realized_pl_summary(sales: list[HoldingSale]) -> dict:
    total_proceeds = sum(s.quantity * s.sale_price for s in sales)
    total_cost_basis = sum(s.cost_basis for s in sales)
    return {
        "total_realized_pl": total_proceeds - total_cost_basis,
        "total_proceeds": total_proceeds,
        "total_cost_basis": total_cost_basis,
        "sale_count": len(sales),
    }


def realized_pl_by_year(sales: list[HoldingSale]) -> list[dict]:
    """Groups realized sales by the calendar year of `sale_date`, and within each year
    by ticker — the basis for a yearly tax-report view (GET /holdings/sales/tax-report).
    Every figure here is already computed and stored on HoldingSale at sale time (see
    sell_holding's FIFO cost-basis matching); this is purely a grouping/summing pass,
    not a recomputation. Returned newest year first.
    """
    by_year: dict[int, list[HoldingSale]] = {}
    for sale in sales:
        by_year.setdefault(sale.sale_date.year, []).append(sale)

    years: list[dict] = []
    for year in sorted(by_year.keys(), reverse=True):
        year_sales = by_year[year]
        by_ticker: dict[str, list[HoldingSale]] = {}
        for sale in year_sales:
            by_ticker.setdefault(sale.ticker, []).append(sale)

        tickers = [
            {
                "ticker": ticker,
                **realized_pl_summary(ticker_sales),
            }
            for ticker, ticker_sales in sorted(by_ticker.items())
        ]

        years.append({"year": year, "tickers": tickers, **realized_pl_summary(year_sales)})

    return years


_TICKER_COLUMN_ALIASES = {"ticker", "sembol", "symbol", "hisse"}
_QUANTITY_COLUMN_ALIASES = {"quantity", "miktar", "adet"}
_PRICE_COLUMN_ALIASES = {"purchase_price", "fiyat", "alım fiyatı", "alim fiyati", "price"}
_DATE_COLUMN_ALIASES = {"purchase_date", "tarih", "date", "alım tarihi", "alim tarihi"}
_CSV_DATE_FORMATS = ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y")


def _parse_csv_date(value: str) -> datetime:
    value = value.strip()
    for fmt in _CSV_DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    raise ValueError(f"Tanınmayan tarih biçimi: '{value}' (bekleniyor: YYYY-AA-GG, GG.AA.YYYY veya GG/AA/YYYY)")


def _find_csv_column(fieldnames: list[str], aliases: set[str]) -> str | None:
    normalized = {name.strip().lower(): name for name in fieldnames}
    for alias in aliases:
        if alias in normalized:
            return normalized[alias]
    return None


def parse_holdings_csv(csv_text: str) -> dict:
    """Pure parse+validate pass over a holdings CSV export (header row plus
    ticker/quantity/purchase price/purchase date columns, English or Turkish header
    names both recognized) — writes nothing to the DB. Shared by the `/holdings/import
    /preview` endpoint (which only wants a preview) and `import_holdings_csv` below
    (which parses and then commits the valid rows). Valid rows are still returned even
    if others fail — each failure is reported with its row number rather than aborting
    the whole parse, since a single typo'd row in an otherwise-good export shouldn't
    block the rest.
    """
    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames:
        raise ValueError("CSV dosyası boş veya okunamadı")

    ticker_col = _find_csv_column(reader.fieldnames, _TICKER_COLUMN_ALIASES)
    quantity_col = _find_csv_column(reader.fieldnames, _QUANTITY_COLUMN_ALIASES)
    price_col = _find_csv_column(reader.fieldnames, _PRICE_COLUMN_ALIASES)
    date_col = _find_csv_column(reader.fieldnames, _DATE_COLUMN_ALIASES)

    missing = [
        label
        for label, col in (
            ("sembol", ticker_col),
            ("miktar", quantity_col),
            ("fiyat", price_col),
            ("tarih", date_col),
        )
        if col is None
    ]
    if missing:
        raise ValueError(f"CSV'de şu sütunlar bulunamadı: {', '.join(missing)}")

    rows: list[dict] = []
    errors: list[dict] = []
    for row_index, row in enumerate(reader, start=2):  # row 1 is the header
        try:
            ticker = (row.get(ticker_col) or "").strip()
            if not ticker:
                raise ValueError("Sembol boş olamaz")
            try:
                quantity = float((row.get(quantity_col) or "").strip())
            except ValueError:
                raise ValueError(f"Miktar sayısal değil: '{row.get(quantity_col)}'") from None
            try:
                purchase_price = float((row.get(price_col) or "").strip())
            except ValueError:
                raise ValueError(f"Fiyat sayısal değil: '{row.get(price_col)}'") from None
            purchase_date = _parse_csv_date(row.get(date_col) or "")
            if quantity <= 0 or purchase_price <= 0:
                raise ValueError("Miktar ve fiyat pozitif olmalıdır")

            rows.append(
                {
                    "ticker": ticker,
                    "quantity": quantity,
                    "purchase_price": purchase_price,
                    "purchase_date": purchase_date,
                }
            )
        except (ValueError, TypeError) as exc:
            errors.append({"row": row_index, "message": str(exc)})

    return {"rows": rows, "errors": errors}


def import_holdings_csv(db: Session, user_id: int, csv_text: str, portfolio_id: int | None = None) -> dict:
    """Parses the CSV (see parse_holdings_csv) and commits every valid row as a new
    Holding. Invalid rows are reported but don't block the valid ones from being added.
    """
    parsed = parse_holdings_csv(csv_text)
    imported = 0
    for row in parsed["rows"]:
        add_holding(
            db,
            user_id=user_id,
            ticker=row["ticker"],
            quantity=row["quantity"],
            purchase_price=row["purchase_price"],
            purchase_date=row["purchase_date"],
            portfolio_id=portfolio_id,
        )
        imported += 1

    return {"imported": imported, "errors": parsed["errors"]}
