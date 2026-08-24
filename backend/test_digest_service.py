from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset, PriceHistory, User
from services import digest_service
from services.portfolio_builder_service import create_portfolio


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _add_asset_with_history(session, ticker: str, closes: list[float]) -> Asset:
    asset = Asset(ticker=ticker, name=ticker, yahoo_symbol=f"{ticker}.IS", currency="TRY")
    session.add(asset)
    session.commit()
    base = date(2026, 1, 1)
    for i, close in enumerate(closes):
        session.add(
            PriceHistory(
                asset_id=asset.id,
                date=base + timedelta(days=i),
                open_price=close,
                high_price=close,
                low_price=close,
                close_price=close,
                volume=1000,
            )
        )
    session.commit()
    return asset


def _add_user(session, email: str, digest_frequency: str = "off", last_digest_sent_at=None) -> User:
    user = User(
        email=email,
        hashed_password="x",
        digest_frequency=digest_frequency,
        last_digest_sent_at=last_digest_sent_at,
    )
    session.add(user)
    session.commit()
    return user


def test_build_digest_content_computes_period_return_and_movers(db_session):
    user = _add_user(db_session, "a@example.com")
    thyao = _add_asset_with_history(db_session, "THYAO", [100 + i for i in range(40)])  # steady uptrend
    asels = _add_asset_with_history(db_session, "ASELS", [200 - i * 0.5 for i in range(40)])  # steady downtrend
    create_portfolio(db_session, user_id=user.id, name="Ana Portföy", assets_input=[("THYAO", 50), ("ASELS", 50)])

    rows = digest_service.build_digest_content(db_session, user, "weekly")

    assert rows is not None
    assert len(rows) == 1
    row = rows[0]
    assert row["name"] == "Ana Portföy"
    assert row["best_ticker"] == thyao.ticker
    assert row["worst_ticker"] == asels.ticker
    assert row["best_return_percent"] > row["worst_return_percent"]


def test_build_digest_content_returns_none_when_no_portfolios(db_session):
    user = _add_user(db_session, "b@example.com")
    assert digest_service.build_digest_content(db_session, user, "weekly") is None


def test_build_digest_content_skips_portfolio_missing_price_data(db_session):
    user = _add_user(db_session, "c@example.com")
    from models import Asset as AssetModel

    priceless = AssetModel(ticker="NODATA", name="NODATA", yahoo_symbol="NODATA.IS", currency="TRY")
    db_session.add(priceless)
    db_session.commit()
    create_portfolio(db_session, user_id=user.id, name="Boş Veri", assets_input=[("NODATA", 100)])

    assert digest_service.build_digest_content(db_session, user, "weekly") is None


def test_users_due_for_digest_includes_never_sent_and_stale(db_session):
    never_sent = _add_user(db_session, "never@example.com", digest_frequency="weekly")
    stale = _add_user(
        db_session, "stale@example.com", digest_frequency="weekly",
        last_digest_sent_at=datetime.utcnow() - timedelta(days=10),
    )
    recent = _add_user(
        db_session, "recent@example.com", digest_frequency="weekly",
        last_digest_sent_at=datetime.utcnow() - timedelta(days=1),
    )
    _add_user(db_session, "off@example.com", digest_frequency="off")

    due_ids = {u.id for u in digest_service.users_due_for_digest(db_session, "weekly")}

    assert never_sent.id in due_ids
    assert stale.id in due_ids
    assert recent.id not in due_ids


def test_users_due_for_digest_filters_by_frequency(db_session):
    _add_user(db_session, "weekly@example.com", digest_frequency="weekly")
    monthly_user = _add_user(db_session, "monthly@example.com", digest_frequency="monthly")

    due = digest_service.users_due_for_digest(db_session, "monthly")

    assert [u.id for u in due] == [monthly_user.id]
