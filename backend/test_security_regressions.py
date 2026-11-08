from unittest.mock import AsyncMock, patch

import pytest
import pyotp
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import PushSubscription
from routers import auth, ws
from services import auth_service, push_service, ws_manager


@pytest.fixture
def session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine)
    engine.dispose()


def test_active_2fa_cannot_be_overwritten(session_factory):
    with session_factory() as db:
        user = auth_service.create_user(db, "security@example.com", "Password123")
        setup = auth.setup_2fa(db, user)
        auth.enable_2fa(auth.TwoFactorEnableRequest(code=pyotp.TOTP(setup.secret).now()), db, user, "en")
        with pytest.raises(HTTPException) as failure:
            auth.setup_2fa(db, user)
        assert failure.value.status_code == 409
        db.refresh(user)
        assert user.totp_secret == setup.secret
        assert user.totp_enabled


def test_email_change_invalidates_previous_verification(session_factory):
    with session_factory() as db:
        user = auth_service.create_user(db, "original@example.com", "Password123")
        token = auth_service.issue_email_verification_token(user)
        auth_service.update_email(db, user, "changed@example.com", "Password123")
        with pytest.raises(HTTPException):
            auth.verify_email(auth.VerifyEmailRequest(token=token), db)
        assert not user.email_verified
        auth.verify_email(auth.VerifyEmailRequest(token=auth_service.issue_email_verification_token(user)), db)
        assert user.email_verified


@pytest.mark.parametrize("endpoint", [
    "http://fcm.googleapis.com/test", "https://127.0.0.1/test",
    "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.example/test",
    "https://fcm.googleapis.com@localhost/test", "https://fcm.googleapis.com:8443/test",
    "https://fcm.googleapis.com\\@127.0.0.1/test", "https://evil.example/test",
])
def test_push_rejects_untrusted_destinations(endpoint):
    with pytest.raises(ValueError):
        push_service.validate_endpoint(endpoint)


def test_existing_unsafe_push_subscription_never_sends(session_factory):
    with session_factory() as db:
        subscription = PushSubscription(user_id=1, endpoint="https://127.0.0.1/test", p256dh="k", auth="a")
        with patch.object(push_service, "webpush") as send:
            assert not push_service._send_to_subscription(db, subscription, {})
        send.assert_not_called()


def test_push_transport_disables_redirects():
    with push_service._PushSession() as session, patch("requests.Session.request") as request:
        session.post("https://fcm.googleapis.com/test", allow_redirects=True)
        assert request.call_args.kwargs["allow_redirects"] is False


def test_push_endpoint_cannot_be_reassigned(session_factory):
    with session_factory() as db:
        first = auth_service.create_user(db, "first@example.com", "Password123")
        second = auth_service.create_user(db, "second@example.com", "Password123")
        endpoint = "https://fcm.googleapis.com/test"
        push_service.upsert_subscription(db, first.id, endpoint, "k", "a")
        with pytest.raises(ValueError):
            push_service.upsert_subscription(db, second.id, endpoint, "new", "new")
        assert db.query(PushSubscription).one().user_id == first.id


@pytest.mark.asyncio
@pytest.mark.parametrize("revoke", ["reset", "change", "session"])
async def test_revoked_websocket_stops_private_delivery(session_factory, revoke):
    with session_factory() as db, patch.object(ws, "SessionLocal", session_factory):
        user = auth_service.create_user(db, "ws@example.com", "Password123")
        token = auth_service.issue_token_for_user(db, user)
        user_id = user.id

        async def authorize():
            return ws._resolve_user_id(token) == user_id

        socket = AsyncMock()
        manager = ws_manager.ConnectionManager()
        with patch.object(ws_manager.redis_client, "get_client", return_value=None):
            await manager.connect(socket, user_id, authorize=authorize)
            await manager.subscribe(socket, ["alerts"])
            await manager.send_to_user(user_id, "alerts", {"before": True})
            socket.send_json.assert_awaited_once()
            socket.send_json.reset_mock()
            if revoke == "reset":
                auth_service.reset_password(db, user, "Changed123")
            elif revoke == "change":
                auth_service.update_password(db, user, "Password123", "Changed123")
            else:
                _, jti = auth_service.decode_access_token(token)
                from datetime import datetime, timezone
                auth_service.get_active_session(db, jti).revoked_at = datetime.now(timezone.utc)
                db.commit()
            await manager.send_to_user(user_id, "alerts", {"after": True})
        socket.send_json.assert_not_awaited()
        socket.close.assert_awaited_once_with(code=1008)
        assert manager.connection_count == 0
