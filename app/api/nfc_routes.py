"""
NFC Attendance API

POST /api/nfc/scan          — scan NFC tag → auto clock-in or clock-out
GET  /api/nfc/tags          — list all NFC tags for this studio (admin)
POST /api/nfc/tags          — assign NFC UID to an employee (admin)
DELETE /api/nfc/tags/{id}   — remove NFC tag (admin)
GET  /api/nfc/presence      — who is currently clocked in (live view)
GET  /api/nfc/today         — today's attendance log
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.employee_nfc_tag import EmployeeNfcTag
from app.models.attendance_log import AttendanceLog
from app.models.user import User
from app.models.work_session import WorkSession

router = APIRouter(prefix="/nfc", tags=["NFC Attendance"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class NfcScanIn(BaseModel):
    nfc_uid: str
    device_info: Optional[str] = None


class AssignTagIn(BaseModel):
    user_id: str
    nfc_uid: str
    label: Optional[str] = None


class TagOut(BaseModel):
    id: str
    user_id: str
    user_name: str
    nfc_uid: str
    label: Optional[str]
    created_at: str


class PresenceOut(BaseModel):
    user_id: str
    user_name: str
    clocked_in_at: str
    duration_minutes: int


class AttendanceOut(BaseModel):
    id: str
    user_id: str
    user_name: str
    event: str
    nfc_uid: Optional[str]
    created_at: str


# ── NFC Scan (public-ish — validated by studio NFC UID match) ──────────────────

@router.post("/scan")
def nfc_scan(
    body: NfcScanIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Scan NFC tag → clock in if out, clock out if in."""
    tag = db.scalar(
        select(EmployeeNfcTag).where(
            EmployeeNfcTag.nfc_uid == body.nfc_uid.strip().upper(),
            EmployeeNfcTag.studio_id == ctx.studio_id,
        )
    )
    if not tag:
        raise HTTPException(status_code=404, detail="תג NFC לא מוכר בסטודיו זה")

    user = db.get(User, tag.user_id)
    if not user or user.studio_id != ctx.studio_id:
        raise HTTPException(status_code=403, detail="עובד לא שייך לסטודיו זה")

    now = datetime.now(timezone.utc)

    # Check current clock status (open work session)
    open_session = db.scalar(
        select(WorkSession).where(
            WorkSession.studio_id == ctx.studio_id,
            WorkSession.user_id == tag.user_id,
            WorkSession.end_time.is_(None),
        )
    )

    if open_session:
        # Clock out
        open_session.end_time = now
        event = "clock_out"
        action = "יציאה"
    else:
        # Clock in
        db.add(WorkSession(studio_id=ctx.studio_id, user_id=tag.user_id, start_time=now))
        event = "clock_in"
        action = "כניסה"

    db.add(AttendanceLog(
        studio_id=ctx.studio_id,
        user_id=tag.user_id,
        nfc_uid=body.nfc_uid.strip().upper(),
        event=event,
        device_info=body.device_info,
        clock_in=now if event == "clock_in" else None,
        clock_out=now if event == "clock_out" else None,
    ))
    db.commit()

    return {
        "action": action,
        "event": event,
        "user_name": user.display_name or user.email,
        "timestamp": now.isoformat(),
    }


# ── Presence (who is in right now) ────────────────────────────────────────────

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


# ── Today's log ───────────────────────────────────────────────────────────────

@router.get("/today", response_model=list[AttendanceOut])
def get_today_attendance(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    logs = db.scalars(
        select(AttendanceLog).where(
            AttendanceLog.studio_id == ctx.studio_id,
            AttendanceLog.created_at >= since,
        ).order_by(AttendanceLog.created_at.desc())
    ).all()

    result = []
    for log in logs:
        user = db.get(User, log.user_id)
        result.append(AttendanceOut(
            id=str(log.id),
            user_id=str(log.user_id),
            user_name=user.display_name or user.email if user else "—",
            event=log.event,
            nfc_uid=log.nfc_uid,
            created_at=log.created_at.isoformat(),
        ))
    return result


# ── Tag management (admin/owner) ──────────────────────────────────────────────

@router.get("/tags", response_model=list[TagOut])
def list_tags(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="אין הרשאה")
    tags = db.scalars(
        select(EmployeeNfcTag).where(EmployeeNfcTag.studio_id == ctx.studio_id)
    ).all()
    result = []
    for t in tags:
        user = db.get(User, t.user_id)
        result.append(TagOut(
            id=str(t.id),
            user_id=str(t.user_id),
            user_name=user.display_name or user.email if user else "—",
            nfc_uid=t.nfc_uid,
            label=t.label,
            created_at=t.created_at.isoformat(),
        ))
    return result


@router.post("/tags", response_model=TagOut)
def assign_tag(
    body: AssignTagIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="אין הרשאה")

    uid = body.nfc_uid.strip().upper()

    existing = db.scalar(select(EmployeeNfcTag).where(EmployeeNfcTag.nfc_uid == uid))
    if existing:
        raise HTTPException(status_code=409, detail="תג NFC זה כבר בשימוש")

    user_id = uuid.UUID(body.user_id)
    user = db.get(User, user_id)
    if not user or user.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="עובד לא נמצא")

    tag = EmployeeNfcTag(studio_id=ctx.studio_id, user_id=user_id, nfc_uid=uid, label=body.label)
    db.add(tag)
    db.commit()
    db.refresh(tag)

    return TagOut(
        id=str(tag.id),
        user_id=str(tag.user_id),
        user_name=user.display_name or user.email,
        nfc_uid=tag.nfc_uid,
        label=tag.label,
        created_at=tag.created_at.isoformat(),
    )


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="אין הרשאה")
    tag = db.get(EmployeeNfcTag, tag_id)
    if not tag or tag.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="תג לא נמצא")
    db.delete(tag)
    db.commit()
    return {"ok": True}
