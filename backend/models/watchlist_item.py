from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint, func

from database import Base


class WatchlistItem(Base):
    """Marks that a specific user tracks a specific (non-default) Asset. Assets
    themselves stay in one shared, global pool (so price data/history is fetched and
    cached once, not per user) — this table is only what makes an asset show up in
    *this* user's lists (Piyasa Görünümü, Varlık Listesi, watchlist sidebar)."""

    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("user_id", "asset_id", name="uq_watchlist_user_asset"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())
