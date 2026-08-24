"""Optional Web Push (VAPID) delivery, used to notify a user by browser/OS push —
even with the tab or app closed — when one of their armed price/RSI/MACD/volume
alerts triggers (see routers/alerts.py, alert_service.py, and main.py's
_auto_refresh_loop). Deliberately a soft dependency, same philosophy as
Sentry/Redis/SMTP elsewhere in this app: with vapid_public_key/vapid_private_key
unset, is_configured() is False and send_alert_push() is a no-op, so a triggered
alert still lands on the in-app "alerts" WebSocket channel and (if configured) email
regardless of whether push is set up.
"""

import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy.orm import Session

from config import settings
from models import PushSubscription

logger = logging.getLogger("uvicorn.error")


def is_configured() -> bool:
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def upsert_subscription(db: Session, user_id: int, endpoint: str, p256dh: str, auth: str) -> PushSubscription:
    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == endpoint).first()
    if existing:
        existing.user_id = user_id
        existing.p256dh = p256dh
        existing.auth = auth
        db.commit()
        db.refresh(existing)
        return existing

    subscription = PushSubscription(user_id=user_id, endpoint=endpoint, p256dh=p256dh, auth=auth)
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return subscription


def remove_subscription(db: Session, user_id: int, endpoint: str) -> bool:
    subscription = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == endpoint, PushSubscription.user_id == user_id)
        .first()
    )
    if subscription is None:
        return False
    db.delete(subscription)
    db.commit()
    return True


def _send_to_subscription(db: Session, subscription: PushSubscription, payload: dict) -> bool:
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
        )
        return True
    except WebPushException as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        if status_code in (404, 410):
            # The browser/OS says this subscription is gone (uninstalled, permission
            # revoked, endpoint expired) — stop trying it rather than erroring on
            # every future alert for this device.
            db.delete(subscription)
            db.commit()
        else:
            logger.warning("push send to subscription %s failed: %s", subscription.id, exc)
        return False
    except Exception as exc:
        logger.warning("push send to subscription %s failed: %s", subscription.id, exc)
        return False


def send_alert_push(db: Session, user_id: int, ticker: str, condition: str, threshold: float) -> int:
    """Best-effort push to every device the user has subscribed on. Returns how many
    actually sent — callers should treat this purely as a delivery-count signal, never
    as a reason to fail their own operation (an alert still triggered and is still
    visible in-app/email regardless of this outcome).
    """
    if not is_configured():
        return 0

    condition_labels = {
        "price_above": f"fiyat {threshold} üzerine çıktı",
        "price_below": f"fiyat {threshold} altına indi",
        "rsi_above": f"RSI {threshold} üzerine çıktı",
        "rsi_below": f"RSI {threshold} altına indi",
        "macd_bull_cross": "MACD yükseliş kesişimi yaptı",
        "macd_bear_cross": "MACD düşüş kesişimi yaptı",
        "volume_spike": f"hacim {threshold}x ortalamaya çıktı",
    }
    description = condition_labels.get(condition, f"{condition} eşiği ({threshold}) gerçekleşti")
    payload = {
        "title": f"{ticker} uyarınız tetiklendi",
        "body": description,
        "url": f"/assets/{ticker}",
    }

    subscriptions = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    sent = 0
    for subscription in subscriptions:
        if _send_to_subscription(db, subscription, payload):
            sent += 1
    return sent
