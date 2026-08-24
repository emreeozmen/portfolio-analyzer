from sqlalchemy.orm import Session

from models import AuditLog

RECENT_ACTIONS_LIMIT = 100


def log_action(db: Session, user_id: int, action: str, detail: str | None = None) -> None:
    """Append-only: records that `user_id` took `action` (e.g. "portfolio.create",
    "holding.sell", "2fa.enable") for GET /auth/activity. Best-effort by design — a
    logging failure should never break the action it's describing, so callers should
    call this after the real work already committed, not wrap it in the same
    try/except as the action itself.
    """
    db.add(AuditLog(user_id=user_id, action=action, detail=detail))
    db.commit()


def list_recent_actions(db: Session, user_id: int) -> list[AuditLog]:
    # id.desc() as a tiebreaker — created_at's server-side timestamp resolution isn't
    # fine-grained enough to guarantee distinct values for actions logged in quick
    # succession (e.g. several audit calls within the same request).
    return (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(RECENT_ACTIONS_LIMIT)
        .all()
    )
