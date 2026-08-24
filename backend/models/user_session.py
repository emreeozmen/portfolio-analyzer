from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from database import Base


class UserSession(Base):
    """One row per issued JWT (login/register/2FA-verify) — see
    services/auth_service.issue_token_for_user(). The token's `jti` claim maps back
    to this row, which is what makes revocation possible at all: a JWT's own `exp`
    can't be invalidated early, so `get_current_user` additionally checks this table
    and 401s if the row is missing or `revoked_at` is set, regardless of whether the
    JWT itself is still technically unexpired.
    """

    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    jti = Column(String(36), nullable=False, unique=True, index=True)
    user_agent = Column(String(255), nullable=True)
    ip_address = Column(String(64), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    last_seen_at = Column(DateTime, server_default=func.now())
    revoked_at = Column(DateTime, nullable=True)
