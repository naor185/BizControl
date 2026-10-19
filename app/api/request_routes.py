"""Workers' requests (services/staff_requests.py) — in the plans with the attendance clock.

GET  /api/requests                 — mine; asked of me (a swap waiting for my answer); for who manages the team: waiting
                                     for a decision, and the last month's decided
GET  /api/requests/colleagues      — ?shift_id= : who can take it, and each one's published shifts that week (to trade)
POST /api/requests/swap            — {shift_id, target_user_id, target_shift_id?, note}
POST /api/requests/time-off        — {kind: vacation|sick|other, date_from, date_to, note}
POST /api/requests/{id}/answer     — the colleague: {accept}
POST /api/requests/{id}/decide     — the owner / a manager allowed the team: {approve, note}
POST /api/requests/{id}/cancel     — the worker, while it waits
"""
from __future__ import annotations

import datetime as _dt
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.features import require_module
from app.core.permissions import may_do
from app.models.schedule import ScheduledShift
from app.models.staff_request import StaffRequest
from app.models.user import User
from app.services import staff_requests as sr

router = APIRouter(prefix="/requests", tags=["Requests"], dependencies=[Depends(require_module("attendance"))])


def _run(fn):
    try:
        return fn()
    except sr.RequestError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _out(db: Session, r: StaffRequest) -> dict:
    who = db.get(User, r.user_id)
    other = db.get(User, r.target_user_id) if r.target_user_id else None
    out = {"id": str(r.id), "kind": r.kind, "status": r.status, "user_id": str(r.user_id), "name": sr._name(who),
           "target_user_id": str(r.target_user_id) if r.target_user_id else None, "target_name": sr._name(other),
           "summary": r.summary or "", "note": r.note or "", "decision_note": r.decision_note or "",
           "created_at": r.created_at.isoformat() if r.created_at else None}
    if r.kind in sr.TIME_OFF and r.date_from and r.date_to:
        out["shifts_during"] = [sr.shift_words(db, r.studio_id, s) for s in sr.shifts_during(db, r.studio_id, r.user_id, r.date_from, r.date_to)]
    return out


@router.get("")
def list_requests(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=30)
    mine = db.scalars(select(StaffRequest).where(StaffRequest.studio_id == ctx.studio_id, StaffRequest.user_id == ctx.user_id,
                                                 or_(StaffRequest.created_at >= since, StaffRequest.status.in_(("waiting_colleague", "waiting_owner"))))
                      .order_by(StaffRequest.created_at.desc())).all()
    to_me = db.scalars(select(StaffRequest).where(StaffRequest.studio_id == ctx.studio_id, StaffRequest.target_user_id == ctx.user_id,
                                                  StaffRequest.status == "waiting_colleague").order_by(StaffRequest.created_at)).all()
    out = {"mine": [_out(db, r) for r in mine], "to_me": [_out(db, r) for r in to_me]}
    if may_do(db, ctx.studio_id, ctx.role, "team"):
        out["waiting"] = [_out(db, r) for r in db.scalars(select(StaffRequest).where(
            StaffRequest.studio_id == ctx.studio_id, StaffRequest.status.in_(("waiting_owner", "waiting_colleague")))
            .order_by(StaffRequest.created_at)).all()]
        out["recent"] = [_out(db, r) for r in db.scalars(select(StaffRequest).where(
            StaffRequest.studio_id == ctx.studio_id, StaffRequest.status.notin_(("waiting_owner", "waiting_colleague")),
            StaffRequest.created_at >= since).order_by(StaffRequest.created_at.desc()).limit(40)).all()]
    return out


@router.get("/colleagues")
def colleagues(shift_id: uuid.UUID = Query(...), ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Who can take my shift, and each one's published shifts the same week (to trade, if wanted) — times only."""
    from app.services.schedule import is_published, tz_of, week_of
    mine = _run(lambda: sr._published_future_shift(db, ctx.studio_id, shift_id, ctx.user_id))
    tz = tz_of(sr._settings(db, ctx.studio_id))
    ws = week_of(mine.starts_at.astimezone(tz).date())
    first = tz.localize(datetime(ws.year, ws.month, ws.day))
    now = datetime.now(timezone.utc)
    team = db.scalars(select(User).where(User.studio_id == ctx.studio_id, User.is_active.is_(True), User.id != ctx.user_id,
                                         User.role.in_(("admin", "artist", "staff"))).order_by(User.display_name)).all()
    shifts = db.scalars(select(ScheduledShift).where(ScheduledShift.studio_id == ctx.studio_id, ScheduledShift.starts_at >= first,
                                                     ScheduledShift.starts_at < first + timedelta(days=7),
                                                     ScheduledShift.starts_at > now)).all() if is_published(db, ctx.studio_id, ws) else []
    return [{"id": str(u.id), "name": sr._name(u),
             "shifts": [{"id": str(s.id), "words": sr.shift_words(db, ctx.studio_id, s)} for s in shifts if s.user_id == u.id]}
            for u in team]


class SwapIn(BaseModel):
    shift_id: uuid.UUID
    target_user_id: uuid.UUID
    target_shift_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=300)


@router.post("/swap", status_code=201)
def ask_swap(body: SwapIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    r = _run(lambda: sr.ask_swap(db, ctx.studio_id, ctx.user_id, body.shift_id, body.target_user_id, body.target_shift_id, body.note))
    return _out(db, r)


class TimeOffIn(BaseModel):
    kind: str
    date_from: _dt.date
    date_to: _dt.date
    note: str | None = Field(default=None, max_length=300)


@router.post("/time-off", status_code=201)
def ask_time_off(body: TimeOffIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    r = _run(lambda: sr.ask_time_off(db, ctx.studio_id, ctx.user_id, body.kind, body.date_from, body.date_to, body.note))
    return _out(db, r)


class AnswerIn(BaseModel):
    accept: bool


@router.post("/{request_id}/answer")
def answer(request_id: uuid.UUID, body: AnswerIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return _out(db, _run(lambda: sr.answer_swap(db, ctx.studio_id, ctx.user_id, request_id, body.accept)))


class DecideIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=300)


@router.post("/{request_id}/decide")
def decide(request_id: uuid.UUID, body: DecideIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if not may_do(db, ctx.studio_id, ctx.role, "team"):
        raise HTTPException(status_code=403, detail="את הבקשות מאשרים בעל העסק ומי שמנהל את הצוות")
    from app.services.activity_log import record
    r = _run(lambda: sr.decide(db, ctx.studio_id, ctx.user_id, request_id, body.approve, body.note))
    out = _out(db, r)
    record(db, ctx, "team", f"{'אישור' if body.approve else 'דחיית'} בקשה של {out['name']}: {out['summary']}")
    return out


@router.post("/{request_id}/cancel")
def cancel(request_id: uuid.UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return _out(db, _run(lambda: sr.cancel(db, ctx.studio_id, ctx.user_id, request_id)))
