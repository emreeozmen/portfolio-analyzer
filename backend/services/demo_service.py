"""Educational, read-only examples using public assets and existing price history.

No demo accounts, saved portfolios, generated prices or user holdings are created.
"""

from sqlalchemy.orm import Session

from models import Asset, Portfolio, PortfolioAsset
from services import portfolio_builder_service

PRESETS = {
    "bist-five": {"currency": "TRY", "weights": {"THYAO": 0.2, "ASELS": 0.2, "GARAN": 0.2, "TUPRS": 0.2, "AKBNK": 0.2}},
    "us-tech": {"currency": "USD", "weights": {"AAPL": 0.25, "MSFT": 0.25, "GOOGL": 0.25, "NVDA": 0.25}},
    "concentrated": {"currency": "TRY", "weights": {"THYAO": 0.6, "ASELS": 0.2, "TUPRS": 0.2}},
}


def get_demo_analysis(db: Session, preset_id: str) -> dict:
    preset = PRESETS[preset_id]
    weights = preset["weights"]
    assets = db.query(Asset).filter(Asset.ticker.in_(weights), Asset.is_default.is_(True)).all()
    by_ticker = {asset.ticker: asset for asset in assets}
    if any(ticker not in by_ticker for ticker in weights):
        raise ValueError("Demo assets are not available")
    if any(asset.currency != preset["currency"] for asset in assets):
        raise ValueError("Demo asset currencies do not match")
    pairs = [(PortfolioAsset(weight=weight), by_ticker[ticker]) for ticker, weight in weights.items()]
    # These ORM instances are transient. They are never added to the session.
    example = Portfolio(
        id=0, name=preset_id, user_id=0,
        benchmark_symbol="^GSPC" if preset_id == "us-tech" else None,
        benchmark_label="S&P 500" if preset_id == "us-tech" else None,
    )
    payload = portfolio_builder_service.compute_portfolio_analysis_payload(db, example, portfolio_assets=pairs)
    return {**payload, "preset_id": preset_id, "currency": preset["currency"], "educational": True}
