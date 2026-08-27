import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from config import settings
from database import Base, SessionLocal, engine, run_light_migrations
from i18n import ERROR_TRANSLATIONS, get_lang
from models import User
from routers import alerts, assets, auth, holdings, markets, portfolios, public, push, ws
from services import (
    alert_service,
    asset_service,
    digest_service,
    email_service,
    market_data_provider,
    price_service,
    push_service,
    ws_manager,
)

logger = logging.getLogger("uvicorn.error")

# A no-op when sentry_dsn is unset (the SDK's own documented behavior for an empty
# DSN — every sentry_sdk.* call below becomes a harmless no-op instead of erroring),
# so this runs identically whether or not a project has ever configured Sentry.
# traces_sample_rate is deliberately low (10%) — this is APM/performance tracing
# volume, not error reporting (errors are always captured regardless of this rate).
sentry_sdk.init(
    dsn=settings.sentry_dsn,
    environment=settings.sentry_environment,
    integrations=[StarletteIntegration(), FastApiIntegration()],
    traces_sample_rate=0.1,
    send_default_pii=False,
)

Base.metadata.create_all(bind=engine)
run_light_migrations()

# Not a hard failure — an existing deployment with a weak-but-already-in-use secret
# would have every issued token invalidated by rotating it out from under itself, a
# worse outcome than a loud log line. This is purely so a JWT_SECRET_KEY left at the
# repo's own dev default (or anything under HS256's 32-byte-minimum recommendation —
# see the InsecureKeyLengthWarning pyjwt itself already raises for this) is visible
# in logs instead of a silent weakness. Render's own blueprint (render.yaml) already
# sets generateValue: true, which produces a long random secret — this only ever
# fires for a deployment that overrode that or is running outside Render entirely.
if settings.jwt_secret_key == "dev-only-secret-change-me":
    logger.warning(
        "JWT_SECRET_KEY is still the repository's default dev value — set a real "
        "secret (e.g. `python -c \"import secrets; print(secrets.token_hex(32))\"`) "
        "for any deployment other than local development."
    )
elif len(settings.jwt_secret_key.encode()) < 32:
    logger.warning(
        "JWT_SECRET_KEY is under 32 bytes, below HS256's recommended minimum "
        "(RFC 7518 §3.2) — consider rotating to a longer secret."
    )

AUTO_REFRESH_INTERVAL_SECONDS = 5 * 60  # keep tracked assets' prices reasonably fresh without hammering Yahoo
# Finance. A shorter interval was tried and reverted: the frontend's Piyasa Görünümü page does a *full* reload
# (all displayed tickers' full analysis — price history refetch + metric recomputation) on every "prices-updated"
# broadcast this loop sends (see asset-market-dashboard.tsx's reloadCards/useLiveSignal), so shortening this
# interval directly multiplies that page's backend load by the same factor. At 30s (10x more often than 5 min)
# on Render's free single-worker instance this saturated the one worker handling every other request too,
# making the whole site feel slow. Don't lower this without also changing the frontend to not do a full
# reload on every tick (e.g. only reload metrics that actually go stale, or debounce/coalesce the signal).
# Reference-data (indices/commodities/crypto/news) isn't DB-backed like tracked assets
# are — it's fetched live from Yahoo/CoinGecko with its own in-process cache (see
# market_data_provider), so this loop just re-reads that cache on a short interval and
# broadcasts it. Since fetch_ohlcv_cached/get_quote/get_news are all cached well past
# this interval, most ticks here are cheap cache hits, not new Yahoo Finance calls —
# this loop doesn't increase load on Yahoo beyond what the REST endpoints already did,
# it just does the fetch once centrally instead of once per connected browser tab.
MARKET_DATA_BROADCAST_INTERVAL_SECONDS = 60
NEWS_BROADCAST_INTERVAL_SECONDS = 5 * 60
# A digest is only actually due for a given user every 7/30 days (see
# digest_service.users_due_for_digest) — this is just how often the loop re-checks who
# has crossed that threshold since it last looked, so a few hours of slack either way
# on when a digest goes out is fine.
DIGEST_CHECK_INTERVAL_SECONDS = 6 * 60 * 60


