import re
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from i18n import get_lang, localize
from models import User, UserSession
from services import audit_service, auth_service, email_service, rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=True)


def _send_verification_email(user: User) -> None:
    """Best-effort — a no-op if SMTP isn't configured (email_service.is_configured()),
    same graceful-degradation philosophy as every other email in this app. Never
    raises into the caller; registration/email-change succeed regardless."""
    if not email_service.is_configured():
        return
    token = auth_service.issue_email_verification_token(user)
    frontend_base = settings.cors_origins_list[0] if settings.cors_origins_list else "http://localhost:5173"
    verify_url = f"{frontend_base}/dogrula?token={token}"
    email_service.send_verification_email(user.email, verify_url)
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)

PASSWORD_MIN_LENGTH = 8
# bcrypt only ever looks at a password's first 72 bytes, so anything past that adds no
# real strength — capping input length here also means a client can't send a
# multi-megabyte "password" string just to burn CPU/memory before hashing even starts.
PASSWORD_MAX_LENGTH = 128
EMAIL_MAX_LENGTH = 254  # RFC 5321's own limit on a full email address
ALLOWED_BASE_CURRENCIES = {"TRY", "USD", "EUR", "GBP"}
ALLOWED_DIGEST_FREQUENCIES = {"off", "weekly", "monthly"}


def _validate_password_strength(value: str) -> str:
    if len(value) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Şifre en az {PASSWORD_MIN_LENGTH} karakter olmalıdır")
    if len(value) > PASSWORD_MAX_LENGTH:
        raise ValueError(f"Şifre en fazla {PASSWORD_MAX_LENGTH} karakter olabilir")
    if not re.search(r"[A-Za-z]", value):
        raise ValueError("Şifre en az bir harf içermelidir")
    if not re.search(r"\d", value):
        raise ValueError("Şifre en az bir rakam içermelidir")
    return value


def _client_info(request: Request) -> tuple[str | None, str | None]:
    user_agent = request.headers.get("user-agent")
    ip_address = request.client.host if request.client else None
    return user_agent, ip_address


class RegisterRequest(BaseModel):
    email: EmailStr = Field(max_length=EMAIL_MAX_LENGTH)
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        return _validate_password_strength(value)


class LoginRequest(BaseModel):
    email: EmailStr = Field(max_length=EMAIL_MAX_LENGTH)
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginResponse(BaseModel):
    """Either a real token (requires_2fa=False) or a short-lived challenge_token the
    client must redeem at /auth/2fa/verify (requires_2fa=True) — never both."""

    access_token: str | None = None
    token_type: str = "bearer"
    requires_2fa: bool = False
    challenge_token: str | None = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    email_verified: bool
    email_alerts_enabled: bool
    totp_enabled: bool
    base_currency: str
    digest_frequency: str


class UpdateNotificationPreferencesRequest(BaseModel):
    email_alerts_enabled: bool
    digest_frequency: str = "off"

    @field_validator("digest_frequency")
    @classmethod
    def known_digest_frequency(cls, value: str) -> str:
        if value not in ALLOWED_DIGEST_FREQUENCIES:
            raise ValueError(f"Geçersiz bildirim sıklığı: {value}")
        return value


class UpdateCurrencyRequest(BaseModel):
    base_currency: str

    @field_validator("base_currency")
    @classmethod
    def known_currency(cls, value: str) -> str:
        value = value.upper()
        if value not in ALLOWED_BASE_CURRENCIES:
            raise ValueError(f"Desteklenmeyen para birimi: {value}")
        return value


class UpdatePasswordRequest(BaseModel):
    current_password: str = Field(max_length=PASSWORD_MAX_LENGTH)
    new_password: str = Field(max_length=PASSWORD_MAX_LENGTH)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        return _validate_password_strength(value)


class UpdateEmailRequest(BaseModel):
    new_email: EmailStr = Field(max_length=EMAIL_MAX_LENGTH)
    current_password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class TwoFactorSetupResponse(BaseModel):
    secret: str
    qr_code_data_uri: str


class TwoFactorEnableRequest(BaseModel):
    code: str = Field(max_length=10)


