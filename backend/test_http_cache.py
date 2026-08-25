from fastapi import Response

from services.http_cache import cache_control


def test_cache_control_sets_public_max_age_header():
    response = Response()
    dependency = cache_control(900)
    dependency(response)
    assert response.headers["Cache-Control"] == "public, max-age=900"


def test_cache_control_is_reusable_with_different_ttls():
    response_a = Response()
    cache_control(60)(response_a)
    assert response_a.headers["Cache-Control"] == "public, max-age=60"

    response_b = Response()
    cache_control(86400)(response_b)
    assert response_b.headers["Cache-Control"] == "public, max-age=86400"
