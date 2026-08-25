import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Portfolio
from routers.holdings import _verify_portfolio_ownership


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add(Portfolio(id=1, user_id=1, name="Owner's portfolio"))
    session.add(Portfolio(id=2, user_id=2, name="Someone else's portfolio"))
    session.commit()
    yield session
    session.close()


def test_none_portfolio_id_is_always_allowed(db_session):
    _verify_portfolio_ownership(db_session, user_id=1, portfolio_id=None)


def test_own_portfolio_id_is_allowed(db_session):
    _verify_portfolio_ownership(db_session, user_id=1, portfolio_id=1)


def test_another_users_portfolio_id_is_rejected(db_session):
    with pytest.raises(HTTPException) as exc_info:
        _verify_portfolio_ownership(db_session, user_id=1, portfolio_id=2)
    assert exc_info.value.status_code == 404


def test_nonexistent_portfolio_id_is_rejected(db_session):
    with pytest.raises(HTTPException) as exc_info:
        _verify_portfolio_ownership(db_session, user_id=1, portfolio_id=999)
    assert exc_info.value.status_code == 404
