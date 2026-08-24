import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from routers import auth as auth_router
from services import auth_service


class _FakeClient:
    def __init__(self, host):
        self.host = host


class FakeRequest:
    def __init__(self, ip="127.0.0.1", user_agent="pytest-agent"):
        self.headers = {"user-agent": user_agent}
        self.client = _FakeClient(ip)


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
    token_response = auth_router.register(payload, FakeRequest(), db_session)
    return token_response.access_token


def _current(db_session, token):
    return auth_router.get_current_user_and_session(token, db_session)


def test_register_creates_exactly_one_session(db_session):
    token = _register(db_session)
    user, session = _current(db_session, token)

    sessions = auth_router.list_sessions(db_session, (user, session))
    assert len(sessions) == 1
    assert sessions[0].is_current is True
    assert sessions[0].user_agent == "pytest-agent"
    assert sessions[0].ip_address == "127.0.0.1"


def test_logging_in_from_a_second_device_creates_a_second_session(db_session):
    token1 = _register(db_session)
    user1, session1 = _current(db_session, token1)

    login_payload = auth_router.LoginRequest(email="user@example.com", password="Password1")
    login_response = auth_router.login(login_payload, FakeRequest(ip="9.9.9.9", user_agent="second-device"), db_session)
    token2 = login_response.access_token
    user2, session2 = _current(db_session, token2)

    assert user1.id == user2.id
    sessions = auth_router.list_sessions(db_session, (user1, session1))
    assert len(sessions) == 2
    ips = {s.ip_address for s in sessions}
    assert ips == {"127.0.0.1", "9.9.9.9"}
    # each listing call marks is_current relative to whichever session made the call
    current_flags = {s.id: s.is_current for s in sessions}
    assert current_flags[session1.id] is True
    assert current_flags[session2.id] is False


def test_revoking_a_session_blocks_further_use_of_its_token(db_session):
    token = _register(db_session)
    user, session = _current(db_session, token)

    auth_router.revoke_session(session.id, db_session, (user, session))

    with pytest.raises(Exception):
        _current(db_session, token)


def test_cannot_revoke_another_users_session(db_session):
    token_a = _register(db_session, "a@example.com")
    user_a, session_a = _current(db_session, token_a)
    token_b = _register(db_session, "b@example.com")
    user_b, session_b = _current(db_session, token_b)

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        auth_router.revoke_session(session_b.id, db_session, (user_a, session_a))
    assert exc_info.value.status_code == 404

    # session_b is untouched
    assert auth_service.get_active_session(db_session, session_b.jti) is not None


def test_revoke_all_others_keeps_current_session_alive(db_session):
    token1 = _register(db_session)
    user, session1 = _current(db_session, token1)

    login_payload = auth_router.LoginRequest(email="user@example.com", password="Password1")
    token2 = auth_router.login(login_payload, FakeRequest(ip="2.2.2.2"), db_session).access_token
    token3 = auth_router.login(login_payload, FakeRequest(ip="3.3.3.3"), db_session).access_token
    _, session2 = _current(db_session, token2)
    _, session3 = _current(db_session, token3)

    auth_router.revoke_all_other_sessions(db_session, (user, session1))

    # current session (session1) still active
    assert auth_service.get_active_session(db_session, session1.jti) is not None
    # the other two are revoked
    assert auth_service.get_active_session(db_session, session2.jti) is None
    assert auth_service.get_active_session(db_session, session3.jti) is None