async def _auto_refresh_loop() -> None:
    """Refreshes every tracked asset's price history, checks its alerts, and pushes
    both out over WebSocket — quotes as one batched "quotes" message so a client
    doesn't need N separate updates, and any newly-triggered alert straight to its
    owning user's "alerts" channel (not everyone connected) the moment it fires,
    rather than only the next time that user's client happens to poll.
    """
    while True:
        await asyncio.sleep(AUTO_REFRESH_INTERVAL_SECONDS)
        db = SessionLocal()
        try:
            assets_list = await asyncio.to_thread(asset_service.list_assets, db)
            any_refreshed = False
            for asset in assets_list:
                try:
                    # Both calls are blocking (yfinance HTTP, DB query) — offloaded to a
                    # worker thread, same reasoning as _market_data_broadcast_loop, so
                    # this loop doesn't stall request/WebSocket handling while it runs.
                    await asyncio.to_thread(price_service.refresh_price_history, db, asset)
                    any_refreshed = True
                    triggered = await asyncio.to_thread(alert_service.check_alerts_for_asset, db, asset.id)
                    for alert in triggered:
                        await ws_manager.manager.send_to_user(
                            alert.user_id,
                            "alerts",
                            {
                                "id": alert.id,
                                "ticker": asset.ticker,
                                "condition": alert.condition,
                                "threshold": alert.threshold,
                                "triggered_at": alert.triggered_at.isoformat(),
                            },
                        )
                        # Email is a best-effort addition on top of the WebSocket push
                        # above, not a replacement — the alert already landed in-app
                        # regardless of whether SMTP is configured or this send fails.
                        alert_user = await asyncio.to_thread(db.get, User, alert.user_id)
                        if alert_user and alert_user.email_alerts_enabled:
                            await asyncio.to_thread(
                                email_service.send_alert_triggered_email,
                                alert_user.email,
                                asset.ticker,
                                alert.condition,
                                alert.threshold,
                            )
                        # Same best-effort addition as email above — a triggered
                        # alert already landed in-app/email regardless of whether
                        # push is configured or this send fails. No per-user flag
                        # to check: a PushSubscription row's existence is itself
                        # "push enabled for this device" (see push_service.py).
                        if push_service.is_configured():
                            await asyncio.to_thread(
                                push_service.send_alert_push,
                                db,
                                alert.user_id,
                                asset.ticker,
                                alert.condition,
                                alert.threshold,
                            )
                except Exception as exc:
                    # Broad on purpose: a Yahoo Finance rate-limit/network error for one
                    # asset is not a ValueError, and letting it propagate out of this
                    # per-asset try would abort the whole tick's refresh (and quotes
                    # broadcast) for every other asset too — see the interval comment above.
                    logger.warning("auto-refresh failed for %s: %s", asset.ticker, exc)

            if any_refreshed:
                quotes = await asyncio.to_thread(price_service.get_latest_quotes, db, assets_list)
                await ws_manager.manager.broadcast("quotes", quotes)
                # Portfolio/holdings valuation is expensive to recompute (correlation
                # matrices, Monte Carlo, ...) — rather than push the full computed
                # payload for every open portfolio on every refresh, just signal that
                # prices moved so the frontend can re-fetch the (cheaper) valuation
                # summary itself, debounced, only for portfolios actually on screen.
                await ws_manager.manager.broadcast("prices-updated", {"at": datetime.now(timezone.utc).isoformat()})
        except Exception as exc:
            # An unexpected error here (vs. the per-asset ValueError above, which is
            # already handled) would otherwise propagate out of the while loop and
            # silently kill this asyncio.create_task forever — no more auto-refresh for
            # the rest of the process's life, with nothing in the logs pointing at why
            # prices stopped updating. Sentry's FastAPI integration only sees exceptions
            # raised inside a request handler, not a background task, hence the
            # explicit capture_exception here.
            logger.exception("auto-refresh loop iteration failed: %s", exc)
            sentry_sdk.capture_exception(exc)
        finally:
            db.close()


async def _market_data_broadcast_loop() -> None:
    # compute_* below are plain blocking functions (sync yfinance/requests calls) —
    # run via asyncio.to_thread rather than awaited directly, so a slow Yahoo Finance
    # round-trip doesn't stall the event loop (and with it every other request and
    # every other WebSocket connection this worker is serving) for its duration.
    while True:
        await asyncio.sleep(MARKET_DATA_BROADCAST_INTERVAL_SECONDS)
        for channel, compute in (
            ("ticker-strip", markets.compute_ticker_strip),
            ("indices", markets.compute_major_indices),
            ("commodities", markets.compute_commodities),
            ("crypto", markets.compute_crypto_quotes),
            ("fx", markets.compute_fx_quotes),
        ):
            try:
                data = await asyncio.to_thread(compute)
                await ws_manager.manager.broadcast(channel, data)
            except Exception as exc:
                logger.warning("market-data broadcast failed for %s: %s", channel, exc)
                sentry_sdk.capture_exception(exc)

        try:
            stats = await asyncio.to_thread(market_data_provider.get_crypto_global_stats)
            await ws_manager.manager.broadcast("crypto-global", stats)
        except Exception as exc:
            logger.warning("market-data broadcast failed for crypto-global: %s", exc)
            sentry_sdk.capture_exception(exc)


async def _news_broadcast_loop() -> None:
    while True:
        await asyncio.sleep(NEWS_BROADCAST_INTERVAL_SECONDS)
        try:
            news = await asyncio.to_thread(markets.compute_market_news)
            await ws_manager.manager.broadcast("news", news)
        except Exception as exc:
            logger.warning("market-data broadcast failed for news: %s", exc)
            sentry_sdk.capture_exception(exc)


