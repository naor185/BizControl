import io
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import pytz
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.permissions import MANAGEMENT as PAY_VIEWERS, may_do   # everyone's pay: see may_do(…, "money")
from app.db.deps import get_db
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.models.work_session import WorkSession
from app.repositories.staff_repository import StaffRepository, price_shift
from app.schemas.work_session import ClockStatusResponse, WorkSessionResponse, StaffPayrollSummary
from app.services.pdf_service import generate_payroll_pdf, generate_staff_pay_summary_pdf

router = APIRouter(prefix="/staff", tags=["Staff & Payroll"])


def _localize_payroll_range(db: Session, studio_id, start_date: datetime, end_date: datetime) -> tuple[datetime, datetime]:
    """
    start_date/end_date arrive as naive "wall clock" values (e.g. from
    team/payroll/page.tsx: "2026-09-01T00:00:00") that the frontend means as
    the studio's own local midnight-to-midnight, with no offset attached.
    Comparing them as-is against tz-aware UTC columns (WorkSession.start_time,
    Payment.created_at) silently misattributes anything near a local-midnight
    boundary to the wrong month/day — same class of bug already fixed in
    consultation_conversion — so localize to the studio's real timezone
    (same "settings.timezone or Asia/Jerusalem" convention used everywhere
    else, e.g. dashboard_routes.py) before they ever reach the repository.
    """
    settings = db.get(StudioSettings, studio_id)
    tz = pytz.timezone(settings.timezone if settings and settings.timezone else "Asia/Jerusalem")
    start = start_date if start_date.tzinfo else tz.localize(start_date)
    end = end_date if end_date.tzinfo else tz.localize(end_date)
    return start, end


def get_staff_repo(db: Session = Depends(get_db)) -> StaffRepository:
    return StaffRepository(db)


