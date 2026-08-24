from unittest.mock import MagicMock, patch

import pytest
import requests

from services import worldbank_service


@pytest.fixture(autouse=True)
def _clear_worldbank_cache():
    worldbank_service._cache = {}
    yield
    worldbank_service._cache = {}


COUNTRIES_PAYLOAD = [
    {"page": 1, "pages": 1, "per_page": 400, "total": 3},
    [
        {"id": "TUR", "region": {"value": "Europe & Central Asia"}},
        {"id": "USA", "region": {"value": "North America"}},
        {"id": "WLD", "region": {"value": "Aggregates"}},  # "World" — not a real country
    ],
]


def _indicator_payload(rows):
    return [{"page": 1, "pages": 1, "per_page": 400, "total": len(rows)}, rows]


def _mock_get_for(indicator_rows):
    """requests.get is called twice by _fetch_indicator: once for the country
    list, once for the indicator data — dispatch on the URL to return the
    right canned payload for each."""

    def _get(url, **kwargs):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        if url == worldbank_service._COUNTRIES_URL:
            resp.json.return_value = COUNTRIES_PAYLOAD
        else:
            resp.json.return_value = _indicator_payload(indicator_rows)
        return resp

    return _get


@pytest.mark.parametrize(
    "getter",
    [
        worldbank_service.get_inflation_by_country,
        worldbank_service.get_gdp_growth_by_country,
        worldbank_service.get_unemployment_by_country,
    ],
)
def test_filters_out_aggregate_regions(getter):
    rows = [
        {"countryiso3code": "TUR", "value": 34.9, "date": "2025", "country": {"value": "Turkiye"}},
        {"countryiso3code": "WLD", "value": 5.0, "date": "2025", "country": {"value": "World"}},
    ]
    with patch.object(worldbank_service.requests, "get", side_effect=_mock_get_for(rows)):
        results = getter()

    codes = {r.country_code for r in results}
    assert codes == {"TUR"}


def test_skips_rows_missing_value_or_name():
    rows = [
        {"countryiso3code": "TUR", "value": None, "date": "2025", "country": {"value": "Turkiye"}},
        {"countryiso3code": "USA", "value": 2.5, "date": "2025", "country": None},
        {"countryiso3code": "USA", "value": 2.5, "date": "2025", "country": {"value": "United States"}},
    ]
    with patch.object(worldbank_service.requests, "get", side_effect=_mock_get_for(rows)):
        results = worldbank_service.get_inflation_by_country()

    assert len(results) == 1
    assert results[0].country_code == "USA"
    assert results[0].value == 2.5
    assert results[0].year == 2025


def test_caches_between_calls():
    rows = [{"countryiso3code": "TUR", "value": 34.9, "date": "2025", "country": {"value": "Turkiye"}}]
    mock_get = _mock_get_for(rows)

    with patch.object(worldbank_service.requests, "get", side_effect=mock_get) as mocked:
        worldbank_service.get_inflation_by_country()
        worldbank_service.get_inflation_by_country()

    # 2 requests.get calls per _fetch_indicator() (countries + indicator); a cache
    # hit on the second get_inflation_by_country() call must not trigger 2 more.
    assert mocked.call_count == 2


def test_indicators_are_cached_independently():
    """Fetching GDP growth must not be served from (or pollute) inflation's cache
    entry — each indicator key gets its own cache slot."""
    rows = [{"countryiso3code": "TUR", "value": 34.9, "date": "2025", "country": {"value": "Turkiye"}}]
    mock_get = _mock_get_for(rows)

    with patch.object(worldbank_service.requests, "get", side_effect=mock_get) as mocked:
        worldbank_service.get_inflation_by_country()
        worldbank_service.get_gdp_growth_by_country()
        worldbank_service.get_unemployment_by_country()

    # Each of the 3 indicators is a fresh cache miss -> 2 requests.get calls each.
    assert mocked.call_count == 6


def test_serves_stale_cache_on_transient_failure():
    rows = [{"countryiso3code": "TUR", "value": 34.9, "date": "2025", "country": {"value": "Turkiye"}}]

    with patch.object(worldbank_service.requests, "get", side_effect=_mock_get_for(rows)):
        first = worldbank_service.get_inflation_by_country()

    worldbank_service._cache["inflation"] = (0.0, first)  # force the cache to look expired

    with patch.object(worldbank_service.requests, "get", side_effect=requests.RequestException("down")):
        second = worldbank_service.get_inflation_by_country()

    assert second == first


def test_raises_when_no_cache_and_request_fails():
    with patch.object(worldbank_service.requests, "get", side_effect=requests.RequestException("down")):
        with pytest.raises(ValueError):
            worldbank_service.get_inflation_by_country()
