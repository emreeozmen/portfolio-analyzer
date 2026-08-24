from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Unicode, func

from database import Base


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(Unicode(100), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    # Custom comparison index for this portfolio's analysis chart; NULL falls back to
    # BIST 100 (see routers/portfolios.py). yahoo_symbol/display-name pair chosen by
    # the user at save time, not re-derived, since search_symbols() excludes indices.
    benchmark_symbol = Column(String(20), nullable=True)
    benchmark_label = Column(Unicode(100), nullable=True)
    # Random URL-safe token enabling a public, unauthenticated, read-only view of this
    # portfolio's analysis (see routers/public.py). NULL = not shared.
    share_token = Column(String(64), nullable=True, unique=True, index=True)
