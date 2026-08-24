"""Persisted price/technical alerts: a user arms a condition on one asset (price or
RSI crossing a threshold), and it's evaluated in the background whenever that asset's
prices refresh (see main.py's auto-refresh loop) rather than only when the user has the
page open. One-shot — once triggered, is_active flips False so it doesn't re-fire.
"""

from datetime import datetime

import pandas as pd
from sqlalchemy.orm import Session

from analysis.portfolio_metrics import macd_line_and_signal, rsi as compute_rsi
from models import Asset, PriceAlert, PriceHistory

VALID_CONDITIONS = {
    "price_above",
    "price_below",
    "rsi_above",
    "rsi_below",
    "macd_bull_cross",
    "macd_bear_cross",
    "volume_spike",
}
# MACD crossover conditions have no meaningful numeric threshold (the frontend sends
# 0 for them) — only these conditions require a real positive threshold value.
THRESHOLD_REQUIRED_CONDITIONS = {"price_above", "price_below", "rsi_above", "rsi_below", "volume_spike"}
RSI_PERIOD = 14
VOLUME_AVERAGE_WINDOW = 20


def create_alert(db: Session, user_id: int, asset_id: int, condition: str, threshold: float) -> PriceAlert:
    if condition not in VALID_CONDITIONS:
        raise ValueError("Geçersiz uyarı koşulu")
    if condition in THRESHOLD_REQUIRED_CONDITIONS and threshold <= 0:
        raise ValueError("Eşik değeri pozitif olmalıdır")

    alert = PriceAlert(user_id=user_id, asset_id=asset_id, condition=condition, threshold=threshold)
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


def _alert_to_dict(alert: PriceAlert, ticker: str) -> dict:
    return {
        "id": alert.id,
        "ticker": ticker,
        "condition": alert.condition,
        "threshold": alert.threshold,
        "is_active": alert.is_active,
        "is_triggered": alert.is_triggered,
        "is_read": alert.is_read,
        "created_at": alert.created_at,
        "triggered_at": alert.triggered_at,
    }


def list_alerts(db: Session, user_id: int) -> list[dict]:
    rows = (
        db.query(PriceAlert, Asset.ticker)
        .join(Asset, PriceAlert.asset_id == Asset.id)
        .filter(PriceAlert.user_id == user_id)
        .order_by(PriceAlert.created_at.desc())
        .all()
    )
    return [_alert_to_dict(alert, ticker) for alert, ticker in rows]


def get_alert(db: Session, user_id: int, alert_id: int) -> PriceAlert | None:
    return db.query(PriceAlert).filter(PriceAlert.id == alert_id, PriceAlert.user_id == user_id).first()


def delete_alert(db: Session, user_id: int, alert_id: int) -> bool:
    alert = get_alert(db, user_id, alert_id)
    if alert is None:
        return False
    db.delete(alert)
    db.commit()
    return True


def mark_read(db: Session, user_id: int, alert_id: int) -> bool:
    alert = get_alert(db, user_id, alert_id)
    if alert is None:
        return False
    alert.is_read = True
    db.commit()
    return True


def mark_all_read(db: Session, user_id: int) -> None:
    db.query(PriceAlert).filter(PriceAlert.user_id == user_id, PriceAlert.is_read == False).update(  # noqa: E712
        {"is_read": True}
    )
    db.commit()


def _condition_met(
    condition: str,
    threshold: float,
    last_price: float,
    rsi_value: float | None,
    macd_cross: str | None,
    volume_ratio: float | None,
) -> bool:
    if condition == "price_above":
        return last_price >= threshold
    if condition == "price_below":
        return last_price <= threshold
    if condition == "rsi_above":
        return rsi_value is not None and rsi_value >= threshold
    if condition == "rsi_below":
        return rsi_value is not None and rsi_value <= threshold
    if condition == "macd_bull_cross":
        return macd_cross == "bull"
    if condition == "macd_bear_cross":
        return macd_cross == "bear"
    if condition == "volume_spike":
        return volume_ratio is not None and volume_ratio >= threshold
    return False


def _latest_macd_cross(closes: pd.Series) -> str | None:
    """"bull"/"bear" if the MACD line crossed its signal line between the last two
    trading days, else None — a static "macd is above signal today" check (like the
    frontend's live Teknikler-tab display) can't tell a fresh cross from a level
    that's simply been sitting above/below signal for weeks, so this compares the
    last two points, not just the latest one.
    """
    macd_line, signal_line = macd_line_and_signal(closes)
    diff = macd_line - signal_line
    if len(diff) < 2:
        return None
    prev_diff, curr_diff = diff.iloc[-2], diff.iloc[-1]
    if pd.isna(prev_diff) or pd.isna(curr_diff):
        return None
    if prev_diff < 0 and curr_diff >= 0:
        return "bull"
    if prev_diff > 0 and curr_diff <= 0:
        return "bear"
    return None


def _latest_volume_ratio(volumes: pd.Series) -> float | None:
    """Today's volume divided by the average of the preceding VOLUME_AVERAGE_WINDOW
    days (today excluded) — None if there isn't enough history yet or the average is
    zero, so a volume_spike alert simply doesn't fire rather than dividing by zero.
    """
    if len(volumes) < VOLUME_AVERAGE_WINDOW + 1:
        return None
    avg_volume = float(volumes.iloc[-(VOLUME_AVERAGE_WINDOW + 1) : -1].mean())
    if avg_volume <= 0:
        return None
    return float(volumes.iloc[-1]) / avg_volume


def check_alerts_for_asset(db: Session, asset_id: int) -> list[PriceAlert]:
    """Evaluates every still-active alert on this asset against its latest price
    history, marking matches triggered. Returns the alerts newly triggered by this
    call (not just a count) so a caller — main.py's auto-refresh loop, specifically —
    can push each one to its owning user's WebSocket connection in real time rather
    than only surfacing it the next time that user's client happens to poll.
    """
    active_alerts = (
        db.query(PriceAlert).filter(PriceAlert.asset_id == asset_id, PriceAlert.is_active == True).all()  # noqa: E712
    )
    if not active_alerts:
        return []

    price_rows = (
        db.query(PriceHistory).filter(PriceHistory.asset_id == asset_id).order_by(PriceHistory.date).all()
    )
    if not price_rows:
        return []

    closes = pd.Series([row.close_price for row in price_rows])
    volumes = pd.Series([row.volume for row in price_rows])
    last_price = float(closes.iloc[-1])
    rsi_series = compute_rsi(closes, RSI_PERIOD)
    rsi_value = None if rsi_series.empty or pd.isna(rsi_series.iloc[-1]) else float(rsi_series.iloc[-1])
    macd_cross = _latest_macd_cross(closes)
    volume_ratio = _latest_volume_ratio(volumes)

    newly_triggered: list[PriceAlert] = []
    for alert in active_alerts:
        if _condition_met(alert.condition, alert.threshold, last_price, rsi_value, macd_cross, volume_ratio):
            alert.is_triggered = True
            alert.is_active = False
            alert.triggered_at = datetime.utcnow()
            newly_triggered.append(alert)

    if newly_triggered:
        db.commit()
    return newly_triggered
