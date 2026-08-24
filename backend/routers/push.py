from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models import User
from routers.auth import get_current_user
from services import push_service

router = APIRouter(prefix="/push", tags=["push"])


class VapidPublicKeyResponse(BaseModel):
    public_key: str


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: SubscriptionKeys


class UnsubscribeRequest(BaseModel):
    endpoint: str


@router.get("/vapid-public-key", response_model=VapidPublicKeyResponse)
def get_vapid_public_key():
    """Public — the frontend needs this to call `pushManager.subscribe()` before the
    user is necessarily logged in to anything else on this page. An empty string
    means push isn't configured on this deployment (see push_service.is_configured).
    """
    return VapidPublicKeyResponse(public_key=settings.vapid_public_key)


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(
    payload: SubscribeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not push_service.is_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Push bildirimleri yapılandırılmamış")
    push_service.upsert_subscription(
        db, user_id=current_user.id, endpoint=payload.endpoint, p256dh=payload.keys.p256dh, auth=payload.keys.auth
    )


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    payload: UnsubscribeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    push_service.remove_subscription(db, user_id=current_user.id, endpoint=payload.endpoint)
