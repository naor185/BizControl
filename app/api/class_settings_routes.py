"""
Classes & memberships settings (stage 1): the business owner's settings and the class/membership
notifications — which are on, their wording, and a test to the owner's own phone. Everything is behind
the "classes" module; changing anything needs the "classes.configure" permission (owner or admin).
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.features import require_module
from app.core.permissions import require_action
from app.models.notification_template import NotificationTemplate
from app.models.user import User
from app.services import notifications, policies

router = APIRouter(prefix="/classes", tags=["Classes"], dependencies=[Depends(require_module("classes"))])


# ── the owner's settings ─────────────────────────────────────────────────────

def _settings_out(db: Session, studio_id) -> list[dict]:
    values = policies.studio_policies(db, studio_id)
    return [{
        "key": p.key, "label": p.label, "kind": p.kind, "unit": p.unit, "help": p.help,
        "min": p.minimum, "max": p.maximum, "choices": [{"value": c, "label": l} for c, l in p.choices],
        "default": p.default, "module": p.module, **values[p.key],
    } for p in policies.POLICIES.values()]


@router.get("/settings")
def get_settings(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return _settings_out(db, ctx.studio_id)


class SettingsIn(BaseModel):
    values: dict[str, object]      # key → value; null = back to the default


@router.patch("/settings")
def set_settings(body: SettingsIn, ctx: AuthContext = Depends(require_action("classes.configure")),
                 db: Session = Depends(get_db)):
    try:
        for key, value in body.values.items():
            p = policies.POLICIES.get(key)
            # a value equal to the default is not the owner's own choice — keep following the default
            policies.set_policy(db, ctx.studio_id, key, None if p is not None and value == p.default else value,
                                user_id=ctx.user_id)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    db.commit()
    return _settings_out(db, ctx.studio_id)


# ── notifications ────────────────────────────────────────────────────────────

def _notifications_out(db: Session, studio_id) -> list[dict]:
    sample = notifications.sample_context(db, studio_id)
    out = []
    for ev in notifications.EVENTS.values():
        channels = []
        for ch in notifications.event_channels(ev):
            on, body = notifications.channel_setting(db, studio_id, ev.key, ch)
            channels.append({"channel": ch, "enabled": on, "body": body, "default_body": ev.texts.get(ch, ""),
                             "is_default_body": body == ev.texts.get(ch, "")})
        out.append({"event": ev.key, "label": ev.label, "audience": ev.audience, "recipient": ev.recipient,
                    "always_on": ev.always_on, "module": ev.module, "channels": channels,
                    "placeholders": [{"key": k, "label": notifications.PLACEHOLDERS[k][0], "sample": sample[k]}
                                     for k in notifications.placeholders(ev)]})
    return out


@router.get("/notifications")
def get_notifications(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return _notifications_out(db, ctx.studio_id)


class NotificationIn(BaseModel):
    channel: str
    enabled: Optional[bool] = None
    body: Optional[str] = None       # "" = back to the default text


@router.patch("/notifications/{event}")
def set_notification(event: str, body: NotificationIn, ctx: AuthContext = Depends(require_action("classes.configure")),
                     db: Session = Depends(get_db)):
    ev = notifications.EVENTS.get(event)
    if not ev:
        raise HTTPException(404, "הודעה לא מוכרת")
    if body.channel not in notifications.event_channels(ev):
        raise HTTPException(400, "ערוץ לא מתאים להודעה הזו")
    if body.enabled is False and ev.always_on:
        raise HTTPException(400, "את ההודעה הזו אי אפשר לכבות — הלקוחות חייבים לדעת")
    text = (body.body or "").strip() if body.body is not None else None
    if text is not None and len(text) > 2000:
        raise HTTPException(400, "הנוסח ארוך מדי (עד 2000 תווים)")
    # an unknown {placeholder} would reach the client as it is — refuse it here
    unknown = [k for k in re.findall(r"\{(\w+)\}", text or "") if k not in notifications.placeholders(ev)]
    if unknown:
        raise HTTPException(400, f"המשתנה {{{unknown[0]}}} לא מוכר בהודעה הזו — בחר מהרשימה שמתחת לנוסח")
    row = db.scalar(select(NotificationTemplate).where(NotificationTemplate.studio_id == ctx.studio_id,
                                                       NotificationTemplate.event == event,
                                                       NotificationTemplate.channel == body.channel))
    if not row:
        row = NotificationTemplate(studio_id=ctx.studio_id, event=event, channel=body.channel)
        db.add(row)
    if body.enabled is not None:
        row.enabled = None if body.enabled == ev.default_on else body.enabled
    if text is not None:
        row.body = None if not text or text == ev.texts.get(body.channel, "").strip() else text
    db.commit()
    return _notifications_out(db, ctx.studio_id)


class TestIn(BaseModel):
    channel: str


@router.post("/notifications/{event}/test")
def test_notification(event: str, body: TestIn, ctx: AuthContext = Depends(require_action("classes.configure")),
                      db: Session = Depends(get_db)):
    if event not in notifications.EVENTS:
        raise HTTPException(404, "הודעה לא מוכרת")
    user = db.get(User, ctx.user_id)
    try:
        to = notifications.send_test(db, ctx.studio_id, event, body.channel, user)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    db.commit()
    return {"sent_to": to}