@router.get("/clock-status", response_model=ClockStatusResponse)
def get_clock_status(
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    """Check if the current user is currently clocked in."""
    from app.services import nfc_clock
    from app.services.message_worker import clock_in_needed
    session = repo.get_active_session(ctx.studio_id, ctx.user_id)
    user = db.get(User, ctx.user_id)
    return ClockStatusResponse(
        is_clocked_in=session is not None,
        active_session=WorkSessionResponse.model_validate(session) if session else None,
        pay_type=user.pay_type if user else "none",
        nfc=nfc_clock.on(db.get(StudioSettings, ctx.studio_id)),
        available=nfc_clock.clocks(db, ctx.studio_id, ctx.role),
        clock_in_needed=session is None and clock_in_needed(db, ctx.studio_id, ctx.user_id, ctx.role),
    )


def _may_clock_here(db: Session, ctx: AuthContext) -> None:
    """The header button: a worker or a manager, in a plan with the clock (services/nfc_clock.clocks). While the
    business has the barcode, its people clock in and out at the door — that's the proof they're there; the owner and
    the managers fix a time by hand."""
    from app.services import nfc_clock
    if ctx.role in ("owner", "superadmin"):
        raise HTTPException(status_code=403, detail="בעל העסק לא מחתים שעון נוכחות")
    if not nfc_clock.included(db, ctx.studio_id):
        raise HTTPException(status_code=403, detail="שעון הנוכחות לא כלול במסלול של העסק")
    if nfc_clock.on(db.get(StudioSettings, ctx.studio_id)):
        raise HTTPException(status_code=403, detail="בעסק הזה מחתימים כניסה ויציאה בסריקת הברקוד שבכניסה")


@router.post("/clock-in", response_model=WorkSessionResponse)
def clock_in(
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    """Clock in the current user."""
    _may_clock_here(db, ctx)
    return repo.clock_in(ctx.studio_id, ctx.user_id)


@router.post("/clock-out", response_model=WorkSessionResponse)
def clock_out(
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    """Clock out the current user."""
    _may_clock_here(db, ctx)
    session = repo.clock_out(ctx.studio_id, ctx.user_id)
    if not session:
        raise HTTPException(status_code=400, detail="Not currently clocked in")
    return session


# ── Shifts: the owner and the managers fix them (owner, 2026-10-13: "a worker forgot to clock in") ─────────────────────

class ShiftIn(BaseModel):
    user_id: Optional[uuid.UUID] = None       # adding: whose
    start_time: Optional[datetime] = None     # the studio's wall clock ("2026-10-13T09:00") or with an offset
    end_time: Optional[datetime] = None


def _manager(ctx: AuthContext, db: Session, worker_id=None) -> None:
    if not may_do(db, ctx.studio_id, ctx.role, "attendance"):
        raise HTTPException(status_code=403, detail="תיקון שעות נוכחות — רק בעל העסק או מנהל שהורשה")
    if ctx.role != "owner" and worker_id is not None and str(worker_id) == str(ctx.user_id):
        raise HTTPException(status_code=403, detail="את המשמרות שלך מתקן בעל העסק")


def _shift_words(db: Session, studio_id, s: WorkSession) -> str:
    """13.10 09:00–17:00 · 13.10 09:00–פתוחה"""
    from app.services.activity_log import at
    return f"{at(db, studio_id, s.start_time)}–{at(db, studio_id, s.end_time)[-5:] if s.end_time else 'פתוחה'}"


def _shift_out(s: WorkSession) -> dict:
    from app.repositories.staff_repository import paid_start
    hours = round(max((s.end_time - paid_start(s)).total_seconds(), 0) / 3600, 2) if s.end_time else None
    return {"id": str(s.id), "start_time": s.start_time.isoformat(), "end_time": s.end_time.isoformat() if s.end_time else None,
            "paid_from": s.paid_from.isoformat() if s.paid_from else None,
            "hours": hours, "pay": float(s.session_pay or 0), "fixed": s.fixed_by is not None}


def _times(db: Session, studio_id, start: datetime, end: datetime | None) -> tuple[datetime, datetime | None]:
    """The times as the studio's wall clock → checked: not in the future, the end after the start and within a day."""
    settings = db.get(StudioSettings, studio_id)
    tz = pytz.timezone(settings.timezone if settings and settings.timezone else "Asia/Jerusalem")
    start = start if start.tzinfo else tz.localize(start)
    end = None if end is None else (end if end.tzinfo else tz.localize(end))
    if start > datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="שעת הכניסה עוד לא הגיעה")
    if end is not None and not (start < end <= start + timedelta(hours=24)):
        raise HTTPException(status_code=400, detail="שעת היציאה צריכה להיות אחרי הכניסה, ובתוך 24 שעות")
    return start, end


@router.get("/shifts")
def list_shifts(user_id: uuid.UUID, start_date: datetime = Query(...), end_date: datetime = Query(...),
                ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """A worker's shifts in a period — the owner and the managers."""
    _manager(ctx, db)
    start, end = _localize_payroll_range(db, ctx.studio_id, start_date, end_date)
    rows = db.scalars(select(WorkSession).where(WorkSession.studio_id == ctx.studio_id, WorkSession.user_id == user_id,
                                                WorkSession.start_time >= start, WorkSession.start_time <= end)
                      .order_by(WorkSession.start_time.desc())).all()
    return [_shift_out(s) for s in rows]


@router.post("/shifts", status_code=201)
def add_shift(body: ShiftIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """A shift the worker forgot to clock — from when to when (or still on)."""
    _manager(ctx, db, body.user_id)
    worker = db.get(User, body.user_id) if body.user_id else None
    if worker is None or worker.studio_id != ctx.studio_id or body.start_time is None:
        raise HTTPException(status_code=400, detail="חסר העובד או שעת הכניסה")
    start, end = _times(db, ctx.studio_id, body.start_time, body.end_time)
    if end is None and StaffRepository(db).get_active_session(ctx.studio_id, worker.id):
        raise HTTPException(status_code=400, detail="לעובד כבר יש משמרת פתוחה")
    s = WorkSession(studio_id=ctx.studio_id, user_id=worker.id, start_time=start, end_time=end, fixed_by=ctx.user_id)
    price_shift(s, worker)
    db.add(s)
    db.commit()
    from app.services.activity_log import record
    record(db, ctx, "attendance", f"הוספת משמרת ל{worker.display_name or worker.email}: {_shift_words(db, ctx.studio_id, s)}")
    return _shift_out(s)


@router.patch("/shifts/{shift_id}")
def fix_shift(shift_id: uuid.UUID, body: ShiftIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """A wrong time, a forgotten clock-out — the pay follows."""
    _manager(ctx, db)
    s = db.get(WorkSession, shift_id)
    if s is None or s.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="המשמרת לא נמצאה")
    _manager(ctx, db, s.user_id)
    was = _shift_words(db, ctx.studio_id, s)
    data = body.model_dump(exclude_unset=True)
    start, end = _times(db, ctx.studio_id, data.get("start_time") or s.start_time,
                        data["end_time"] if "end_time" in data else s.end_time)
    s.start_time, s.end_time, s.fixed_by = start, end, ctx.user_id
    s.paid_from = None                                   # a time fixed by hand counts as it is
    worker = db.get(User, s.user_id)
    price_shift(s, worker)
    db.commit()
    from app.services.activity_log import record
    record(db, ctx, "attendance", f"תיקון משמרת של {worker.display_name or worker.email}: {was} ← {_shift_words(db, ctx.studio_id, s)}")
    return _shift_out(s)


@router.delete("/shifts/{shift_id}", status_code=204)
def remove_shift(shift_id: uuid.UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    _manager(ctx, db)
    s = db.get(WorkSession, shift_id)
    if s is None or s.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="המשמרת לא נמצאה")
    _manager(ctx, db, s.user_id)
    from app.services.activity_log import name_of, record
    words = f"מחיקת משמרת של {name_of(db, s.user_id)}: {_shift_words(db, ctx.studio_id, s)}"
    db.delete(s)
    db.commit()
    record(db, ctx, "attendance", words)


@router.get("/payroll", response_model=StaffPayrollSummary)
def get_payroll(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    """Calculate payroll for all staff in the studio for the given period."""
    if not may_do(db, ctx.studio_id, ctx.role, "money"):      # pay — the owner, or a manager allowed money
        raise HTTPException(status_code=403, detail="Forbidden")
    start_date, end_date = _localize_payroll_range(db, ctx.studio_id, start_date, end_date)
    items = repo.get_user_payroll_summary(ctx.studio_id, start_date, end_date)
    from decimal import Decimal
    grand_total = sum((item["total_pay"] for item in items), Decimal("0.00"))

    return StaffPayrollSummary(
        items=items,
        grand_total=grand_total,
        period_start=start_date,
        period_end=end_date
    )


class AccountantSendIn(BaseModel):
    year: int
    month: int


@router.get("/payroll/accountant")
def payroll_accountant(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Where the month's hours and pay go: the accountant's address, sent by itself on the 1st or not, the last month."""
    if not may_do(db, ctx.studio_id, ctx.role, "money"):
        raise HTTPException(status_code=403, detail="Forbidden")
    from app.services.payroll_report import accountant_email
    settings = db.get(StudioSettings, ctx.studio_id)
    return {"email": accountant_email(db, ctx.studio_id), "auto": bool(settings and settings.payroll_to_accountant_auto),
            "last_auto": settings.payroll_sent_month if settings else None}


@router.post("/payroll/accountant/auto")
def payroll_accountant_auto(body: dict, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """On the 1st of each month, the month before to the accountant — by itself."""
    if not may_do(db, ctx.studio_id, ctx.role, "money"):
        raise HTTPException(status_code=403, detail="Forbidden")
    from app.services.activity_log import record
    settings = db.get(StudioSettings, ctx.studio_id)
    settings.payroll_to_accountant_auto = bool(body.get("on"))
    db.commit()
    record(db, ctx, "money", "שעות ושכר לרואה החשבון בראשון לחודש — " + ("מופעל" if settings.payroll_to_accountant_auto else "כבוי"))
    return payroll_accountant(ctx, db)


@router.post("/payroll/send-to-accountant")
def payroll_send_to_accountant(body: AccountantSendIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """The month's hours and pay to the accountant, now — the team's report (PDF) and every shift (Excel)."""
    if not may_do(db, ctx.studio_id, ctx.role, "money"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not (1 <= body.month <= 12):
        raise HTTPException(status_code=400, detail="חודש לא תקין")
    from app.services import payroll_report
    from app.services.activity_log import record
    try:
        out = payroll_report.send(db, ctx.studio_id, body.year, body.month)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    record(db, ctx, "money", f"שעות ושכר {out['month']} נשלחו לרואה החשבון ({out['to']})")
    return out


@router.get("/today")
def staff_today(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Today on the workers center: who is on shift (and since when), who has appointments today and hasn't clocked
    in (and the first one's time), the shifts that ended today (hours from when they count). For who manages the team."""
    if not may_do(db, ctx.studio_id, ctx.role, "team"):
        raise HTTPException(status_code=403, detail="Forbidden")
    from sqlalchemy import func as _func
    from app.models.appointment import Appointment
    from app.repositories.staff_repository import paid_start
    from app.services import nfc_clock
    settings = db.get(StudioSettings, ctx.studio_id)
    tz = pytz.timezone((settings.timezone if settings else None) or "Asia/Jerusalem")
    day = datetime.now(tz).date()
    start = tz.localize(datetime(day.year, day.month, day.day))
    end = start + timedelta(days=1)
    team = {u.id: u for u in db.scalars(select(User).where(User.studio_id == ctx.studio_id, User.is_active.is_(True),
                                                             User.role != "owner")).all()}
    name = lambda uid: (team[uid].display_name or team[uid].email) if uid in team else ""
    sessions = db.scalars(select(WorkSession).where(WorkSession.studio_id == ctx.studio_id,
                                                    (WorkSession.end_time.is_(None)) | (WorkSession.start_time >= start))
                          .order_by(WorkSession.start_time)).all()
    working = [{"user_id": str(s.user_id), "name": name(s.user_id), "since": s.start_time.isoformat()}
               for s in sessions if s.end_time is None and s.user_id in team]
    done = [{"user_id": str(s.user_id), "name": name(s.user_id), "start": s.start_time.isoformat(), "end": s.end_time.isoformat(),
             "hours": round(max((s.end_time - paid_start(s)).total_seconds(), 0) / 3600, 2)}
            for s in sessions if s.end_time is not None and s.start_time >= start and s.user_id in team]
    clocked = {s.user_id for s in sessions if s.end_time is None or s.start_time >= start}
    missing = []
    if nfc_clock.included(db, ctx.studio_id):
        firsts = db.execute(select(Appointment.artist_id, _func.min(Appointment.starts_at))
                            .where(Appointment.studio_id == ctx.studio_id, Appointment.status == "scheduled",
                                   Appointment.starts_at >= start, Appointment.starts_at < end, Appointment.artist_id.is_not(None))
                            .group_by(Appointment.artist_id)).all()
        by = {str(uid): {"user_id": str(uid), "name": name(uid), "first_at": first.isoformat(), "kind": "appointment", "late_min": 0}
              for uid, first in firsts if uid in team and uid not in clocked}
        # a published shift today not clocked in to yet — late once its allowed minutes passed (services/attendance_report.py)
        from app.services.attendance_report import check_shifts
        for c in check_shifts(db, ctx.studio_id, start, end, settings):
            s = c["shift"]
            if c["status"] not in ("upcoming", "waiting", "late_now") or s.user_id not in team:
                continue
            m = by.get(str(s.user_id))
            if m is None or c["late_min"] or s.starts_at < datetime.fromisoformat(m["first_at"]):
                by[str(s.user_id)] = {"user_id": str(s.user_id), "name": name(s.user_id), "first_at": s.starts_at.isoformat(),
                                      "kind": "shift", "late_min": c["late_min"]}
        missing = sorted(by.values(), key=lambda m: m["first_at"])
    return {"working": working, "missing": missing, "done": done}


@router.get("/payroll/pdf")
def download_payroll_pdf(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    if not may_do(db, ctx.studio_id, ctx.role, "money"):      # pay — the owner, or a manager allowed money
        raise HTTPException(status_code=403, detail="Forbidden")

    start_date, end_date = _localize_payroll_range(db, ctx.studio_id, start_date, end_date)
    items = repo.get_user_payroll_summary(ctx.studio_id, start_date, end_date)
    from decimal import Decimal
    grand_total = float(sum((item["total_pay"] for item in items), Decimal("0.00")))

    studio = db.get(Studio, ctx.studio_id)
    studio_name = studio.name if studio else "Studio"

    pdf_bytes = generate_payroll_pdf(
        items=[dict(i) for i in items],
        grand_total=grand_total,
        period_start=start_date,
        period_end=end_date,
        studio_name=studio_name,
    )

    filename = f"payroll_{start_date.strftime('%Y%m%d')}_{end_date.strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/payroll/{user_id}/pdf")
def download_staff_pay_summary_pdf(
    user_id: uuid.UUID,
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    """One worker's pay summary for the period — the same sums as the team's report, and every shift."""
    if not may_do(db, ctx.studio_id, ctx.role, "money"):      # pay — the owner, or a manager allowed money
        raise HTTPException(status_code=403, detail="Forbidden")
    start_date, end_date = _localize_payroll_range(db, ctx.studio_id, start_date, end_date)
    item = next((i for i in repo.get_user_payroll_summary(ctx.studio_id, start_date, end_date) if i["user_id"] == user_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="העובד/ת לא נמצא/ה")

    from app.services.payroll_report import shift_rows
    # the start as counted (a clock-in before the opening hour counts from it — services/nfc_clock.paid_from)
    shifts = [{**r, "start": r["counted_from"] or r["start"]}
              for r in shift_rows(db, ctx.studio_id, start_date, end_date, user_id=user_id)]

    studio = db.get(Studio, ctx.studio_id)
    pdf_bytes = generate_staff_pay_summary_pdf(dict(item), shifts, start_date, end_date, studio.name if studio else "")
    filename = f"pay_{start_date.strftime('%Y%m')}_{str(user_id)[:8]}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
