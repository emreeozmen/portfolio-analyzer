from unittest.mock import patch

import pytest
from fastapi import HTTPException

from routers import markets


@pytest.mark.parametrize("compute,symbols_attr", [
    (markets.compute_crypto_quotes, "CRYPTO_SYMBOLS"),
    (markets.compute_fx_quotes, "FX_PAIRS"),
    (markets.compute_ticker_strip, "TICKER_STRIP_SYMBOLS"),
])
def test_one_upstream_failure_does_not_discard_healthy_quotes(compute, symbols_attr):
    def quote(symbol):
        if symbol == "BAD":
            raise RuntimeError("Yahoo rate limited or disconnected")
        return {"last_price": 100, "change_percent": 2}

    with (
        patch.object(markets, symbols_attr, [("BAD", "Bad"), ("GOOD", "Good")]),
        patch.object(markets.market_data_provider, "get_quote", side_effect=quote),
        patch.object(markets.market_data_provider, "get_market_cap", return_value=1000),
    ):
        result = compute()
    assert len(result) == 1
    assert result[0].get("last_price", result[0].get("rate", result[0].get("value"))) == 100


@pytest.mark.parametrize("compute", [markets.compute_crypto_quotes, markets.compute_fx_quotes, markets.compute_ticker_strip])
def test_total_upstream_outage_returns_retryable_error_not_empty_success(compute):
    with patch.object(markets.market_data_provider, "get_quote", side_effect=OSError("upstream down")):
        with pytest.raises(HTTPException) as error:
            compute()
    assert error.value.status_code == 503
    assert error.value.headers["Retry-After"] == "30"


def test_optional_market_cap_failure_preserves_crypto_price():
    with (
        patch.object(markets, "CRYPTO_SYMBOLS", [("BTC-USD", "Bitcoin")]),
        patch.object(markets.market_data_provider, "get_quote", return_value={"last_price": 100, "change_percent": 2}),
        patch.object(markets.market_data_provider, "get_market_cap", side_effect=ValueError("malformed cap")),
    ):
        result = markets.compute_crypto_quotes()
    assert result[0]["symbol"] == "BTC"
    assert result[0]["last_price"] == 100
    assert result[0]["market_cap"] is None


def test_bist_history_network_error_is_reported_as_a_dependency_error():
    with patch.object(markets.market_data_provider, "fetch_ohlcv_cached", side_effect=OSError("disconnected")):
        with pytest.raises(HTTPException) as error:
            markets.get_bist100_history()
    assert error.value.status_code == 502
