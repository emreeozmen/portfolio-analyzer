from unittest.mock import patch

import jwt
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import UserSession
from routers.auth import ForgotPasswordRequest, ResetPasswordRequest, forgot_password, reset_password
from services import auth_service, email_service


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


# email_service.is_configured() reads from the real backend/.env in this environment
# (which does have SMTP_HOST set for local dev) — patched off here so these tests never
# attempt a real SMTP send, same pattern as test_email_verification.py.
@pytest.fixture(autouse=True)
def _no_real_smtp():
    with patch.object(email_service.settings, "smtp_host", ""):
        yield


def test_forgot_password_is_silent_for_an_unknown_email(db_session):
    # No exception, no distinguishing response — see forgot_password's own docstring
    # on why this must never reveal whether the address is registered.
    forgot_password(ForgotPasswordRequest(email="nobody@example.com"), db=db_session)


def test_forgot_password_issues_a_working_reset_token_for_a_known_email(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "OldPassword1")

    with patch.object(email_service, "send_email", return_value=True) as mock_send:
        forgot_password(ForgotPasswordRequest(email="user@example.com"), db=db_session)

    assert mock_send.call_count == 1
    html_body = mock_send.call_args.args[3]
    assert "sifre-sifirla" in html_body

    # Extract the token from the emailed link and confirm it actually resets the password.
    token = html_body.split("token=")[1].split('"')[0]
    reset_password(ResetPasswordRequest(token=token, new_password="NewPassword1"), db=db_session, lang="tr")

    db_session.refresh(user)
    assert auth_service.verify_password("NewPassword1", user.hashed_password)
    assert not auth_service.verify_password("OldPassword1", user.hashed_password)


def test_reset_password_rejects_a_malformed_token(db_session):
    with pytest.raises(HTTPException) as exc_info:
        reset_password(ResetPasswordRequest(token="not-a-real-token", new_password="NewPassword1"), db=db_session, lang="tr")
    assert exc_info.value.status_code == 400


def test_reset_password_rejects_a_2fa_challenge_token(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "OldPassword1")
    challenge = auth_service.issue_2fa_challenge_token(user)

    with pytest.raises(HTTPException) as exc_info:
        reset_password(ResetPasswordRequest(token=challenge, new_password="NewPassword1"), db=db_session, lang="tr")
    assert exc_info.value.status_code == 400


def test_reset_password_token_cannot_be_replayed_after_use(db_session):
    """A reset link is only meant to work once — once the password has actually
    changed, the same token (still cryptographically valid and unexpired) must stop
    working, or a leaked/forwarded link would let anyone re-reset the password at any
    point up to its expiry, potentially long after the legitimate user already used it.
    """
    user = auth_service.create_user(db_session, "user@example.com", "OldPassword1")
    token = auth_service.issue_password_reset_token(user)

    reset_password(ResetPasswordRequest(token=token, new_password="NewPassword1"), db=db_session, lang="tr")

    with pytest.raises(HTTPException) as exc_info:
        reset_password(ResetPasswordRequest(token=token, new_password="AnotherPassword2"), db=db_session, lang="tr")
    assert exc_info.value.status_code == 400

    db_session.refresh(user)
    assert auth_service.verify_password("NewPassword1", user.hashed_password)


def test_reset_password_revokes_every_active_session(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "OldPassword1")
    token = auth_service.issue_password_reset_token(user)
    auth_service.issue_token_for_user(db_session, user, "some-agent", "1.2.3.4")
    auth_service.issue_token_for_user(db_session, user, "another-agent", "5.6.7.8")

    reset_password(ResetPasswordRequest(token=token, new_password="NewPassword1"), db=db_session, lang="tr")

    sessions = db_session.query(UserSession).filter(UserSession.user_id == user.id).all()
    assert len(sessions) == 2
    assert all(s.revoked_at is not None for s in sessions)


def test_reset_password_request_rejects_a_weak_new_password():
    with pytest.raises(Exception):
        ResetPasswordRequest(token="whatever", new_password="short")


def test_password_reset_token_expires(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "OldPassword1")
    with patch.object(auth_service, "PASSWORD_RESET_EXPIRE_MINUTES", -1):
        token = auth_service.issue_password_reset_token(user)

    with pytest.raises(jwt.ExpiredSignatureError):
        auth_service.decode_password_reset_token(token)
