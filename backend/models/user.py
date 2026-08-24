from sqlalchemy import Boolean, Column, DateTime, Integer, String, func

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    # Opt-out, not opt-in: a triggered alert is a condition the user explicitly armed
    # themselves, so emailing about it by default matches most apps' treatment of
    # alerts you set yourself. See services/email_service.py — sending is a no-op
    # regardless (SMTP unconfigured) unless the deployment has set SMTP_* env vars.
    email_alerts_enabled = Column(Boolean, nullable=False, default=True)
    # TOTP-based 2FA (see services/auth_service.py). totp_secret is written at
    # /auth/2fa/setup time but totp_enabled stays False until the user actually
    # confirms a code at /auth/2fa/enable — so a half-finished setup never gates login.
    totp_secret = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, nullable=False, default=False)
    # Currency the cross-portfolio holdings totals (Home.tsx net worth, dividends, ...)
    # are aggregated into — see portfolio_service.AGGREGATE_CURRENCY. Defaults to TRY,
    # the app's original single-currency assumption.
    base_currency = Column(String(6), nullable=False, default="TRY")
    # Opt-in periodic portfolio-performance summary email — "off" by default (unlike
    # email_alerts_enabled above, this is a recurring email rather than a one-off
    # reaction to something the user explicitly armed, so it defaults to not sending).
    # See services/digest_service.py and main.py's _digest_email_loop.
    digest_frequency = Column(String(10), nullable=False, default="off")
    last_digest_sent_at = Column(DateTime, nullable=True)
