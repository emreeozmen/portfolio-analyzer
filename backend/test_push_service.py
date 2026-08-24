from unittest.mock import MagicMock, patch

import pytest
from pywebpush import WebPushException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import PushSubscription, User
from services import push_service

USER_ID = 1


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add(User(id=USER_ID, email="user@example.com", hashed_password="x"))
    session.commit()
    yield session
    session.close()


def test_is_configured_false_by_default():
    with patch.object(push_service.settings, "vapid_public_key", ""), patch.object(
        push_service.settings, "vapid_private_key", ""
    ):
        assert push_service.is_configured() is False


def test_is_configured_true_when_both_keys_set():
    with patch.object(push_service.settings, "vapid_public_key", "pub"), patch.object(
        push_service.settings, "vapid_private_key", "priv"
    ):
        assert push_service.is_configured() is True


def test_upsert_subscription_creates_row(db_session):
    sub = push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "p256dh-key", "auth-key")
    assert sub.id is not None
    assert db_session.query(PushSubscription).count() == 1


def test_upsert_subscription_same_endpoint_updates_instead_of_duplicating(db_session):
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "old-key", "old-auth")
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "new-key", "new-auth")

    assert db_session.query(PushSubscription).count() == 1
    row = db_session.query(PushSubscription).one()
    assert row.p256dh == "new-key"


def test_remove_subscription_deletes_matching_row(db_session):
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "k", "a")
    assert push_service.remove_subscription(db_session, USER_ID, "https://push.example/1") is True
    assert db_session.query(PushSubscription).count() == 0


def test_remove_subscription_wrong_user_returns_false(db_session):
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "k", "a")
    assert push_service.remove_subscription(db_session, 999, "https://push.example/1") is False
    assert db_session.query(PushSubscription).count() == 1


def test_send_alert_push_returns_zero_when_not_configured(db_session):
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "k", "a")
    with patch.object(push_service.settings, "vapid_public_key", ""), patch.object(
        push_service.settings, "vapid_private_key", ""
    ):
        sent = push_service.send_alert_push(db_session, USER_ID, "THYAO", "price_above", 250.0)
    assert sent == 0


def test_send_alert_push_calls_webpush_per_subscription(db_session):
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "k1", "a1")
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/2", "k2", "a2")

    with (
        patch.object(push_service.settings, "vapid_public_key", "pub"),
        patch.object(push_service.settings, "vapid_private_key", "priv"),
        patch.object(push_service, "webpush", return_value=None) as mock_webpush,
    ):
        sent = push_service.send_alert_push(db_session, USER_ID, "THYAO", "price_above", 250.0)

    assert sent == 2
    assert mock_webpush.call_count == 2


def test_send_alert_push_removes_subscription_on_410_gone(db_session):
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "k", "a")
    gone_response = MagicMock(status_code=410)

    with (
        patch.object(push_service.settings, "vapid_public_key", "pub"),
        patch.object(push_service.settings, "vapid_private_key", "priv"),
        patch.object(push_service, "webpush", side_effect=WebPushException("gone", response=gone_response)),
    ):
        sent = push_service.send_alert_push(db_session, USER_ID, "THYAO", "price_above", 250.0)

    assert sent == 0
    assert db_session.query(PushSubscription).count() == 0


def test_send_alert_push_keeps_subscription_on_other_errors(db_session):
    push_service.upsert_subscription(db_session, USER_ID, "https://push.example/1", "k", "a")
    server_error_response = MagicMock(status_code=500)

    with (
        patch.object(push_service.settings, "vapid_public_key", "pub"),
        patch.object(push_service.settings, "vapid_private_key", "priv"),
        patch.object(push_service, "webpush", side_effect=WebPushException("boom", response=server_error_response)),
    ):
        sent = push_service.send_alert_push(db_session, USER_ID, "THYAO", "price_above", 250.0)

    assert sent == 0
    assert db_session.query(PushSubscription).count() == 1
