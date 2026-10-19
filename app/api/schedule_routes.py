"""The shift schedule (services/schedule.py) — in the plans with the attendance clock.

GET    /api/schedule/week?start=YYYY-MM-DD   — the week: who manages the team gets it all (drafts and constraints too);
                                               a worker, their own shifts once the week is published, and their constraints
POST   /api/schedule/shifts                  — a shift {user_id, date, start, end, note}
PATCH  /api/schedule/shifts/{id}             — its times / note; DELETE — gone
POST   /api/schedule/week/copy               — the week before into this one {start}
POST   /api/schedule/week/publish            — published {start}: each worker with shifts hears of them
PUT    /api/schedule/constraints             — a worker's constraint for a day of a coming week {date, kind, note} —
                                               kind "" clears it; until the deadline
PUT    /api/schedule/settings                — the ready shifts (templates) and the constraints' deadline
"""
from __future__ import annotations

import json
import uuid
import datetime as _dt                       # a field is named "date" below — its type as _dt.date
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.features import require_module
from app.core.permissions import may_do
from app.models.schedule import ScheduledShift, ShiftConstraint
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services import schedule as sch

router = APIRouter(prefix="/schedule", tags=["Schedule"], dependencies=[Depends(require_module("attendance"))])


def _manages(db: Session, ctx: AuthContext) -> bool:
    return may_do(db, ctx.studio_id, ctx.role, "team")


def _manager(db: Session, ctx: AuthContext) -> None:
    if not _manages(db, ctx):
        raise HTTPException(status_code=403, detail="סידור העבודה — לבעל העסק ולמי שמנהל את הצוות")


def _week(start: date) -> date:
    return sch.week_of(start)


def _out(s: ScheduledShift, tz) -> dict:
    a, b = s.starts_at.astimezone(tz), s.ends_at.astimezone(tz)
    return {"id": str(s.id), "user_id": str(s.user_id), "date": a.date().isoformat(), "start": f"{a:%H:%M}",
            "end": f"{b:%H:%M}", "note": s.note or ""}


