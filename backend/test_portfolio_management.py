import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset
from services.portfolio_builder_service import create_portfolio, delete_portfolio, get_portfolio_assets, update_portfolio

USER_ID = 1


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add_all(
        [
            Asset(ticker="THYAO", name="Türk Hava Yolları", yahoo_symbol="THYAO.IS"),
            Asset(ticker="ASELS", name="Aselsan", yahoo_symbol="ASELS.IS"),
            Asset(ticker="GARAN", name="Garanti BBVA", yahoo_symbol="GARAN.IS"),
        ]
    )
    session.commit()
    yield session
    session.close()


def test_update_portfolio_replaces_assets(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])

    updated = update_portfolio(db_session, portfolio, name="Test v2", assets_input=[("ASELS", 60), ("GARAN", 40)])

    assert updated.name == "Test v2"
    tickers = {asset.ticker for _, asset in get_portfolio_assets(db_session, updated.id)}
    assert tickers == {"ASELS", "GARAN"}


def test_update_portfolio_invalid_weights_raises(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])

    with pytest.raises(ValueError):
        update_portfolio(db_session, portfolio, name="Test", assets_input=[("THYAO", 50)])


def test_delete_portfolio_removes_it(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])

    assert delete_portfolio(db_session, user_id=USER_ID, portfolio_id=portfolio.id) is True
    assert delete_portfolio(db_session, user_id=USER_ID, portfolio_id=portfolio.id) is False


def test_delete_portfolio_wrong_user_returns_false(db_session):
    portfolio = create_portfolio(db_session, user_id=USER_ID, name="Test", assets_input=[("THYAO", 100)])

    assert delete_portfolio(db_session, user_id=999, portfolio_id=portfolio.id) is False
