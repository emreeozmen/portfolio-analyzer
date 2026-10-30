import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from routers import markets
from services import news_service

RSS = b'''<rss><channel><item><title>Economy &amp; markets</title>
<link>https://www.bloomberght.com/example</link><pubDate>Fri, 30 Oct 2026 12:00:00 +0300</pubDate>
<description>A full article must not be reproduced.</description></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
<item><title>Wrong host</title><link>https://not-bloomberght.com/article</link></item></channel></rss>'''


@pytest.fixture(autouse=True)
def clear_cache():
    news_service._cache = None
    news_service._retry_after = 0
    yield
    news_service._cache = None
    news_service._retry_after = 0


def headline(title="Example", published="2026-10-30T09:00:00+00:00"):
    return {"id": title, "title": title, "url": "https://www.bloomberght.com/example", "summary": "",
            "publisher": "Bloomberg HT", "published_at": published, "thumbnail_url": None, "related_symbol": ""}


def test_feed_extracts_attributed_headlines_and_safe_links_without_article_bodies():
    response = MagicMock(content=RSS)
    with patch.object(news_service.requests, "get", return_value=response):
        rows = news_service._fetch_feed(news_service.FEEDS[0])
    assert len(rows) == 1
    assert rows[0]["title"] == "Economy & markets"
    assert rows[0]["publisher"] == "Bloomberg HT"
    assert rows[0]["published_at"] == "2026-10-30T09:00:00+00:00"
    assert rows[0]["summary"] == ""


def test_one_feed_can_fail_without_losing_the_other_and_results_are_cached():
    with patch.object(news_service, "_fetch_feed", side_effect=[OSError("offline"), [headline()]]) as fetch:
        assert len(news_service.get_rss_news()) == 1
        assert len(news_service.get_rss_news()) == 1
    assert fetch.call_count == 2


def test_cached_headlines_survive_a_transient_failure_with_original_timestamps():
    rows = [headline()]
    news_service._cache = (time.monotonic() - 301, rows)
    with patch.object(news_service, "_safe_fetch", return_value=[]) as fetch:
        assert news_service.get_rss_news() == rows
        assert news_service.get_rss_news() == rows
    assert fetch.call_count == 2


def test_complete_failure_is_not_retried_on_every_request():
    with patch.object(news_service, "_safe_fetch", return_value=[]) as fetch:
        assert news_service.get_rss_news() == []
        assert news_service.get_rss_news() == []
    assert fetch.call_count == 2


def test_feed_headlines_are_deduplicated_and_newest_first():
    with patch.object(news_service, "_safe_fetch", side_effect=[
        [headline("Older", "2026-10-29T09:00:00+00:00")], [headline("Newer"), headline("Older")],
    ]):
        rows = news_service.get_rss_news()
    assert [row["title"] for row in rows] == ["Newer", "Older"]


def test_economy_feed_avoids_waiting_for_yahoo_when_it_has_headlines():
    with patch.object(news_service, "get_rss_news", return_value=[headline()]), \
         patch.object(markets.market_data_provider, "get_news") as yahoo:
        assert markets.compute_market_news() == [headline()]
    yahoo.assert_not_called()


def test_yahoo_remains_a_fallback_if_feeds_are_down():
    with patch.object(news_service, "get_rss_news", return_value=[]), \
         patch.object(markets.market_data_provider, "get_news", return_value=[headline()]):
        assert markets.compute_market_news() == [headline()]


def test_total_outage_returns_retryable_error_instead_of_empty_success():
    with patch.object(news_service, "get_rss_news", return_value=[]), \
         patch.object(markets.market_data_provider, "get_news", return_value=[]):
        with pytest.raises(HTTPException) as error:
            markets.compute_market_news()
    assert error.value.status_code == 503
