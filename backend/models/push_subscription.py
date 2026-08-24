from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from database import Base


class PushSubscription(Base):
    """A browser's Web Push subscription (see services/push_service.py) — one row per
    device/browser a user has enabled push notifications on, since a user can have
    several. `endpoint`/`p256dh`/`auth` are exactly the fields the browser's
    `PushSubscription.toJSON()` returns; `endpoint` is unique per browser install, so
    re-subscribing the same device just upserts rather than accumulating duplicates.
    Row presence is itself the "push enabled for this device" signal — no separate
    boolean flag, mirroring how a WatchlistItem row's presence (not a flag) marks an
    asset as tracked.
    """

    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    endpoint = Column(String(500), unique=True, nullable=False)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
