import asyncio
import threading
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import main
from database import Base
from models import Asset, PriceAlert, User


@pytest.fixture
def background_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{(tmp_path / 'background.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(main, "SessionLocal", factory)
    yield factory, engine
    engine.dispose()


@pytest.mark.asyncio
async def test_failed_asset_does_not_poison_next_asset_or_block_event_loop(background_db):
    factory, engine = background_db
    with factory() as db:
        db.add_all([
            Asset(ticker="BAD", name="Bad", yahoo_symbol="BAD"),
            Asset(ticker="GOOD", name="Good", yahoo_symbol="GOOD"),
        ])
        db.commit()
    loop_thread = threading.get_ident()
    database_threads = []

    @event.listens_for(engine, "before_cursor_execute")
    def track_thread(*args):
        database_threads.append(threading.get_ident())

    refreshed = []

    def refresh(db, asset):
        if asset.ticker == "BAD":
            # Real SQLAlchemy failed transaction, including expired ORM objects.
            db.add(Asset(ticker="BAD", name="Duplicate", yahoo_symbol="BAD"))
            db.flush()
        asset.name = "Refreshed"
        db.commit()
        refreshed.append(asset.ticker)

    with (
        patch.object(main.asyncio, "sleep", new=AsyncMock(side_effect=[None, asyncio.CancelledError()])),
        patch.object(main.price_service, "refresh_price_history", side_effect=refresh),
        patch.object(main.alert_service, "check_alerts_for_asset", return_value=[]),
        patch.object(main.ws_manager.manager, "broadcast", new_callable=AsyncMock) as broadcast,
    ):
        with pytest.raises(asyncio.CancelledError):
            await main._auto_refresh_loop()
    assert refreshed == ["GOOD"]
    assert [call.args[0] for call in broadcast.call_args_list] == ["quotes", "prices-updated"]
    assert database_threads
    assert loop_thread not in database_threads


@pytest.mark.asyncio
async def test_digest_recovers_after_one_users_database_failure(background_db):
    factory, engine = background_db
    with factory() as db:
        db.add_all([
            User(email="bad@example.com", hashed_password="x", digest_frequency="weekly"),
            User(email="good@example.com", hashed_password="x", digest_frequency="weekly"),
        ])
        db.commit()
    attempted = []
    database_threads = []

    @event.listens_for(engine, "before_cursor_execute")
    def track_thread(*args):
        database_threads.append(threading.get_ident())

    def content(db, user, frequency):
        attempted.append(user.email)
        if user.email == "bad@example.com":
            db.add(User(email=user.email, hashed_password="duplicate"))
            db.flush()
        return [{"name": "Portfolio"}]

    with (
        patch.object(main.digest_service, "build_digest_content", side_effect=content),
        patch.object(main.email_service, "send_portfolio_digest_email", return_value=True) as send,
    ):
        await asyncio.to_thread(main._send_due_digests)
    assert attempted == ["bad@example.com", "good@example.com"]
    assert send.call_args.args[0] == "good@example.com"
    assert threading.get_ident() not in database_threads
    with factory() as db:
        assert db.query(User).filter_by(email="good@example.com").one().last_digest_sent_at is not None


@pytest.mark.asyncio
async def test_committed_alert_is_serialized_in_worker_even_when_email_fails(background_db):
    factory, engine = background_db
    with factory() as db:
        asset = Asset(ticker="TEST", name="Test", yahoo_symbol="TEST")
        user = User(email="alert@example.com", hashed_password="x")
        db.add_all([asset, user])
        db.commit()
        asset_id, user_id = asset.id, user.id
    database_threads = []

    @event.listens_for(engine, "before_cursor_execute")
    def track_thread(*args):
        database_threads.append(threading.get_ident())

    def trigger(db, asset_id):
        alert = PriceAlert(
            asset_id=asset_id, user_id=user_id, condition="price_above", threshold=10,
            is_triggered=True, is_active=False, triggered_at=datetime(2026, 1, 1),
        )
        db.add(alert)
        db.commit()
        return [alert]

    with (
        patch.object(main.price_service, "refresh_price_history", side_effect=lambda db, asset: db.commit()),
        patch.object(main.alert_service, "check_alerts_for_asset", side_effect=trigger),
        patch.object(main.email_service, "send_alert_triggered_email", side_effect=OSError("SMTP down")),
    ):
        notifications = await asyncio.to_thread(main._refresh_asset, asset_id)
    assert notifications[0]["user_id"] == user_id
    assert notifications[0]["payload"]["ticker"] == "TEST"
    assert notifications[0]["payload"]["triggered_at"] == "2026-01-01T00:00:00"
    assert threading.get_ident() not in database_threads
