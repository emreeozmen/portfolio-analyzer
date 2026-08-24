"""Real, published annual country-level economic indicators (inflation, GDP growth,
unemployment), via the World Bank's free, key-less Open Data API. None of these are
live/intraday figures anywhere — national statistics agencies publish them monthly or
annually with a lag — so "most recent value" here means the latest year the World Bank
has data for per country, not a live tick.
"""

import time
from dataclasses import dataclass

import requests

_COUNTRIES_URL = "https://api.worldbank.org/v2/country"
_INDICATOR_URL_TEMPLATE = "https://api.worldbank.org/v2/country/all/indicator/{code}"

# World Bank indicator codes for each metric this app surfaces.
_INDICATORS: dict[str, str] = {
    "inflation": "FP.CPI.TOTL.ZG",  # inflation, consumer prices (annual %)
    "gdp_growth": "NY.GDP.MKTP.KD.ZG",  # GDP growth (annual %)
    "unemployment": "SL.UEM.TOTL.ZS",  # unemployment, total (% of labor force)
}

_CACHE_TTL_SECONDS = 24 * 60 * 60  # published annual data; no need to refetch more than daily
_cache: dict[str, tuple[float, "list[CountryIndicator]"]] = {}


@dataclass
class CountryIndicator:
    country_code: str  # ISO 3166-1 alpha-3
    country_name: str
    value: float
    year: int


def _fetch_real_country_codes() -> set[str]:
    """The indicator endpoint also returns aggregates (regions, income groups,
    "World") mixed in with real countries, both using 3-letter codes — so we
    can't tell them apart from the indicator response alone. The country-list
    endpoint tags each entry with a region; aggregates are tagged
    region.value == "Aggregates". Fetch that once to build an allow-list of
    real countries.
    """
    resp = requests.get(_COUNTRIES_URL, params={"format": "json", "per_page": 400}, timeout=15)
    resp.raise_for_status()
    payload = resp.json()
    if len(payload) < 2 or not payload[1]:
        return set()

    return {
        row["id"]
        for row in payload[1]
        if row.get("region", {}).get("value") not in (None, "Aggregates") and row.get("id")
    }


def _fetch_indicator(indicator_code: str) -> list[CountryIndicator]:
    real_codes = _fetch_real_country_codes()

    resp = requests.get(
        _INDICATOR_URL_TEMPLATE.format(code=indicator_code),
        params={"format": "json", "per_page": 400, "mrnev": 1},  # most recent non-empty value per country
        timeout=15,
    )
    resp.raise_for_status()
    payload = resp.json()
    if len(payload) < 2 or not payload[1]:
        return []

    results = []
    for row in payload[1]:
        code = row.get("countryiso3code")
        value = row.get("value")
        year = row.get("date")
        name = (row.get("country") or {}).get("value")
        if not code or code not in real_codes or value is None or not name:
            continue
        try:
            results.append(CountryIndicator(country_code=code, country_name=name, value=float(value), year=int(year)))
        except (TypeError, ValueError):
            continue

    return results


def get_indicator_by_country(indicator: str) -> list[CountryIndicator]:
    """Cached (24h) list of each country's latest published annual value for the given
    indicator key (one of _INDICATORS). Raises ValueError if the World Bank API is
    unreachable and no stale cache is available — callers must degrade gracefully
    rather than fabricate figures.
    """
    indicator_code = _INDICATORS[indicator]
    now = time.time()
    cached = _cache.get(indicator)
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    try:
        results = _fetch_indicator(indicator_code)
    except requests.RequestException as exc:
        if cached:  # serve stale data over a transient outage rather than breaking the page
            return cached[1]
        raise ValueError(f"World Bank verisi alınamadı: {exc}") from exc

    _cache[indicator] = (now, results)
    return results


def get_inflation_by_country() -> list[CountryIndicator]:
    return get_indicator_by_country("inflation")


def get_gdp_growth_by_country() -> list[CountryIndicator]:
    return get_indicator_by_country("gdp_growth")


def get_unemployment_by_country() -> list[CountryIndicator]:
    return get_indicator_by_country("unemployment")
