import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from services import auth_service


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_update_password_with_correct_current_password(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "OldPass123")

    auth_service.update_password(db_session, user, "OldPass123", "NewPass456")

    assert auth_service.authenticate_user(db_session, "user@example.com", "NewPass456") is not None
    assert auth_service.authenticate_user(db_session, "user@example.com", "OldPass123") is None


def test_update_password_with_wrong_current_password_raises(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "OldPass123")

    with pytest.raises(ValueError):
        auth_service.update_password(db_session, user, "WrongPass1", "NewPass456")

    # password unchanged
    assert auth_service.authenticate_user(db_session, "user@example.com", "OldPass123") is not None


def test_update_email_with_correct_password(db_session):
    user = auth_service.create_user(db_session, "old@example.com", "Password1")

    updated = auth_service.update_email(db_session, user, "new@example.com", "Password1")

    assert updated.email == "new@example.com"
    assert auth_service.get_user_by_email(db_session, "old@example.com") is None
    assert auth_service.get_user_by_email(db_session, "new@example.com") is not None


def test_update_email_with_wrong_password_raises(db_session):
    user = auth_service.create_user(db_session, "old@example.com", "Password1")

    with pytest.raises(ValueError):
        auth_service.update_email(db_session, user, "new@example.com", "WrongPass1")

    assert auth_service.get_user_by_email(db_session, "old@example.com") is not None


def test_update_email_to_existing_email_raises(db_session):
    auth_service.create_user(db_session, "taken@example.com", "Password1")
    user = auth_service.create_user(db_session, "user@example.com", "Password2")

    with pytest.raises(ValueError):
        auth_service.update_email(db_session, user, "taken@example.com", "Password2")


def test_update_email_to_same_email_is_allowed(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")

    updated = auth_service.update_email(db_session, user, "user@example.com", "Password1")

    assert updated.email == "user@example.com"


def test_issue_token_for_user_creates_a_revocable_session(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")

    token = auth_service.issue_token_for_user(db_session, user, user_agent="pytest", ip_address="127.0.0.1")
    user_id, jti = auth_service.decode_access_token(token)

    assert user_id == user.id
    session = auth_service.get_active_session(db_session, jti)
    assert session is not None
    assert session.user_agent == "pytest"
    assert session.ip_address == "127.0.0.1"


def test_revoked_session_is_no_longer_active(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")
    token = auth_service.issue_token_for_user(db_session, user)
    _, jti = auth_service.decode_access_token(token)
    session = auth_service.get_active_session(db_session, jti)

    from datetime import datetime, timezone

    session.revoked_at = datetime.now(timezone.utc)
    db_session.commit()

    assert auth_service.get_active_session(db_session, jti) is None


def test_decode_access_token_rejects_a_2fa_challenge_token(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")
    challenge = auth_service.issue_2fa_challenge_token(user)

    with pytest.raises(ValueError):
        auth_service.decode_access_token(challenge)


def test_decode_2fa_challenge_token_rejects_a_real_access_token(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")
    token = auth_service.issue_token_for_user(db_session, user)

    with pytest.raises(ValueError):
        auth_service.decode_2fa_challenge_token(token)


def test_totp_round_trip():
    secret = auth_service.generate_totp_secret()
    import pyotp

    code = pyotp.TOTP(secret).now()

    assert auth_service.verify_totp(secret, code) is True
    assert auth_service.verify_totp(secret, "000000") is False


def test_totp_uri_and_qr_data_uri():
    secret = auth_service.generate_totp_secret()
    uri = auth_service.totp_uri(secret, "user@example.com")

    assert uri.startswith("otpauth://totp/")
    assert "Portfolio%20Analyzer" in uri or "Portfolio+Analyzer" in uri or "Portfolio Analyzer" in uri

    data_uri = auth_service.totp_qr_data_uri(uri)
    assert data_uri.startswith("data:image/png;base64,")
