from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, func

from database import Base


class PriceAlert(Base):
    """A user-defined, persisted condition on one asset (price or RSI crossing a
    threshold). Checked in the background by main.py's auto-refresh loop right after
    that asset's prices are refreshed, rather than only when a user happens to have
    the page open — see services/alert_service.check_alerts_for_asset(). One-shot: once
    triggered, is_active flips to False so it doesn't re-fire every refresh cycle.
    """

    __tablename__ = "price_alerts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False, index=True)
    condition = Column(String(20), nullable=False)  # "price_above" | "price_below" | "rsi_above" | "rsi_below"
    threshold = Column(Float, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    is_triggered = Column(Boolean, nullable=False, default=False)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now())
    triggered_at = Column(DateTime, nullable=True)
