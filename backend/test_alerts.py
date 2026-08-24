from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import Asset, PriceHistory
from services import alert_service

# A real MACD(12,26,9) bullish crossover, found empirically from a synthetic
# sine-wave-plus-noise price series (see PR discussion) so the fixture reflects an
# actual crossover rather than a hand-guessed one. The crossover happens exactly at
# the last price in this list.
MACD_BULL_CROSS_PRICES = [
    100.0004, 102.1772, 104.0523, 105.8339, 107.8124, 109.3443, 111.1652, 112.8376, 113.3342, 114.0797,
    114.9191, 115.0979, 114.9495, 114.2753, 113.899, 113.199, 111.4169, 110.2826, 108.2464, 106.6552,
    104.5778, 103.0481, 100.6661, 99.035, 96.9283, 94.8136, 92.2029, 91.0216, 89.5656, 88.2138,
    86.5506, 85.9489, 85.152, 84.8395, 85.3274, 84.9856, 85.7244, 86.7834,
]

# Same series, extended to its first bearish crossover (also at the last price).
MACD_BEAR_CROSS_PRICES = MACD_BULL_CROSS_PRICES + [
    87.3894, 88.8193, 90.3913, 92.0703, 93.5314, 95.8883, 98.3201, 99.5359, 102.3454, 104.1704,
    105.9086, 108.5489, 109.8705, 110.7874, 112.4579, 113.6549, 114.2092, 114.977, 114.9709, 115.118,
    114.986, 113.7051, 113.0513, 111.6812, 110.4581,
]


def _seed_price_series(session, ticker: str, closes: list[float], volumes: list[float] | None = None) -> Asset:
    asset = Asset(ticker=ticker, name=ticker, yahoo_symbol=f"{ticker}.IS", currency="TRY")
    session.add(asset)
    session.commit()
    base = date(2026, 1, 1)
    for i, close in enumerate(closes):
        volume = volumes[i] if volumes else 1000
        session.add(
            PriceHistory(
                asset_id=asset.id,
                date=base + timedelta(days=i),
                open_price=close,
                high_price=close,
                low_price=close,
                close_price=close,
                volume=volume,
            )
        )
    session.commit()
    return asset

USER_ID = 1


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    asset = Asset(ticker="THYAO", name="Türk Hava Yolları", yahoo_symbol="THYAO.IS", currency="TRY")
    session.add(asset)
    session.commit()
    # A steadily rising 20-day close series: RSI(14) on this ends up pinned near 100
    # (all gains, no losses), and the last close is 119 -- useful for both price and
    # RSI condition checks below.
    session.add_all(
        [
            PriceHistory(
                asset_id=asset.id,
                date=date(2026, 1, i + 1),
                open_price=100 + i,
                high_price=101 + i,
                low_price=99 + i,
                close_price=100 + i,
                volume=1000,
            )
            for i in range(20)
        ]
    )
    session.commit()
    session.asset_id = asset.id  # stash for convenience
    yield session
    session.close()


def test_create_alert_rejects_invalid_condition(db_session):
    with pytest.raises(ValueError):
        alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "not_a_condition", 100)


def test_create_alert_rejects_nonpositive_threshold(db_session):
    with pytest.raises(ValueError):
        alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 0)


def test_create_alert_allows_zero_threshold_for_macd_cross_conditions(db_session):
    # MACD crossover conditions have no meaningful numeric threshold — the frontend
    # sends 0 for them, and create_alert must not reject that the way it would for
    # price/RSI/volume conditions.
    alert = alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "macd_bull_cross", 0)
    assert alert.condition == "macd_bull_cross"


def test_list_alerts_includes_ticker(db_session):
    alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 200)
    alerts = alert_service.list_alerts(db_session, USER_ID)
    assert len(alerts) == 1
    assert alerts[0]["ticker"] == "THYAO"
    assert alerts[0]["is_triggered"] is False


def test_delete_alert_removes_it(db_session):
    alert = alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 200)
    assert alert_service.delete_alert(db_session, USER_ID, alert.id) is True
    assert alert_service.list_alerts(db_session, USER_ID) == []


def test_delete_alert_wrong_user_returns_false(db_session):
    alert = alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 200)
    assert alert_service.delete_alert(db_session, 999, alert.id) is False


def test_check_alerts_triggers_price_above(db_session):
    alert = alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 110)

    triggered = alert_service.check_alerts_for_asset(db_session, db_session.asset_id)

    assert len(triggered) == 1
    assert triggered[0].id == alert.id
    refreshed = alert_service.get_alert(db_session, USER_ID, alert.id)
    assert refreshed.is_triggered is True
    assert refreshed.is_active is False
    assert refreshed.triggered_at is not None


