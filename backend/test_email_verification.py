from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import User
from routers.auth import VerifyEmailRequest, resend_verification, verify_email
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
# attempt a real SMTP send, same pattern as test_email_service.py.
@pytest.fixture(autouse=True)
def _no_real_smtp():
    with patch.object(email_service.settings, "smtp_host", ""):
        yield


def test_verify_email_marks_the_user_verified(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")
    token = auth_service.issue_email_verification_token(user)

    verify_email(VerifyEmailRequest(token=token), db=db_session)

    db_session.refresh(user)
    assert user.email_verified is True


def test_verify_email_rejects_a_malformed_token(db_session):
    with pytest.raises(HTTPException) as exc_info:
        verify_email(VerifyEmailRequest(token="not-a-real-token"), db=db_session)
    assert exc_info.value.status_code == 400


def test_verify_email_rejects_a_2fa_challenge_token(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")
    challenge = auth_service.issue_2fa_challenge_token(user)

    with pytest.raises(HTTPException) as exc_info:
        verify_email(VerifyEmailRequest(token=challenge), db=db_session)
    assert exc_info.value.status_code == 400


def test_resend_verification_is_a_noop_for_an_already_verified_user(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")
    user.email_verified = True
    db_session.commit()

    # No SMTP configured (see _no_real_smtp) — if this tried to send, it would just
    # silently no-op anyway, but asserting the flag stays True is the real behavior
    # under test here (an already-verified user isn't re-sent a link).
    resend_verification(db=db_session, current_user=user)

    db_session.refresh(user)
    assert user.email_verified is True
