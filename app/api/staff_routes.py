import io
import uuid
from datetime import datetime, timezone
from typing import Optional

import pytz
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.permissions import MANAGEMENT as PAY_VIEWERS   # everyone's pay: the owner and the managers only
from app.db.deps import get_db
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.repositories.staff_repository import StaffRepository
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
    session = repo.get_active_session(ctx.studio_id, ctx.user_id)
    user = db.get(User, ctx.user_id)
    return ClockStatusResponse(
        is_clocked_in=session is not None,
        active_session=WorkSessionResponse.model_validate(session) if session else None,
        pay_type=user.pay_type if user else "none",
        nfc=nfc_clock.on(db.get(StudioSettings, ctx.studio_id)),
    )


def _not_while_nfc(db: Session, studio_id) -> None:
    """While the business has the NFC clock, its people clock in and out at the sticker — that's the proof they're
    there; the owner and the managers fix a time by hand."""
    from app.services import nfc_clock
    if nfc_clock.on(db.get(StudioSettings, studio_id)):
        raise HTTPException(status_code=403, detail="בעסק הזה מחתימים כניסה ויציאה בנגיעה במדבקת ה-NFC שבכניסה")


@router.post("/clock-in", response_model=WorkSessionResponse)
def clock_in(
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    """Clock in the current user."""
    _not_while_nfc(db, ctx.studio_id)
    return repo.clock_in(ctx.studio_id, ctx.user_id)


@router.post("/clock-out", response_model=WorkSessionResponse)
def clock_out(
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    """Clock out the current user."""
    _not_while_nfc(db, ctx.studio_id)
    session = repo.clock_out(ctx.studio_id, ctx.user_id)
    if not session:
        raise HTTPException(status_code=400, detail="Not currently clocked in")
    return session


@router.get("/payroll", response_model=StaffPayrollSummary)
def get_payroll(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    """Calculate payroll for all staff in the studio for the given period."""
    if ctx.role not in PAY_VIEWERS:
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


@router.get("/payroll/pdf")
def download_payroll_pdf(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
    db: Session = Depends(get_db),
):
    if ctx.role not in PAY_VIEWERS:
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
    if ctx.role not in PAY_VIEWERS:
        raise HTTPException(status_code=403, detail="Forbidden")
    start_date, end_date = _localize_payroll_range(db, ctx.studio_id, start_date, end_date)
    item = next((i for i in repo.get_user_payroll_summary(ctx.studio_id, start_date, end_date) if i["user_id"] == user_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="העובד/ת לא נמצא/ה")

    from sqlalchemy import select as _select
    from app.models.work_session import WorkSession
    settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
    tz = pytz.timezone((settings.timezone if settings else None) or "Asia/Jerusalem")
    rows = db.scalars(_select(WorkSession).where(
        WorkSession.user_id == user_id, WorkSession.start_time >= start_date, WorkSession.start_time <= end_date,
        WorkSession.end_time.is_not(None)).order_by(WorkSession.start_time)).all()
    shifts = [{"date": w.start_time.astimezone(tz).strftime("%d/%m/%Y"), "start": w.start_time.astimezone(tz).strftime("%H:%M"),
               "end": w.end_time.astimezone(tz).strftime("%H:%M"),
               "hours": (w.end_time - w.start_time).total_seconds() / 3600, "pay": float(w.session_pay or 0)} for w in rows]

    studio = db.get(Studio, ctx.studio_id)
    pdf_bytes = generate_staff_pay_summary_pdf(dict(item), shifts, start_date, end_date, studio.name if studio else "")
    filename = f"pay_{start_date.strftime('%Y%m')}_{str(user_id)[:8]}.pdf"
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
