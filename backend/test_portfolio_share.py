import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset
from services.portfolio_builder_service import (
    create_portfolio,
    generate_share_link,
    get_portfolio,
    get_portfolio_by_share_token,
    revoke_share_link,
)

USER_ID = 1
OTHER_USER_ID = 2


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add(Asset(ticker="THYAO", name="Türk Hava Yolları", yahoo_symbol="THYAO.IS"))
    session.commit()
    yield session
    session.close()


def test_generate_share_link_sets_a_token(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])

    token = generate_share_link(db_session, USER_ID, portfolio.id)

    assert token is not None
    assert len(token) > 20
    refreshed = get_portfolio(db_session, USER_ID, portfolio.id)
    assert refreshed.share_token == token


def test_generate_share_link_for_unowned_portfolio_returns_none(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])

    assert generate_share_link(db_session, OTHER_USER_ID, portfolio.id) is None


def test_get_portfolio_by_share_token_finds_it(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])
    token = generate_share_link(db_session, USER_ID, portfolio.id)

    found = get_portfolio_by_share_token(db_session, token)

    assert found is not None
    assert found.id == portfolio.id


def test_get_portfolio_by_share_token_unknown_token_returns_none(db_session):
    assert get_portfolio_by_share_token(db_session, "not-a-real-token") is None


def test_regenerating_share_link_invalidates_the_old_token(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])
    old_token = generate_share_link(db_session, USER_ID, portfolio.id)

    new_token = generate_share_link(db_session, USER_ID, portfolio.id)

    assert new_token != old_token
    assert get_portfolio_by_share_token(db_session, old_token) is None
    assert get_portfolio_by_share_token(db_session, new_token) is not None


def test_revoke_share_link_clears_the_token(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])
    token = generate_share_link(db_session, USER_ID, portfolio.id)

    assert revoke_share_link(db_session, USER_ID, portfolio.id) is True

    assert get_portfolio_by_share_token(db_session, token) is None
    refreshed = get_portfolio(db_session, USER_ID, portfolio.id)
    assert refreshed.share_token is None


def test_revoke_share_link_for_unowned_portfolio_returns_false(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])
    generate_share_link(db_session, USER_ID, portfolio.id)

    assert revoke_share_link(db_session, OTHER_USER_ID, portfolio.id) is False
