import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from services import audit_service, auth_service


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_log_action_is_listed_for_the_right_user(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")
    other = auth_service.create_user(db_session, "other@example.com", "Password1")

    audit_service.log_action(db_session, user.id, "password.change")
    audit_service.log_action(db_session, other.id, "password.change")

    rows = audit_service.list_recent_actions(db_session, user.id)
    assert len(rows) == 1
    assert rows[0].action == "password.change"


def test_log_action_stores_optional_detail(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")

    audit_service.log_action(db_session, user.id, "email.change", "new@example.com")

    rows = audit_service.list_recent_actions(db_session, user.id)
    assert rows[0].detail == "new@example.com"


def test_list_recent_actions_orders_newest_first(db_session):
    user = auth_service.create_user(db_session, "user@example.com", "Password1")

    audit_service.log_action(db_session, user.id, "first")
    audit_service.log_action(db_session, user.id, "second")
    audit_service.log_action(db_session, user.id, "third")

    rows = audit_service.list_recent_actions(db_session, user.id)
    assert [r.action for r in rows] == ["third", "second", "first"]


def test_list_recent_actions_empty_for_unknown_user(db_session):
    assert audit_service.list_recent_actions(db_session, 999) == []
