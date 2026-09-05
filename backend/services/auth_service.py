import base64
import hashlib
import io
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import pyotp
import qrcode
from sqlalchemy.orm import Session

from config import settings
from models import User, UserSession

TOTP_ISSUER = "Portfolio Analyzer"
TWO_FA_CHALLENGE_EXPIRE_MINUTES = 5
SESSION_TOUCH_INTERVAL = timedelta(minutes=5)
EMAIL_VERIFICATION_EXPIRE_HOURS = 24
PASSWORD_RESET_EXPIRE_MINUTES = 30


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed_password.encode())


def _encode_token(payload: dict, expires_delta: timedelta) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    return jwt.encode({**payload, "exp": expire}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])


def issue_token_for_user(
    db: Session, user: User, user_agent: str | None = None, ip_address: str | None = None
) -> str:
    """Mints a real access token AND a server-side UserSession row keyed by the
    token's `jti` — a JWT's own `exp` can't be canceled early, so this row is what
    actually makes the session revocable (see get_active_session / routers/auth.py's
    /auth/sessions endpoints). Call this for every real login (register, login,
    2fa/verify) — never encode an access token any other way.
    """
    jti = str(uuid.uuid4())
    db.add(UserSession(user_id=user.id, jti=jti, user_agent=user_agent, ip_address=ip_address))
    db.commit()
    return _encode_token(
        {"sub": str(user.id), "jti": jti, "purpose": "access"},
        timedelta(minutes=settings.jwt_expire_minutes),
    )


def decode_access_token(token: str) -> tuple[int, str]:
    """Returns (user_id, jti) for a real access token. Raises jwt.PyJWTError on a
    malformed/expired/mis-signed token, or ValueError if the token is well-formed but
    isn't actually an access token (e.g. a 2FA challenge token used somewhere that
    expects a real session)."""
    payload = _decode_token(token)
    if payload.get("purpose") != "access" or "jti" not in payload:
        raise ValueError("Not an access token")
    return int(payload["sub"]), payload["jti"]


def get_active_session(db: Session, jti: str) -> UserSession | None:
    return db.query(UserSession).filter(UserSession.jti == jti, UserSession.revoked_at.is_(None)).first()


def touch_session(db: Session, session: UserSession) -> None:
    """Bumps last_seen_at, but only if it's gone stale — avoids a DB write on every
    single authenticated request."""
    now = datetime.now(timezone.utc)
    last_seen = session.last_seen_at
    if last_seen is not None and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if last_seen is None or now - last_seen > SESSION_TOUCH_INTERVAL:
        session.last_seen_at = now
        db.commit()


def issue_2fa_challenge_token(user: User) -> str:
    """Short-lived, purpose-scoped token proving the password step already
    succeeded for a 2FA-enabled account — NOT a real access token (no jti, no
    UserSession row), only redeemable once at /auth/2fa/verify."""
    return _encode_token({"sub": str(user.id), "purpose": "2fa_challenge"}, timedelta(minutes=TWO_FA_CHALLENGE_EXPIRE_MINUTES))


def decode_2fa_challenge_token(token: str) -> int:
    payload = _decode_token(token)
    if payload.get("purpose") != "2fa_challenge":
        raise ValueError("Not a 2FA challenge token")
    return int(payload["sub"])


def issue_email_verification_token(user: User) -> str:
    """Short-lived, purpose-scoped token proving control of the address at the time it
    was sent — redeemable once at /auth/verify-email. Not a real access token (no jti,
    no UserSession row), and registration itself is never gated on this ever being
    redeemed."""
    return _encode_token(
        {"sub": str(user.id), "purpose": "email_verify"}, timedelta(hours=EMAIL_VERIFICATION_EXPIRE_HOURS)
    )


def decode_email_verification_token(token: str) -> int:
    payload = _decode_token(token)
    if payload.get("purpose") != "email_verify":
        raise ValueError("Not an email verification token")
    return int(payload["sub"])


def password_fingerprint(hashed_password: str) -> str:
    """A short, non-reversible fingerprint of a password hash, embedded in a
    password-reset token (see issue_password_reset_token) so the token stops
    validating the moment the password actually changes — without this, a reset link
    would stay usable for its full expiry window even after being redeemed once, e.g.
    if it leaked into a browser's history or an email got forwarded. This makes an
    otherwise-stateless JWT effectively single-use with no separate DB table to track
    used tokens.
    """
    return hashlib.sha256(hashed_password.encode()).hexdigest()[:16]


def issue_password_reset_token(user: User) -> str:
    return _encode_token(
        {"sub": str(user.id), "purpose": "password_reset", "pwd_fp": password_fingerprint(user.hashed_password)},
        timedelta(minutes=PASSWORD_RESET_EXPIRE_MINUTES),
    )


def decode_password_reset_token(token: str) -> tuple[int, str]:
    """Returns (user_id, password_fingerprint) — the caller still has to look up the
    user and compare the fingerprint against their *current* hashed_password (see
    password_fingerprint's docstring); this only confirms the token is well-formed,
    unexpired, and actually a password-reset token."""
    payload = _decode_token(token)
    if payload.get("purpose") != "password_reset" or "pwd_fp" not in payload:
        raise ValueError("Not a password reset token")
    return int(payload["sub"]), payload["pwd_fp"]


def reset_password(db: Session, user: User, new_password: str) -> None:
    """Used by the forgot-password flow, where there's no current password to verify
    (unlike update_password). Also revokes every active session on the account — a
    password reset is exactly the moment an account may have been compromised (or the
    user simply lost access across devices), so a session issued under the old
    password shouldn't silently keep working after this.
    """
    user.hashed_password = hash_password(new_password)
    db.query(UserSession).filter(UserSession.user_id == user.id, UserSession.revoked_at.is_(None)).update(
        {"revoked_at": datetime.now(timezone.utc)}
    )
    db.commit()


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=TOTP_ISSUER)


def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def totp_qr_data_uri(uri: str) -> str:
    """Renders the otpauth:// URI as a PNG QR code server-side and returns it as a
    data: URI — the frontend just needs an <img src>, no QR-generation library of its
    own."""
    image = qrcode.make(uri)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}"


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def create_user(db: Session, email: str, password: str) -> User:
    user = User(email=email, hashed_password=hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(db, email)
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


def update_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, user.hashed_password):
        raise ValueError("Mevcut şifre yanlış")
    user.hashed_password = hash_password(new_password)
    db.commit()


def update_email(db: Session, user: User, new_email: str, current_password: str) -> User:
    if not verify_password(current_password, user.hashed_password):
        raise ValueError("Şifre yanlış")
    existing = get_user_by_email(db, new_email)
    if existing is not None and existing.id != user.id:
        raise ValueError("Bu e-posta adresi zaten kullanımda")
    # Only actually reset verification (and, at the router layer, only then re-send a
    # verification email) when the address is genuinely changing — resubmitting the
    # same email (the form's own "save" with nothing edited, or a double-click/retry)
    # used to unconditionally reset email_verified and fire a fresh email every time,
    # which is exactly what spammed a real account's inbox with repeat "verify your
    # email" sends before this was caught.
    if new_email != user.email:
        user.email_verified = False
    user.email = new_email
    db.commit()
    db.refresh(user)
    return user
