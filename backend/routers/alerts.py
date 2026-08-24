from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from database import get_db
from i18n import get_lang, localize
from models import User
from routers.auth import get_current_user
from services import alert_service, asset_service

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertCreate(BaseModel):
    ticker: str
    condition: str
    threshold: float

    @field_validator("condition")
    @classmethod
    def validate_condition(cls, value: str) -> str:
        if value not in alert_service.VALID_CONDITIONS:
            raise ValueError("Geçersiz uyarı koşulu")
        return value


class AlertResponse(BaseModel):
    id: int
    ticker: str
    condition: str
    threshold: float
    is_active: bool
    is_triggered: bool
    is_read: bool
    created_at: datetime
    triggered_at: datetime | None


@router.get("", response_model=list[AlertResponse])
def get_alerts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return alert_service.list_alerts(db, current_user.id)


@router.post("", response_model=AlertResponse)
def create_alert(
    payload: AlertCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    asset = asset_service.get_asset_by_ticker(db, payload.ticker)
    if asset is None:
        raise HTTPException(status_code=404, detail=localize("Varlık bulunamadı", lang))
    try:
        alert = alert_service.create_alert(db, current_user.id, asset.id, payload.condition, payload.threshold)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=localize(str(exc), lang)) from exc
    return AlertResponse(
        id=alert.id,
        ticker=asset.ticker,
        condition=alert.condition,
        threshold=alert.threshold,
        is_active=alert.is_active,
        is_triggered=alert.is_triggered,
        is_read=alert.is_read,
        created_at=alert.created_at,
        triggered_at=alert.triggered_at,
    )


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if not alert_service.delete_alert(db, current_user.id, alert_id):
        raise HTTPException(status_code=404, detail=localize("Uyarı bulunamadı", lang))


@router.post("/{alert_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def read_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_lang),
):
    if not alert_service.mark_read(db, current_user.id, alert_id):
        raise HTTPException(status_code=404, detail=localize("Uyarı bulunamadı", lang))


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def read_all_alerts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    alert_service.mark_all_read(db, current_user.id)
