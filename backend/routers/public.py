"""Unauthenticated, read-only routes reachable only by knowing an unguessable
share token (see Portfolio.share_token / portfolio_builder_service.generate_share_link).
Deliberately serves the exact same analysis payload the owner's own
GET /portfolios/{id}/analysis does — no holdings, no cost basis, no other personal
financial data lives in that payload to begin with, so exposing it without auth is
safe by construction rather than by a second, easy-to-drift-from filtering pass.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from i18n import get_lang, localize
from services import portfolio_builder_service, rate_limit

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/portfolios/{token}/analysis", dependencies=[Depends(rate_limit.throttle(30, 60))])
def get_public_portfolio_analysis(token: str, db: Session = Depends(get_db), lang: str = Depends(get_lang)):
    portfolio = portfolio_builder_service.get_portfolio_by_share_token(db, token)
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    try:
        return portfolio_builder_service.compute_portfolio_analysis_payload(db, portfolio)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc
