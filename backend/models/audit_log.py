from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from database import Base


class AuditLog(Base):
    """An append-only record of security/data-relevant actions a user took (portfolio
    create/update/delete, holding create/update/delete/sell, password/email change,
    2FA enable/disable, session revocation — see services/audit_service.log_action()
    and its call sites). Read-only from the API's perspective (GET /auth/activity);
    nothing ever updates or deletes a row here.
    """

    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String(60), nullable=False)
    detail = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
