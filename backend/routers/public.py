"""Unauthenticated, read-only shared portfolios and fixed educational examples.
User portfolios require an unguessable share token; demos use public default assets.
Deliberately serves the exact same analysis payload the owner's own
GET /portfolios/{id}/analysis does — no holdings, no cost basis, no other personal
financial data lives in that payload to begin with, so exposing it without auth is
safe by construction rather than by a second, easy-to-drift-from filtering pass.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from i18n import get_lang, localize
from services import demo_service, portfolio_builder_service, rate_limit
from services.http_cache import cache_control

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/demo-portfolios/{preset_id}", dependencies=[Depends(rate_limit.throttle(30, 60)), Depends(cache_control(60))])
def get_demo_portfolio(preset_id: str, db: Session = Depends(get_db)):
    if preset_id not in demo_service.PRESETS:
        raise HTTPException(status_code=404, detail="Demo not found")
    try:
        return demo_service.get_demo_analysis(db, preset_id)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Demo price history is temporarily unavailable") from exc


@router.get("/portfolios/{token}/analysis", dependencies=[Depends(rate_limit.throttle(30, 60))])
def get_public_portfolio_analysis(token: str, db: Session = Depends(get_db), lang: str = Depends(get_lang)):
    portfolio = portfolio_builder_service.get_portfolio_by_share_token(db, token)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    try:
        return portfolio_builder_service.compute_portfolio_analysis_payload(db, portfolio)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc
