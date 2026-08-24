import pandas as pd
import pytest

from services import analysis_service


def test_risk_free_rate_known_currency():
    assert analysis_service.risk_free_rate_for("TRY") == pytest.approx(0.45)
    assert analysis_service.risk_free_rate_for("usd") == pytest.approx(0.045)


def test_risk_free_rate_unknown_currency_defaults_to_zero():
    assert analysis_service.risk_free_rate_for("XYZ") == 0.0


def test_correlation_matrix_perfectly_correlated_series():
    dates = pd.date_range("2026-01-01", periods=5)
    series = pd.Series([100, 101, 102, 103, 104], index=dates)
    result = analysis_service.correlation_matrix({"A": series, "B": series * 2})

    assert result["tickers"] == ["A", "B"]
    assert result["matrix"][0][1] == pytest.approx(1.0)


def test_correlation_matrix_single_asset_returns_identity():
    dates = pd.date_range("2026-01-01", periods=3)
    result = analysis_service.correlation_matrix({"A": pd.Series([1, 2, 3], index=dates)})
    assert result == {"tickers": ["A"], "matrix": [[1.0]]}


def test_benchmark_index_series_normalizes_to_base_100():
    result = analysis_service.benchmark_index_series(
        {"2026-01-01": 50, "2026-01-02": 55}, ["2026-01-01", "2026-01-02"]
    )
    assert result[0]["value"] == pytest.approx(100.0)
    assert result[1]["value"] == pytest.approx(110.0)


def test_benchmark_index_series_empty_input_returns_empty():
    assert analysis_service.benchmark_index_series({}, ["2026-01-01"]) == []
    assert analysis_service.benchmark_index_series({"2026-01-01": 50}, []) == []


def test_group_weights_by_attribute_sums_by_label():
    result = analysis_service.group_weights_by_attribute(
        [("Technology", 0.3), ("Financial Services", 0.5), ("Technology", 0.2)]
    )
    assert result == [{"label": "Technology", "weight": pytest.approx(0.5)}, {"label": "Financial Services", "weight": pytest.approx(0.5)}]


def test_group_weights_by_attribute_groups_missing_under_bilinmiyor():
    result = analysis_service.group_weights_by_attribute([("USD", 0.6), (None, 0.4)])
    labels = {row["label"]: row["weight"] for row in result}
    assert labels == {"USD": pytest.approx(0.6), "Bilinmiyor": pytest.approx(0.4)}


def test_group_weights_by_attribute_sorted_descending():
    result = analysis_service.group_weights_by_attribute([("A", 0.2), ("B", 0.8)])
    assert [row["label"] for row in result] == ["B", "A"]
