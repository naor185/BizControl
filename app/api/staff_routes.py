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
from app.services.pdf_service import generate_payroll_pdf

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
    session = repo.get_active_session(ctx.studio_id, ctx.user_id)
    user = db.get(User, ctx.user_id)
    return ClockStatusResponse(
        is_clocked_in=session is not None,
        active_session=WorkSessionResponse.model_validate(session) if session else None,
        pay_type=user.pay_type if user else "none",
    )


@router.post("/clock-in", response_model=WorkSessionResponse)
def clock_in(
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
):
    """Clock in the current user."""
    return repo.clock_in(ctx.studio_id, ctx.user_id)


@router.post("/clock-out", response_model=WorkSessionResponse)
def clock_out(
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
):
    """Clock out the current user."""
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
