"""
The NFC attendance clock (app/services/nfc_clock.py) — a worker's own phone touching the sticker at the door.

GET  /api/nfc/status    — does the plan have the clock, is the barcode on; the owner (and a manager allowed the team)
                          also gets its link
POST /api/nfc/new-code  — the owner (or that manager) replaces the barcode — the old one stops working
POST /api/nfc/tap       — the barcode's code → clock the signed-in worker in, or out (the owner: "it works")
POST /api/nfc/undo      — a touch by mistake, taken back within two minutes
POST /api/nfc/to-break  — the clock-out just now was a break: the shift goes on, on a break since then (a scan on the
                          way back ends it)
GET  /api/nfc/presence  — who is clocked in right now

(It replaces a design that was never used — a personal tag per worker read by a device at the business; its tables
were never created in production.)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.permissions import may_do, require_permission
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.models.work_session import WorkSession
from app.repositories.staff_repository import StaffRepository
from app.services import nfc_clock

router = APIRouter(prefix="/nfc", tags=["NFC Attendance"])

REPEAT_WINDOW = timedelta(seconds=60)    # a second read within a minute (the phone read twice, the page reloaded) repeats
UNDO_WINDOW = timedelta(minutes=2)


class TapIn(BaseModel):
    code: str


class UndoIn(BaseModel):
    session_id: str


def _own_session(db: Session, ctx: AuthContext, session_id: str) -> WorkSession:
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="לא נמצא")
    s = db.get(WorkSession, sid)
    if s is None or s.studio_id != ctx.studio_id or s.user_id != ctx.user_id:
        raise HTTPException(status_code=404, detail="לא נמצא")
    return s


class PresenceOut(BaseModel):
    user_id: str
    user_name: str
    clocked_in_at: str
    duration_minutes: int                     # worked — the breaks not counted
    break_minutes: int = 0
    on_break_since: str | None = None


def _status(db: Session, ctx: AuthContext) -> dict:
    """A worker never gets the link: the barcode at the door is the proof they're there."""
    settings = db.get(StudioSettings, ctx.studio_id)
    included = nfc_clock.included(db, ctx.studio_id)
    out = {"included": included, "on": included and nfc_clock.on(settings),
           "from_opening": bool(getattr(settings, "clock_from_opening", True)), "opening": getattr(settings, "calendar_start_hour", "08:00")}
    if out["on"] and may_do(db, ctx.studio_id, ctx.role, "team"):
        out |= {"link": nfc_clock.link(settings), "name": db.get(Studio, ctx.studio_id).name}
    return out


