from sqlalchemy import Boolean, Column, DateTime, Integer, String, Unicode, func

from database import Base


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(Unicode(150), nullable=False)
    yahoo_symbol = Column(String(20), nullable=False)
    exchange = Column(String(40), nullable=True)
    currency = Column(String(6), nullable=False, default="USD")
    # Default assets (the seeded BIST tickers) are visible to every visitor, logged in
    # or not. Non-default assets were tracked by a specific user via the search bar and
    # are only visible to that user (see WatchlistItem / asset_service.list_visible_assets).
    is_default = Column(Boolean, nullable=False, default=False)
    sector = Column(String(60), nullable=True)  # real yfinance sector, e.g. "Technology"; never fabricated
    created_at = Column(DateTime, server_default=func.now())
