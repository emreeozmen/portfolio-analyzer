import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset
from services.portfolio_builder_service import validate_portfolio_input


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
        ]
    )
    session.commit()
    yield session
    session.close()


def test_valid_portfolio_passes(db_session):
    resolved = validate_portfolio_input(db_session, "Test", [("THYAO", 60), ("ASELS", 40)])
    assert len(resolved) == 2


def test_empty_name_rejected(db_session):
    with pytest.raises(ValueError):
        validate_portfolio_input(db_session, "  ", [("THYAO", 100)])


def test_empty_assets_rejected(db_session):
    with pytest.raises(ValueError):
        validate_portfolio_input(db_session, "Test", [])


def test_weights_not_summing_to_100_rejected(db_session):
    with pytest.raises(ValueError):
        validate_portfolio_input(db_session, "Test", [("THYAO", 50), ("ASELS", 30)])


def test_negative_weight_rejected(db_session):
    with pytest.raises(ValueError):
        validate_portfolio_input(db_session, "Test", [("THYAO", -10), ("ASELS", 110)])


def test_unknown_ticker_rejected(db_session):
    with pytest.raises(ValueError):
        validate_portfolio_input(db_session, "Test", [("THYAO", 50), ("FAKE", 50)])


def test_duplicate_ticker_rejected(db_session):
    with pytest.raises(ValueError):
        validate_portfolio_input(db_session, "Test", [("THYAO", 50), ("THYAO", 50)])
