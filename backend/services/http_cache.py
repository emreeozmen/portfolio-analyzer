"""A FastAPI dependency factory that sets a Cache-Control header — lets Render's
Cloudflare edge (confirmed present via the cf-cache-status/CF-RAY response headers on
the deployed backend) cache a response and serve repeat requests without ever reaching
the origin at all, rather than every request paying a full round trip only to hit an
already-warm in-process cache in market_data_provider/worldbank_service. Only ever
applied to endpoints that are public (no per-user data) and already have their own
server-side cache TTL — max_age is set to match that TTL so a CDN-cached response is
never staler than what the origin itself would have served anyway.
"""

from fastapi import Response


def cache_control(max_age_seconds: int):
    def dependency(response: Response) -> None:
        response.headers["Cache-Control"] = f"public, max-age={max_age_seconds}"

    return dependency
