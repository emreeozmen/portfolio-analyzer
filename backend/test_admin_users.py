import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from config import settings
from database import Base
from models import User, UserSession
from routers.auth import _require_admin, list_all_users


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    admin = User(email=settings.admin_email, hashed_password="x")
    other = User(email="someone-else@example.com", hashed_password="x")
    session.add_all([admin, other])
    session.commit()
    session.add(
        UserSession(user_id=other.id, jti="jti-1", user_agent="ua", ip_address="127.0.0.1")
    )
    session.commit()
    yield session, admin, other
    session.close()


def test_require_admin_allows_the_configured_admin_email(db_session):
    _session, admin, _other = db_session
    assert _require_admin(admin) is admin


def test_require_admin_rejects_everyone_else(db_session):
    _session, _admin, other = db_session
    with pytest.raises(HTTPException) as exc_info:
        _require_admin(other)
    assert exc_info.value.status_code == 403


def test_list_all_users_includes_last_seen_from_sessions(db_session):
    session, admin, other = db_session

    rows = list_all_users(session, admin)

    by_email = {r.email: r for r in rows}
    assert set(by_email) == {admin.email, other.email}
    assert by_email[other.email].last_seen_at is not None
    assert by_email[admin.email].last_seen_at is None
