from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime, timezone

from app.db.deps import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.device_token import DeviceToken

router = APIRouter(prefix="/push", tags=["Push Notifications"])


class RegisterTokenIn(BaseModel):
    token: str
    platform: str  # "ios" | "android"


@router.post("/register-token")
def register_token(payload: RegisterTokenIn, db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    existing = db.scalar(select(DeviceToken).where(DeviceToken.token == payload.token))
    if existing:
        existing.user_id = ctx.user_id
        existing.studio_id = ctx.studio_id
        existing.platform = payload.platform
        existing.is_active = True
        existing.last_seen_at = datetime.now(timezone.utc)
    else:
        db.add(DeviceToken(
            user_id=ctx.user_id,
            studio_id=ctx.studio_id,
            token=payload.token,
            platform=payload.platform,
        ))
    db.commit()
    return {"ok": True}


@router.delete("/register-token")
def unregister_token(token: str, db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    existing = db.scalar(select(DeviceToken).where(DeviceToken.token == token, DeviceToken.user_id == ctx.user_id))
    if existing:
        existing.is_active = False
        db.commit()
    return {"ok": True}