@router.get("/week")
def get_week(start: date = Query(...), ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    settings = db.get(StudioSettings, ctx.studio_id)
    tz = sch.tz_of(settings)
    ws = _week(start)
    first = tz.localize(datetime(ws.year, ws.month, ws.day))
    pub = sch.is_published(db, ctx.studio_id, ws)
    manages = _manages(db, ctx)
    q = select(ScheduledShift).where(ScheduledShift.studio_id == ctx.studio_id, ScheduledShift.starts_at >= first,
                                     ScheduledShift.starts_at < first + timedelta(days=7)).order_by(ScheduledShift.starts_at)
    cq = select(ShiftConstraint).where(ShiftConstraint.studio_id == ctx.studio_id, ShiftConstraint.day >= ws,
                                       ShiftConstraint.day < ws + timedelta(days=7))
    if not manages:
        q = q.where(ScheduledShift.user_id == ctx.user_id)
        cq = cq.where(ShiftConstraint.user_id == ctx.user_id)
    shifts = db.scalars(q).all() if (manages or pub) else []
    changed = bool(pub and any(s.updated_at and s.updated_at > pub.published_at for s in shifts))
    due = sch.deadline(settings, ws)
    out = {
        "week_start": ws.isoformat(), "published_at": pub.published_at.isoformat() if pub else None, "changed": changed,
        "deadline": due.isoformat(), "can_send": datetime.now(timezone.utc) < due,
        "templates": sch.templates(settings),
        "deadline_day": 4 if settings.constraints_deadline_day is None else settings.constraints_deadline_day,
        "deadline_hour": settings.constraints_deadline_hour or "20:00",
        "shifts": [_out(s, tz) for s in shifts],
        "constraints": [{"user_id": str(c.user_id), "date": c.day.isoformat(), "kind": c.kind, "note": c.note or ""}
                        for c in db.scalars(cq).all()],
    }
    if manages:
        out["workers"] = [{"id": str(u.id), "name": u.display_name or u.email, "color": u.calendar_color}
                          for u in db.scalars(select(User).where(User.studio_id == ctx.studio_id, User.is_active.is_(True),
                                                                 User.role.in_(("admin", "artist", "staff", "owner")))
                                              .order_by(User.display_name)).all()]
    return out


class ShiftIn(BaseModel):
    user_id: uuid.UUID | None = None
    date: _dt.date | None = None
    start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    note: str | None = Field(default=None, max_length=200)


def _times(settings, d: date, start: str, end: str) -> tuple[datetime, datetime]:
    a = sch.at_local(settings, d, start)
    b = sch.at_local(settings, d, end)
    if b <= a:                                   # past midnight — into the next day
        b += timedelta(days=1)
    if b - a > timedelta(hours=16):
        raise HTTPException(status_code=400, detail="משמרת ארוכה מ-16 שעות — בדקו את השעות")
    return a, b


def _no_overlap(db: Session, studio_id, user_id, a: datetime, b: datetime, skip=None) -> None:
    q = select(ScheduledShift.id).where(ScheduledShift.studio_id == studio_id, ScheduledShift.user_id == user_id,
                                        ScheduledShift.starts_at < b, ScheduledShift.ends_at > a)
    if skip is not None:
        q = q.where(ScheduledShift.id != skip)
    if db.scalar(q.limit(1)):
        raise HTTPException(status_code=400, detail="יש כבר משמרת בשעות האלה לאותו עובד/ת")


@router.post("/shifts", status_code=201)
def add_shift(body: ShiftIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    _manager(db, ctx)
    worker = db.get(User, body.user_id) if body.user_id else None
    if worker is None or worker.studio_id != ctx.studio_id or not worker.is_active or not (body.date and body.start and body.end):
        raise HTTPException(status_code=400, detail="בחרו עובד/ת, יום ושעות")
    settings = db.get(StudioSettings, ctx.studio_id)
    a, b = _times(settings, body.date, body.start, body.end)
    _no_overlap(db, ctx.studio_id, worker.id, a, b)
    s = ScheduledShift(studio_id=ctx.studio_id, user_id=worker.id, starts_at=a, ends_at=b, note=(body.note or "").strip() or None,
                       created_by=ctx.user_id)
    db.add(s)
    db.commit()
    return _out(s, sch.tz_of(settings))


@router.patch("/shifts/{shift_id}")
def edit_shift(shift_id: uuid.UUID, body: ShiftIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    _manager(db, ctx)
    s = db.get(ScheduledShift, shift_id)
    if s is None or s.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="המשמרת לא נמצאה")
    settings = db.get(StudioSettings, ctx.studio_id)
    tz = sch.tz_of(settings)
    cur = _out(s, tz)
    if body.user_id is not None:
        worker = db.get(User, body.user_id)
        if worker is None or worker.studio_id != ctx.studio_id or not worker.is_active:
            raise HTTPException(status_code=400, detail="העובד/ת לא נמצא/ה")
        s.user_id = worker.id
    a, b = _times(settings, body.date or date.fromisoformat(cur["date"]), body.start or cur["start"], body.end or cur["end"])
    _no_overlap(db, ctx.studio_id, s.user_id, a, b, skip=s.id)
    s.starts_at, s.ends_at = a, b
    if body.note is not None:
        s.note = body.note.strip() or None
    s.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _out(s, tz)


@router.delete("/shifts/{shift_id}", status_code=204)
def delete_shift(shift_id: uuid.UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    _manager(db, ctx)
    s = db.get(ScheduledShift, shift_id)
    if s is None or s.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="המשמרת לא נמצאה")
    db.delete(s)
    db.commit()


class WeekIn(BaseModel):
    start: date


@router.post("/week/copy")
def copy_week(body: WeekIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """The week before's shifts into this week — the same days and hours; what's there already stays."""
    _manager(db, ctx)
    settings = db.get(StudioSettings, ctx.studio_id)
    tz = sch.tz_of(settings)
    ws = _week(body.start)
    prev = tz.localize(datetime(ws.year, ws.month, ws.day)) - timedelta(days=7)
    copied = 0
    for s in db.scalars(select(ScheduledShift).where(ScheduledShift.studio_id == ctx.studio_id, ScheduledShift.starts_at >= prev,
                                                     ScheduledShift.starts_at < prev + timedelta(days=7))).all():
        worker = db.get(User, s.user_id)
        if worker is None or not worker.is_active:
            continue
        a, b = s.starts_at + timedelta(days=7), s.ends_at + timedelta(days=7)
        clash = db.scalar(select(ScheduledShift.id).where(ScheduledShift.studio_id == ctx.studio_id, ScheduledShift.user_id == s.user_id,
                                                          ScheduledShift.starts_at < b, ScheduledShift.ends_at > a).limit(1))
        if clash:
            continue
        db.add(ScheduledShift(studio_id=ctx.studio_id, user_id=s.user_id, starts_at=a, ends_at=b, note=s.note, created_by=ctx.user_id))
        copied += 1
    db.commit()
    return {"copied": copied}


@router.post("/week/publish")
def publish_week(body: WeekIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    _manager(db, ctx)
    from app.services.activity_log import record
    ws = _week(body.start)
    told = sch.publish(db, ctx.studio_id, ws, ctx.user_id)
    record(db, ctx, "team", f"פרסום סידור העבודה לשבוע {ws:%d/%m} — {told} עובדים קיבלו הודעה")
    return {"told": told, "week_start": ws.isoformat()}


class ConstraintIn(BaseModel):
    date: _dt.date
    kind: str = ""
    note: str | None = Field(default=None, max_length=200)


@router.put("/constraints")
def set_constraint(body: ConstraintIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """The worker's own constraint for a day of a coming week, until its deadline."""
    if body.kind and body.kind not in sch.KINDS:
        raise HTTPException(status_code=400, detail="סוג אילוץ לא מוכר")
    settings = db.get(StudioSettings, ctx.studio_id)
    ws = _week(body.date)
    if datetime.now(timezone.utc) >= sch.deadline(settings, ws):
        raise HTTPException(status_code=400, detail="המועד להגשת אילוצים לשבוע הזה עבר — דברו עם בעל העסק")
    c = db.scalar(select(ShiftConstraint).where(ShiftConstraint.user_id == ctx.user_id, ShiftConstraint.day == body.date))
    if not body.kind:
        if c is not None:
            db.delete(c)
            db.commit()
        return {"date": body.date.isoformat(), "kind": ""}
    if c is None:
        c = ShiftConstraint(studio_id=ctx.studio_id, user_id=ctx.user_id, day=body.date, kind=body.kind)
        db.add(c)
    c.kind, c.note = body.kind, (body.note or "").strip() or None
    db.commit()
    return {"date": body.date.isoformat(), "kind": c.kind, "note": c.note or ""}


class Template(BaseModel):
    name: str = Field(max_length=30)
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")


class SettingsIn(BaseModel):
    templates: list[Template] | None = Field(default=None, max_length=8)
    deadline_day: int | None = Field(default=None, ge=0, le=6)
    deadline_hour: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")


@router.put("/settings")
def schedule_settings(body: SettingsIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    _manager(db, ctx)
    settings = db.get(StudioSettings, ctx.studio_id)
    if body.templates is not None:
        settings.shift_templates = json.dumps([t.model_dump() for t in body.templates], ensure_ascii=False)
    if body.deadline_day is not None:
        settings.constraints_deadline_day = body.deadline_day
    if body.deadline_hour is not None:
        settings.constraints_deadline_hour = body.deadline_hour
    db.commit()
    return {"templates": sch.templates(settings), "deadline_day": settings.constraints_deadline_day,
            "deadline_hour": settings.constraints_deadline_hour}