@router.get("/status")
def nfc_status(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return _status(db, ctx)


class FromOpeningIn(BaseModel):
    on: bool


@router.post("/from-opening")
def nfc_from_opening(body: FromOpeningIn, ctx: AuthContext = Depends(require_permission("team")), db: Session = Depends(get_db)):
    """A clock-in before the opening hour counts from it (on) — or from the clock-in (off). From now on; past shifts as
    they were."""
    from app.services import activity_log
    settings = db.get(StudioSettings, ctx.studio_id)
    settings.clock_from_opening = body.on
    db.commit()
    activity_log.record(db, ctx, "attendance", "כניסה לפני שעת הפתיחה — " + ("נספרת משעת הפתיחה" if body.on else "נספרת מהכניסה"))
    return _status(db, ctx)


@router.post("/new-code")
def nfc_new_code(ctx: AuthContext = Depends(require_permission("team")), db: Session = Depends(get_db)):
    """The barcode got out (photographed, sent around) — a new one; the printed one and the sticker stop working."""
    from app.services import activity_log
    settings = db.get(StudioSettings, ctx.studio_id)
    if not nfc_clock.included(db, ctx.studio_id) or not nfc_clock.on(settings):
        raise HTTPException(status_code=400, detail="שעון הנוכחות בברקוד לא פעיל בעסק")
    nfc_clock.issue(settings)
    db.commit()
    activity_log.record(db, ctx, "attendance", "ברקוד חדש לשעון הנוכחות — הקודם הפסיק לעבוד")
    return _status(db, ctx)


def _answer(session: WorkSession, user: User, repeat: bool) -> dict:
    out = session.end_time is not None
    return {"action": "out" if out else "in", "at": (session.end_time if out else session.start_time).isoformat(),
            "name": user.display_name or user.email, "session_id": str(session.id), "repeat": repeat}


@router.post("/tap")
def nfc_tap(body: TapIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """The signed-in worker scanned the barcode (or touched the sticker): clocked in if out, out if in. The owner
    scanning it — to check it works — clocks nothing."""
    settings = db.get(StudioSettings, ctx.studio_id)
    if not nfc_clock.matches(settings, body.code):
        raise HTTPException(status_code=404, detail="הברקוד הזה לא שייך לעסק שלך — ודא/י שנכנסת לחשבון שלך בעסק הזה")
    if not nfc_clock.included(db, ctx.studio_id):
        raise HTTPException(status_code=403, detail="שעון הנוכחות לא כלול במסלול של העסק")
    user = db.get(User, ctx.user_id)
    now = datetime.now(timezone.utc)
    if not nfc_clock.clocks(db, ctx.studio_id, ctx.role):
        return {"action": "check", "at": now.isoformat(), "name": user.display_name or user.email, "session_id": "",
                "repeat": False}
    last = db.scalar(select(WorkSession).where(WorkSession.studio_id == ctx.studio_id, WorkSession.user_id == ctx.user_id)
                     .order_by(WorkSession.start_time.desc()).limit(1))
    if last is not None and now - (last.end_time or last.start_time) < REPEAT_WINDOW:
        return _answer(last, user, repeat=True)
    repo = StaffRepository(db)
    active = repo.get_active_session(ctx.studio_id, ctx.user_id)
    if active is not None and active.break_started_at is not None:        # back from a break — the shift goes on
        from app.repositories.staff_repository import end_break
        end_break(active, now)
        db.commit()
        return {"action": "back", "at": now.isoformat(), "name": user.display_name or user.email,
                "session_id": str(active.id), "repeat": False}
    session = repo.clock_out(ctx.studio_id, ctx.user_id) if active is not None else repo.clock_in(ctx.studio_id, ctx.user_id)
    return _answer(session, user, repeat=False)


@router.post("/to-break")
def nfc_to_break(body: UndoIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """"It was a break, not the end of the shift" — within two minutes of the clock-out: the shift is open again, on a
    break since the clock-out; the scan on the way back ends the break."""
    s = _own_session(db, ctx, body.session_id)
    now = datetime.now(timezone.utc)
    if s.end_time is None or now - s.end_time > UNDO_WINDOW:
        raise HTTPException(status_code=400, detail="אפשר רק בשתי הדקות שאחרי היציאה")
    if StaffRepository(db).get_active_session(ctx.studio_id, ctx.user_id):
        raise HTTPException(status_code=400, detail="יש כבר משמרת פתוחה")
    s.break_started_at, s.end_time, s.session_pay = s.end_time, None, 0
    db.commit()
    return {"action": "break", "at": s.break_started_at.isoformat(), "session_id": str(s.id)}


@router.post("/undo")
def nfc_undo(body: UndoIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """A touch by mistake: a clock-out reopens the shift, a clock-in is removed — within two minutes; later, the owner
    or a manager fixes it."""
    s = _own_session(db, ctx, body.session_id)
    now = datetime.now(timezone.utc)
    if s.end_time is not None and now - s.end_time <= UNDO_WINDOW:
        s.end_time = None
        s.session_pay = 0
        db.commit()
        return {"undone": "out"}
    if s.end_time is None and now - s.start_time <= UNDO_WINDOW:
        db.delete(s)
        db.commit()
        return {"undone": "in"}
    raise HTTPException(status_code=400, detail="אפשר לבטל רק בשתי הדקות הראשונות — בעל העסק או המנהל יכולים לתקן")


@router.get("/presence", response_model=list[PresenceOut])
def get_presence(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    sessions = db.scalars(
        select(WorkSession).where(
            WorkSession.studio_id == ctx.studio_id,
            WorkSession.end_time.is_(None),
        )
    ).all()

    result = []
    for s in sessions:
        user = db.get(User, s.user_id)
        if not user:
            continue
        until = s.break_started_at or now                # on a break: the count stopped when it started
        duration = int((until - s.start_time.replace(tzinfo=timezone.utc)).total_seconds() / 60) - (s.break_minutes or 0)
        result.append(PresenceOut(
            user_id=str(s.user_id),
            user_name=user.display_name or user.email,
            clocked_in_at=s.start_time.isoformat(),
            duration_minutes=max(duration, 0),
            break_minutes=s.break_minutes or 0,
            on_break_since=s.break_started_at.isoformat() if s.break_started_at else None,
        ))
    return result
