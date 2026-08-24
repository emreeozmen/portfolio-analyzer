"""The live-data WebSocket endpoint. A client connects once (optionally with
?token=<JWT> for the per-user "alerts" channel), sends a {"action": "subscribe",
"channels": [...]} message naming the public channels it wants (quotes, ticker-strip,
indices, commodities, crypto, crypto-global, news, prices-updated) plus "alerts" if
authenticated, and from then on receives {"channel": ..., "data": ...} pushes from the
background loops in main.py — no per-client polling loop on either side.
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from database import SessionLocal
from services import auth_service, ws_manager

logger = logging.getLogger("uvicorn.error")

router = APIRouter()


def _resolve_user_id(token: str | None) -> int | None:
    if not token:
        return None
    try:
        user_id, jti = auth_service.decode_access_token(token)
    except Exception:
        return None
    # A revoked session shouldn't keep receiving the per-user "alerts" channel just
    # because its JWT hasn't technically expired yet — same check as get_current_user.
    db = SessionLocal()
    try:
        if auth_service.get_active_session(db, jti) is None:
            return None
    finally:
        db.close()
    return user_id


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str | None = None):
    user_id = _resolve_user_id(token)
    await ws_manager.manager.connect(websocket, user_id)
    try:
        while True:
            message = await websocket.receive_json()
            action = message.get("action")
            channels = message.get("channels") or []
            if not isinstance(channels, list):
                continue
            if action == "subscribe":
                await ws_manager.manager.subscribe(websocket, channels)
            elif action == "unsubscribe":
                await ws_manager.manager.unsubscribe(websocket, channels)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # a malformed client message shouldn't crash the server
        logger.warning("websocket error: %s", exc)
    finally:
        await ws_manager.manager.disconnect(websocket)
