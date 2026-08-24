import pyotp
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from routers import auth as auth_router
from test_sessions import FakeRequest


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _register(db_session, email="user@example.com", password="Password1"):
    payload = auth_router.RegisterRequest(email=email, password=password)
    return auth_router.register(payload, FakeRequest(), db_session).access_token


def _current_user(db_session, token):
    user, _ = auth_router.get_current_user_and_session(token, db_session)
    return user


def test_login_without_2fa_returns_a_real_token_directly(db_session):
    _register(db_session)

    response = auth_router.login(
        auth_router.LoginRequest(email="user@example.com", password="Password1"), FakeRequest(), db_session
    )

    assert response.requires_2fa is False
    assert response.access_token is not None
    assert response.challenge_token is None


def test_full_2fa_setup_enable_and_login_flow(db_session):
    token = _register(db_session)
    user = _current_user(db_session, token)

    setup = auth_router.setup_2fa(db_session, user)
    assert setup.qr_code_data_uri.startswith("data:image/png;base64,")

    code = pyotp.TOTP(setup.secret).now()
    auth_router.enable_2fa(auth_router.TwoFactorEnableRequest(code=code), db_session, user, "tr")
    db_session.refresh(user)
    assert user.totp_enabled is True

    # subsequent logins now require the 2FA step
    login_response = auth_router.login(
        auth_router.LoginRequest(email="user@example.com", password="Password1"), FakeRequest(), db_session
    )
    assert login_response.requires_2fa is True
    assert login_response.access_token is None

    next_code = pyotp.TOTP(setup.secret).now()
    verify_response = auth_router.verify_2fa(
        auth_router.TwoFactorVerifyRequest(challenge_token=login_response.challenge_token, code=next_code),
        FakeRequest(),
        db_session,
    )
    assert verify_response.access_token is not None
    # the verified token is a real, usable session
    verified_user = _current_user(db_session, verify_response.access_token)
    assert verified_user.id == user.id


def test_enable_2fa_with_wrong_code_raises(db_session):
    token = _register(db_session)
    user = _current_user(db_session, token)
    auth_router.setup_2fa(db_session, user)

    with pytest.raises(HTTPException) as exc_info:
        auth_router.enable_2fa(auth_router.TwoFactorEnableRequest(code="000000"), db_session, user, "tr")
    assert exc_info.value.status_code == 400
    db_session.refresh(user)
    assert user.totp_enabled is False


def test_verify_2fa_with_wrong_code_raises_and_does_not_issue_a_token(db_session):
    token = _register(db_session)
    user = _current_user(db_session, token)
    setup = auth_router.setup_2fa(db_session, user)
    code = pyotp.TOTP(setup.secret).now()
    auth_router.enable_2fa(auth_router.TwoFactorEnableRequest(code=code), db_session, user, "tr")

    login_response = auth_router.login(
        auth_router.LoginRequest(email="user@example.com", password="Password1"), FakeRequest(), db_session
    )

    with pytest.raises(HTTPException) as exc_info:
        auth_router.verify_2fa(
            auth_router.TwoFactorVerifyRequest(challenge_token=login_response.challenge_token, code="000000"),
            FakeRequest(),
            db_session,
        )
    assert exc_info.value.status_code == 401


def test_disable_2fa_requires_correct_password_and_code(db_session):
    token = _register(db_session)
    user = _current_user(db_session, token)
    setup = auth_router.setup_2fa(db_session, user)
    code = pyotp.TOTP(setup.secret).now()
    auth_router.enable_2fa(auth_router.TwoFactorEnableRequest(code=code), db_session, user, "tr")

    wrong_password_code = pyotp.TOTP(setup.secret).now()
    with pytest.raises(HTTPException):
        auth_router.disable_2fa(
            auth_router.TwoFactorDisableRequest(password="WrongPass1", code=wrong_password_code),
            db_session,
            user,
            "tr",
        )
    db_session.refresh(user)
    assert user.totp_enabled is True

    right_code = pyotp.TOTP(setup.secret).now()
    auth_router.disable_2fa(
        auth_router.TwoFactorDisableRequest(password="Password1", code=right_code), db_session, user, "tr"
    )
    db_session.refresh(user)
    assert user.totp_enabled is False
    assert user.totp_secret is None


def test_2fa_challenge_token_cannot_be_reused_as_a_normal_access_token(db_session):
    token = _register(db_session)
    user = _current_user(db_session, token)
    setup = auth_router.setup_2fa(db_session, user)
    code = pyotp.TOTP(setup.secret).now()
    auth_router.enable_2fa(auth_router.TwoFactorEnableRequest(code=code), db_session, user, "tr")

    login_response = auth_router.login(
        auth_router.LoginRequest(email="user@example.com", password="Password1"), FakeRequest(), db_session
    )

    with pytest.raises(Exception):
        auth_router.get_current_user_and_session(login_response.challenge_token, db_session)
