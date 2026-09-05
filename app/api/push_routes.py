from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime, timezone
from uuid import UUID

from app.db.deps import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.device_token import DeviceToken
from app.schemas.staff_reminder import StaffReminderRuleCreate, StaffReminderRuleUpdate, StaffReminderRuleOut
from app.crud import staff_reminders as staff_reminder_crud

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


class ClientLogIn(BaseModel):
    message: str


@router.post("/client-log")
def client_log(payload: ClientLogIn, ctx: AuthContext = Depends(require_studio_ctx)):
    import logging
    logging.getLogger("push_client").info(f"[push-client user={ctx.user_id}] {payload.message}")
    return {"ok": True}


@router.delete("/register-token")
def unregister_token(token: str, db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    existing = db.scalar(select(DeviceToken).where(DeviceToken.token == token, DeviceToken.user_id == ctx.user_id))
    if existing:
        existing.is_active = False
        db.commit()
    return {"ok": True}


# ── Staff-facing reminder rules ("push me N minutes before an appointment/
# task starts") — an admin-configurable list with no fixed set of lead times,
# distinct from the customer-facing 1day/3day/7day/same_day reminders. ──────

@router.get("/staff-reminder-rules", response_model=list[StaffReminderRuleOut])
def list_staff_reminder_rules(db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    return staff_reminder_crud.list_rules(db, ctx.studio_id)


@router.post("/staff-reminder-rules", response_model=StaffReminderRuleOut, status_code=201)
def create_staff_reminder_rule(payload: StaffReminderRuleCreate, db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    return staff_reminder_crud.create_rule(db, ctx.studio_id, payload.applies_to, payload.lead_minutes, payload.enabled)


@router.put("/staff-reminder-rules/{rule_id}", response_model=StaffReminderRuleOut)
def update_staff_reminder_rule(rule_id: str, payload: StaffReminderRuleUpdate, db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    try:
        rid = UUID(rule_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid rule id")
    rule = staff_reminder_crud.get_rule(db, ctx.studio_id, rid)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return staff_reminder_crud.update_rule(db, rule, **payload.model_dump(exclude_unset=True))


@router.delete("/staff-reminder-rules/{rule_id}", status_code=204)
def delete_staff_reminder_rule(rule_id: str, db: Session = Depends(get_db), ctx: AuthContext = Depends(require_studio_ctx)):
    try:
        rid = UUID(rule_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid rule id")
    rule = staff_reminder_crud.get_rule(db, ctx.studio_id, rid)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    staff_reminder_crud.delete_rule(db, rule)
