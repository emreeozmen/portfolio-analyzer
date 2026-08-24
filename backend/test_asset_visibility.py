import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset, User
from services import asset_service


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add_all(
        [
            Asset(ticker="THYAO", name="Türk Hava Yolları", yahoo_symbol="THYAO.IS", is_default=True),
            Asset(ticker="ASELS", name="Aselsan", yahoo_symbol="ASELS.IS", is_default=True),
            Asset(ticker="MSFT", name="Microsoft", yahoo_symbol="MSFT", is_default=False),
        ]
    )
    session.add_all(
        [
            User(email="alice@example.com", hashed_password="x"),
            User(email="bob@example.com", hashed_password="x"),
        ]
    )
    session.commit()
    yield session
    session.close()


def test_anonymous_sees_only_default_assets(db_session):
    visible = asset_service.list_visible_assets(db_session, None)
    tickers = {a.ticker for a in visible}
    assert tickers == {"THYAO", "ASELS"}


def test_user_who_tracked_asset_sees_it(db_session):
    alice = db_session.query(User).filter_by(email="alice@example.com").first()
    msft = db_session.query(Asset).filter_by(ticker="MSFT").first()

    asset_service.add_to_watchlist(db_session, alice.id, msft.id)

    visible = {a.ticker for a in asset_service.list_visible_assets(db_session, alice)}
    assert visible == {"THYAO", "ASELS", "MSFT"}


def test_other_user_does_not_see_it(db_session):
    alice = db_session.query(User).filter_by(email="alice@example.com").first()
    bob = db_session.query(User).filter_by(email="bob@example.com").first()
    msft = db_session.query(Asset).filter_by(ticker="MSFT").first()

    asset_service.add_to_watchlist(db_session, alice.id, msft.id)

    visible = {a.ticker for a in asset_service.list_visible_assets(db_session, bob)}
    assert visible == {"THYAO", "ASELS"}


def test_add_to_watchlist_is_idempotent(db_session):
    alice = db_session.query(User).filter_by(email="alice@example.com").first()
    msft = db_session.query(Asset).filter_by(ticker="MSFT").first()

    asset_service.add_to_watchlist(db_session, alice.id, msft.id)
    asset_service.add_to_watchlist(db_session, alice.id, msft.id)

    visible = [a.ticker for a in asset_service.list_visible_assets(db_session, alice) if a.ticker == "MSFT"]
    assert visible == ["MSFT"]


def test_list_assets_ignores_visibility(db_session):
    all_tickers = {a.ticker for a in asset_service.list_assets(db_session)}
    assert all_tickers == {"THYAO", "ASELS", "MSFT"}


def test_remove_from_watchlist_hides_it_again(db_session):
    alice = db_session.query(User).filter_by(email="alice@example.com").first()
    msft = db_session.query(Asset).filter_by(ticker="MSFT").first()
    asset_service.add_to_watchlist(db_session, alice.id, msft.id)

    removed = asset_service.remove_from_watchlist(db_session, alice.id, msft.id)

    assert removed is True
    visible = {a.ticker for a in asset_service.list_visible_assets(db_session, alice)}
    assert visible == {"THYAO", "ASELS"}


def test_remove_from_watchlist_returns_false_when_not_tracked(db_session):
    alice = db_session.query(User).filter_by(email="alice@example.com").first()
    msft = db_session.query(Asset).filter_by(ticker="MSFT").first()

    assert asset_service.remove_from_watchlist(db_session, alice.id, msft.id) is False


def test_remove_from_watchlist_only_affects_that_user(db_session):
    alice = db_session.query(User).filter_by(email="alice@example.com").first()
    bob = db_session.query(User).filter_by(email="bob@example.com").first()
    msft = db_session.query(Asset).filter_by(ticker="MSFT").first()
    asset_service.add_to_watchlist(db_session, alice.id, msft.id)
    asset_service.add_to_watchlist(db_session, bob.id, msft.id)

    asset_service.remove_from_watchlist(db_session, alice.id, msft.id)

    assert {a.ticker for a in asset_service.list_visible_assets(db_session, alice)} == {"THYAO", "ASELS"}
    assert {a.ticker for a in asset_service.list_visible_assets(db_session, bob)} == {"THYAO", "ASELS", "MSFT"}