class TwoFactorDisableRequest(BaseModel):
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)
    code: str = Field(max_length=10)


class TwoFactorVerifyRequest(BaseModel):
    challenge_token: str = Field(max_length=2000)
    code: str = Field(max_length=10)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr = Field(max_length=EMAIL_MAX_LENGTH)


class ResetPasswordRequest(BaseModel):
    token: str = Field(max_length=2000)
    new_password: str = Field(max_length=PASSWORD_MAX_LENGTH)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        return _validate_password_strength(value)


class SessionResponse(BaseModel):
    id: int
    user_agent: str | None
    ip_address: str | None
    created_at: datetime
    last_seen_at: datetime
    is_current: bool


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    detail: str | None
    created_at: datetime


class AdminUserResponse(BaseModel):
    id: int
    email: str
    created_at: datetime
    # Most recent non-revoked session's last_seen_at across every device — a good-enough
    # proxy for "last active" without needing a dedicated last-login column on User.
    last_seen_at: datetime | None


@router.post("/register", response_model=TokenResponse, dependencies=[Depends(rate_limit.throttle(20, 3600))])
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    if auth_service.get_user_by_email(db, payload.email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    user = auth_service.create_user(db, payload.email, payload.password)
    _send_verification_email(user)
    user_agent, ip_address = _client_info(request)
    return TokenResponse(access_token=auth_service.issue_token_for_user(db, user, user_agent, ip_address))


@router.post(
    "/login",
    response_model=LoginResponse,
    # The email-keyed lockout below (is_locked_out/record_failed_attempt) only ever
    # blocks repeated guesses against one email — it does nothing to slow an attacker
    # spraying a single common password across many different email addresses from
    # one IP. This IP-keyed throttle is the defense for that case; both apply
    # independently.
    dependencies=[Depends(rate_limit.throttle(20, 300))],
)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    locked_seconds = rate_limit.is_locked_out(payload.email)
    if locked_seconds > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Çok fazla başarısız deneme. {int(locked_seconds // 60) + 1} dakika sonra tekrar deneyin.",
        )

    user = auth_service.authenticate_user(db, payload.email, payload.password)
    if not user:
        rate_limit.record_failed_attempt(payload.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    rate_limit.reset_attempts(payload.email)

    if user.totp_enabled:
        return LoginResponse(requires_2fa=True, challenge_token=auth_service.issue_2fa_challenge_token(user))

    user_agent, ip_address = _client_info(request)
    token = auth_service.issue_token_for_user(db, user, user_agent, ip_address)
    return LoginResponse(access_token=token)


@router.post("/2fa/verify", response_model=TokenResponse, dependencies=[Depends(rate_limit.throttle(10, 300))])
def verify_2fa(payload: TwoFactorVerifyRequest, request: Request, db: Session = Depends(get_db)):
    try:
        user_id = auth_service.decode_2fa_challenge_token(payload.challenge_token)
    except (jwt.PyJWTError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Geçersiz veya süresi dolmuş kod isteği") from exc

    user = db.get(User, user_id)
    if user is None or not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Geçersiz istek")
    if not auth_service.verify_totp(user.totp_secret, payload.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Doğrulama kodu yanlış")

    user_agent, ip_address = _client_info(request)
    token = auth_service.issue_token_for_user(db, user, user_agent, ip_address)
    return TokenResponse(access_token=token)


@router.post(
    "/forgot-password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit.throttle(5, 900))],
)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Always responds 204 whether or not the email is registered — unlike /register
    (which has to tell its own caller "that email's taken" for its UX to work at all),
    this endpoint has no legitimate reason to confirm account existence, so it never
    does. The reset email itself is only actually sent (best-effort, a no-op if SMTP
    isn't configured — see email_service.is_configured) when a matching account is
    found.
    """
    user = auth_service.get_user_by_email(db, payload.email)
    if user is not None:
        token = auth_service.issue_password_reset_token(user)
        frontend_base = settings.cors_origins_list[0] if settings.cors_origins_list else "http://localhost:5173"
        reset_url = f"{frontend_base}/sifre-sifirla?token={token}"
        email_service.send_password_reset_email(user.email, reset_url)


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit.throttle(10, 900))],
)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db), lang: str = Depends(get_lang)):
    try:
        user_id, pwd_fp = auth_service.decode_password_reset_token(payload.token)
    except (jwt.PyJWTError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=localize("Geçersiz veya süresi dolmuş bağlantı", lang),
        ) from exc

    user = db.get(User, user_id)
    if user is None or auth_service.password_fingerprint(user.hashed_password) != pwd_fp:
        # Same message for "no such user" and "token already used/stale" — both are a
        # dead link from the caller's point of view, and distinguishing them would leak
        # nothing useful anyway (the fingerprint mismatch case means the account's
        # password already changed since this link was issued).
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=localize("Geçersiz veya süresi dolmuş bağlantı", lang),
        )

    auth_service.reset_password(db, user, payload.new_password)
    audit_service.log_action(db, user.id, "password.reset")


def get_current_user_and_session(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> tuple[User, UserSession]:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        user_id, jti = auth_service.decode_access_token(token)
    except (jwt.PyJWTError, ValueError) as exc:
        raise credentials_error from exc

    session = auth_service.get_active_session(db, jti)
    if session is None:
        raise credentials_error
    user = db.get(User, user_id)
    if user is None:
        raise credentials_error
    auth_service.touch_session(db, session)
    return user, session


def get_current_user(result: tuple[User, UserSession] = Depends(get_current_user_and_session)) -> User:
    return result[0]


def get_current_user_optional(
    token: str | None = Depends(oauth2_scheme_optional), db: Session = Depends(get_db)
) -> User | None:
    """Same as get_current_user but returns None instead of raising when there's no
    (or an invalid/revoked) token — for endpoints that personalize results for logged-in
    users without requiring login (Piyasa Görünümü, Varlık Listesi stay public).
    """
    if not token:
        return None
    try:
        user_id, jti = auth_service.decode_access_token(token)
    except (jwt.PyJWTError, ValueError):
        return None
    session = auth_service.get_active_session(db, jti)
    if session is None:
        return None
    auth_service.touch_session(db, session)
    return db.get(User, user_id)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: UpdatePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    try:
        auth_service.update_password(db, current_user, payload.current_password, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=localize(str(exc), lang)) from exc
    audit_service.log_action(db, current_user.id, "password.change")


@router.put(
    "/me/email", response_model=UserResponse, dependencies=[Depends(rate_limit.throttle(5, 300))]
)
def change_email(
    payload: UpdateEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    email_actually_changing = payload.new_email != current_user.email
    try:
        user = auth_service.update_email(db, current_user, payload.new_email, payload.current_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=localize(str(exc), lang)) from exc
    audit_service.log_action(db, current_user.id, "email.change", payload.new_email)
    # Only when the address genuinely changed — resubmitting the same email (a plain
    # "save" with nothing edited, or a double-click) must never fire another
    # verification email. This plus the throttle above is what actually stops a
    # repeat-submit from spamming an inbox; see update_email's own matching guard.
    if email_actually_changing:
        _send_verification_email(user)
    return user


class VerifyEmailRequest(BaseModel):
    token: str


@router.post(
    "/verify-email",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit.throttle(20, 300))],
)
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)):
    try:
        user_id = auth_service.decode_email_verification_token(payload.token)
    except (jwt.PyJWTError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Geçersiz veya süresi dolmuş bağlantı") from exc
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.email_verified:
        user.email_verified = True
        db.commit()
        audit_service.log_action(db, user.id, "email.verify")


@router.post(
    "/resend-verification",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit.throttle(3, 300))],
)
def resend_verification(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.email_verified:
        return
    _send_verification_email(current_user)


@router.put("/me/notifications", response_model=UserResponse)
def update_notification_preferences(
    payload: UpdateNotificationPreferencesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.email_alerts_enabled = payload.email_alerts_enabled
    current_user.digest_frequency = payload.digest_frequency
    db.commit()
    db.refresh(current_user)
    return current_user


@router.put("/me/currency", response_model=UserResponse)
def update_currency(
    payload: UpdateCurrencyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.base_currency = payload.base_currency
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
def setup_2fa(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Generates and stores a new TOTP secret, but leaves totp_enabled=False — the
    account isn't actually gated by 2FA until the user proves they captured the
    secret correctly via /auth/2fa/enable."""
    secret = auth_service.generate_totp_secret()
    current_user.totp_secret = secret
    db.commit()
    uri = auth_service.totp_uri(secret, current_user.email)
    return TwoFactorSetupResponse(secret=secret, qr_code_data_uri=auth_service.totp_qr_data_uri(uri))


@router.post("/2fa/enable", status_code=status.HTTP_204_NO_CONTENT)
def enable_2fa(
    payload: TwoFactorEnableRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if not current_user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=localize("Önce /auth/2fa/setup ile bir gizli anahtar üret", lang)
        )
    if not auth_service.verify_totp(current_user.totp_secret, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=localize("Doğrulama kodu yanlış", lang))
    current_user.totp_enabled = True
    db.commit()
    audit_service.log_action(db, current_user.id, "2fa.enable")


@router.post("/2fa/disable", status_code=status.HTTP_204_NO_CONTENT)
def disable_2fa(
    payload: TwoFactorDisableRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if not auth_service.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=localize("Şifre yanlış", lang))
    if not current_user.totp_secret or not auth_service.verify_totp(current_user.totp_secret, payload.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=localize("Doğrulama kodu yanlış", lang))
    current_user.totp_enabled = False
    current_user.totp_secret = None
    db.commit()
    audit_service.log_action(db, current_user.id, "2fa.disable")


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    db: Session = Depends(get_db), current: tuple[User, UserSession] = Depends(get_current_user_and_session)
):
    current_user, current_session = current
    rows = (
        db.query(UserSession)
        .filter(UserSession.user_id == current_user.id, UserSession.revoked_at.is_(None))
        .order_by(UserSession.last_seen_at.desc())
        .all()
    )
    return [
        SessionResponse(
            id=s.id,
            user_agent=s.user_agent,
            ip_address=s.ip_address,
            created_at=s.created_at,
            last_seen_at=s.last_seen_at,
            is_current=s.id == current_session.id,
        )
        for s in rows
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: int,
    db: Session = Depends(get_db),
    current: tuple[User, UserSession] = Depends(get_current_user_and_session),
):
    current_user, _ = current
    session = (
        db.query(UserSession)
        .filter(UserSession.id == session_id, UserSession.user_id == current_user.id)
        .first()
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    session.revoked_at = datetime.now(timezone.utc)
    db.commit()
    audit_service.log_action(db, current_user.id, "session.revoke", str(session_id))


@router.post("/sessions/revoke-all-others", status_code=status.HTTP_204_NO_CONTENT)
def revoke_all_other_sessions(
    db: Session = Depends(get_db), current: tuple[User, UserSession] = Depends(get_current_user_and_session)
):
    current_user, current_session = current
    db.query(UserSession).filter(
        UserSession.user_id == current_user.id,
        UserSession.id != current_session.id,
        UserSession.revoked_at.is_(None),
    ).update({"revoked_at": datetime.now(timezone.utc)})
    db.commit()
    audit_service.log_action(db, current_user.id, "session.revoke_all_others")


@router.get("/activity", response_model=list[AuditLogResponse])
def get_activity(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return audit_service.list_recent_actions(db, current_user.id)


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.email != settings.admin_email:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return current_user


@router.get("/admin/users", response_model=list[AdminUserResponse])
def list_all_users(db: Session = Depends(get_db), _admin: User = Depends(_require_admin)):
    last_seen_subq = (
        db.query(UserSession.user_id, func.max(UserSession.last_seen_at).label("last_seen_at"))
        .filter(UserSession.revoked_at.is_(None))
        .group_by(UserSession.user_id)
        .subquery()
    )
    rows = (
        db.query(User, last_seen_subq.c.last_seen_at)
        .outerjoin(last_seen_subq, User.id == last_seen_subq.c.user_id)
        .order_by(User.created_at.desc())
        .all()
    )
    return [
        AdminUserResponse(id=u.id, email=u.email, created_at=u.created_at, last_seen_at=last_seen)
        for u, last_seen in rows
    ]
