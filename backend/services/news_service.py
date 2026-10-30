"""Short, attributed headlines from fixed public economy feeds; no article bodies."""

import logging
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import urlparse

import requests

logger = logging.getLogger("uvicorn.error")
FEEDS = (
    ("https://www.bloomberght.com/rss/tum-haberler.xml", "Bloomberg HT", "bloomberght.com"),
    ("https://www.haberturk.com/rss/ekonomi.xml", "Habertürk Ekonomi", "haberturk.com"),
)
_cache: tuple[float, list[dict]] | None = None
_retry_after = 0.0
_lock = threading.Lock()


def _fetch_feed(feed: tuple[str, str, str]) -> list[dict]:
    url, publisher, domain = feed
    response = requests.get(url, timeout=6, headers={"User-Agent": "PortfolioAnalyzer/1.0 RSS reader"})
    response.raise_for_status()
    if len(response.content) > 2_000_000:
        raise ValueError("News feed exceeds size limit")
    root = ET.fromstring(response.content)
    items = []
    for entry in root.findall("./channel/item")[:30]:
        title = unescape(entry.findtext("title") or "").strip()
        link = (entry.findtext("link") or "").strip()
        parsed = urlparse(link)
        host = parsed.hostname or ""
        if not title or parsed.scheme not in ("http", "https") or not (host == domain or host.endswith("." + domain)):
            continue
        published_at = None
        try:
            published = parsedate_to_datetime(entry.findtext("pubDate") or "")
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            published_at = published.astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError, OverflowError):
            pass
        items.append({"id": link, "title": title[:240], "url": link, "summary": "", "publisher": publisher,
                      "published_at": published_at, "thumbnail_url": None, "related_symbol": ""})
    return items


def _safe_fetch(feed):
    try:
        return _fetch_feed(feed)
    except Exception as exc:
        logger.warning("News feed unavailable for %s: %s", feed[1], exc)
        return []


def get_rss_news() -> list[dict]:
    global _cache, _retry_after
    # One in-flight refresh per worker, even when several browsers open together.
    with _lock:
        now = time.monotonic()
        if _cache and now - _cache[0] < 300:
            return _cache[1]
        if now < _retry_after:
            return _cache[1] if _cache and now - _cache[0] < 86_400 else []
        with ThreadPoolExecutor(max_workers=2) as pool:
            batches = list(pool.map(_safe_fetch, FEEDS))
        seen = set()
        items = []
        for batch in batches:
            for item in batch:
                key = item["title"].casefold()
                if key not in seen:
                    seen.add(key)
                    items.append(item)
        items.sort(key=lambda item: item["published_at"] or "", reverse=True)
        if items:
            _cache = (time.monotonic(), items[:12])
            return _cache[1]
        _retry_after = time.monotonic() + 30
        return _cache[1] if _cache and now - _cache[0] < 86_400 else []