async def _digest_email_loop() -> None:
    """Sends the opt-in weekly/monthly portfolio-performance digest (see
    services/digest_service.py). Best-effort per user — one user's failed send/compute
    doesn't block the rest, same as _auto_refresh_loop's per-asset try/except.
    """
    while True:
        await asyncio.sleep(DIGEST_CHECK_INTERVAL_SECONDS)
        db = SessionLocal()
        try:
            for frequency, label in digest_service.FREQUENCY_LABELS.items():
                due_users = await asyncio.to_thread(digest_service.users_due_for_digest, db, frequency)
                for user in due_users:
                    try:
                        content = await asyncio.to_thread(digest_service.build_digest_content, db, user, frequency)
                        if content is None:
                            continue
                        sent = await asyncio.to_thread(
                            email_service.send_portfolio_digest_email, user.email, label, content
                        )
                        if sent:
                            user.last_digest_sent_at = datetime.now(timezone.utc)
                            await asyncio.to_thread(db.commit)
                    except Exception as exc:
                        logger.warning("digest email failed for user %s: %s", user.id, exc)
                        sentry_sdk.capture_exception(exc)
        except Exception as exc:
            logger.exception("digest email loop iteration failed: %s", exc)
            sentry_sdk.capture_exception(exc)
        finally:
            db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(_auto_refresh_loop()),
        asyncio.create_task(_market_data_broadcast_loop()),
        asyncio.create_task(_news_broadcast_loop()),
        asyncio.create_task(_digest_email_loop()),
        # Immediately returns (a harmless no-op task) unless REDIS_URL is set — see
        # ws_manager.redis_relay_loop's docstring.
        asyncio.create_task(ws_manager.redis_relay_loop()),
    ]
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Portfolio Analyzer API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """A JSON API has a smaller header-based attack surface than an HTML app, but
    these are cheap, standard, and never break a legitimate fetch()/XHR client —
    Cloudflare (this deployment's edge, confirmed via its own response headers) adds
    none of these on its own. HSTS is intentionally left to Cloudflare/Vercel, which
    already set it at the edge for every request regardless of what the origin says.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

@app.exception_handler(RequestValidationError)
async def localized_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Translates Pydantic field-validator messages (e.g. RegisterRequest's password
    strength checks) into English when the client asked for it — this is the one
    place those messages can be localized at all, since a `@field_validator` runs
    during request-body parsing with no access to FastAPI's `Depends()` mechanism
    (see i18n.py's module docstring). Mirrors FastAPI's own default 422 response
    shape exactly, just with `msg` translated where we have a fixed-string match.
    """
    lang = get_lang(request.headers.get("x-lang"))
    errors = []
    for error in exc.errors():
        error = dict(error)
        msg = error.get("msg", "")
        # Pydantic wraps a field_validator's raised ValueError as "Value error, <msg>".
        prefix = "Value error, "
        if lang == "en" and msg.startswith(prefix):
            translated = ERROR_TRANSLATIONS.get(msg[len(prefix) :])
            if translated:
                error["msg"] = prefix + translated
        errors.append(error)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


app.include_router(auth.router)
app.include_router(assets.router)
app.include_router(holdings.router)
app.include_router(portfolios.router)
app.include_router(public.router)
app.include_router(markets.router)
app.include_router(alerts.router)
app.include_router(push.router)
app.include_router(ws.router)


# Liveness: is the process up and serving? Deliberately touches nothing else — no DB,
# no external calls — so a transient database or Yahoo Finance hiccup never makes this
# fail. This is what Render's `healthCheckPath` points at, so a dependency blip can't
# trigger a restart loop; it's also the cheap endpoint the keep-alive pings hit.
# Accept HEAD as well as GET: uptime monitors (UptimeRobot's free tier among them)
# default to HEAD requests, and a GET-only route answers those with 405, which a
# monitor reports as downtime even though the service is healthy.
@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok"}


# Readiness: can the process actually serve real traffic right now? Runs the cheapest
# possible round-trip to the database (`SELECT 1`). Returns 503 (not 500) when the DB
# is unreachable so a monitor can distinguish "app is up but degraded" from "app is
# down". NOT wired to Render's health check on purpose — a DB outage should page us,
# not make Render kill and re-roll the web service. Point a secondary uptime monitor
# here for dependency-level alerting.
@app.api_route("/health/ready", methods=["GET", "HEAD"])
def health_ready():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - any DB error means "not ready"
        sentry_sdk.capture_exception(exc)
        logger.error("Readiness check failed: database unreachable: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "checks": {"database": "down"}},
        )
    return {"status": "ready", "checks": {"database": "ok"}}
