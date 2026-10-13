"""
The NFC attendance clock (app/services/nfc_clock.py) — a worker's own phone touching the sticker at the door.

GET  /api/nfc/status    — is the clock on for this business (no code: only the superadmin sees it)
POST /api/nfc/tap       — the sticker's code → clock the signed-in worker in, or out
POST /api/nfc/undo      — a touch by mistake, taken back within two minutes
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


class PresenceOut(BaseModel):
    user_id: str
    user_name: str
    clocked_in_at: str
    duration_minutes: int


@router.get("/status")
def nfc_status(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return {"on": nfc_clock.on(db.get(StudioSettings, ctx.studio_id))}


def _answer(session: WorkSession, user: User, repeat: bool) -> dict:
    out = session.end_time is not None
    return {"action": "out" if out else "in", "at": (session.end_time if out else session.start_time).isoformat(),
            "name": user.display_name or user.email, "session_id": str(session.id), "repeat": repeat}


@router.post("/tap")
def nfc_tap(body: TapIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """The signed-in worker touched the sticker: clocked in if out, out if in."""
    settings = db.get(StudioSettings, ctx.studio_id)
    if not nfc_clock.matches(settings, body.code):
        raise HTTPException(status_code=404, detail="המדבקה הזו לא שייכת לעסק שלך — ודא/י שנכנסת לחשבון שלך בעסק הזה")
    user = db.get(User, ctx.user_id)
    now = datetime.now(timezone.utc)
    last = db.scalar(select(WorkSession).where(WorkSession.studio_id == ctx.studio_id, WorkSession.user_id == ctx.user_id)
                     .order_by(WorkSession.start_time.desc()).limit(1))
    if last is not None and now - (last.end_time or last.start_time) < REPEAT_WINDOW:
        return _answer(last, user, repeat=True)
    repo = StaffRepository(db)
    session = repo.clock_out(ctx.studio_id, ctx.user_id) if repo.get_active_session(ctx.studio_id, ctx.user_id) \
        else repo.clock_in(ctx.studio_id, ctx.user_id)
    return _answer(session, user, repeat=False)


@router.post("/undo")
def nfc_undo(body: UndoIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """A touch by mistake: a clock-out reopens the shift, a clock-in is removed — within two minutes; later, the owner
    or a manager fixes it."""
    try:
        sid = uuid.UUID(body.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="לא נמצא")
    s = db.get(WorkSession, sid)
    if s is None or s.studio_id != ctx.studio_id or s.user_id != ctx.user_id:
        raise HTTPException(status_code=404, detail="לא נמצא")
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
        duration = int((now - s.start_time.replace(tzinfo=timezone.utc)).total_seconds() / 60)
        result.append(PresenceOut(
            user_id=str(s.user_id),
            user_name=user.display_name or user.email,
            clocked_in_at=s.start_time.isoformat(),
            duration_minutes=duration,
        ))
    return result