def test_check_alerts_does_not_trigger_when_condition_not_met(db_session):
    alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 500)

    triggered = alert_service.check_alerts_for_asset(db_session, db_session.asset_id)

    assert triggered == []
    alerts = alert_service.list_alerts(db_session, USER_ID)
    assert alerts[0]["is_triggered"] is False
    assert alerts[0]["is_active"] is True


def test_check_alerts_triggers_rsi_above_on_all_gains_series(db_session):
    # The fixture's price series is strictly increasing, so RSI(14) pins near 100.
    alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "rsi_above", 90)

    triggered = alert_service.check_alerts_for_asset(db_session, db_session.asset_id)

    assert len(triggered) == 1


def test_check_alerts_is_one_shot_and_does_not_refire(db_session):
    alert = alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 110)
    alert_service.check_alerts_for_asset(db_session, db_session.asset_id)

    # Second check should find no active alerts left to evaluate for this asset
    triggered_again = alert_service.check_alerts_for_asset(db_session, db_session.asset_id)
    assert triggered_again == []
    assert alert_service.get_alert(db_session, USER_ID, alert.id).is_triggered is True


def test_check_alerts_triggers_macd_bull_cross(db_session):
    asset = _seed_price_series(db_session, "BULLX", MACD_BULL_CROSS_PRICES)
    alert = alert_service.create_alert(db_session, USER_ID, asset.id, "macd_bull_cross", 0)

    triggered = alert_service.check_alerts_for_asset(db_session, asset.id)

    assert len(triggered) == 1
    assert triggered[0].id == alert.id


def test_check_alerts_does_not_trigger_macd_bear_cross_on_bullish_series(db_session):
    asset = _seed_price_series(db_session, "BULLY", MACD_BULL_CROSS_PRICES)
    alert_service.create_alert(db_session, USER_ID, asset.id, "macd_bear_cross", 0)

    triggered = alert_service.check_alerts_for_asset(db_session, asset.id)

    assert triggered == []


def test_check_alerts_triggers_macd_bear_cross(db_session):
    asset = _seed_price_series(db_session, "BEARX", MACD_BEAR_CROSS_PRICES)
    alert = alert_service.create_alert(db_session, USER_ID, asset.id, "macd_bear_cross", 0)

    triggered = alert_service.check_alerts_for_asset(db_session, asset.id)

    assert len(triggered) == 1
    assert triggered[0].id == alert.id


def test_check_alerts_triggers_volume_spike(db_session):
    volumes = [1000.0] * 20 + [3000.0]  # today's volume is 3x the prior 20-day average
    asset = _seed_price_series(db_session, "VOLX", [100.0] * 21, volumes)
    alert = alert_service.create_alert(db_session, USER_ID, asset.id, "volume_spike", 2.0)

    triggered = alert_service.check_alerts_for_asset(db_session, asset.id)

    assert len(triggered) == 1
    assert triggered[0].id == alert.id


def test_check_alerts_volume_spike_not_triggered_below_multiplier(db_session):
    volumes = [1000.0] * 20 + [1500.0]  # only 1.5x average, threshold is 2x
    asset = _seed_price_series(db_session, "VOLY", [100.0] * 21, volumes)
    alert_service.create_alert(db_session, USER_ID, asset.id, "volume_spike", 2.0)

    triggered = alert_service.check_alerts_for_asset(db_session, asset.id)

    assert triggered == []


def test_check_alerts_volume_spike_skipped_with_insufficient_history(db_session):
    volumes = [1000.0] * 5 + [5000.0]  # not enough days for a 20-day average yet
    asset = _seed_price_series(db_session, "VOLZ", [100.0] * 6, volumes)
    alert_service.create_alert(db_session, USER_ID, asset.id, "volume_spike", 2.0)

    triggered = alert_service.check_alerts_for_asset(db_session, asset.id)

    assert triggered == []


def test_mark_read_and_mark_all_read(db_session):
    alert = alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 110)
    alert_service.check_alerts_for_asset(db_session, db_session.asset_id)

    assert alert_service.mark_read(db_session, USER_ID, alert.id) is True
    assert alert_service.get_alert(db_session, USER_ID, alert.id).is_read is True

    alert2 = alert_service.create_alert(db_session, USER_ID, db_session.asset_id, "price_above", 111)
    alert_service.check_alerts_for_asset(db_session, db_session.asset_id)
    alert_service.mark_all_read(db_session, USER_ID)
    assert alert_service.get_alert(db_session, USER_ID, alert2.id).is_read is True
