import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db
from app.models.studio import Studio
from app.repositories.staff_repository import StaffRepository
from app.schemas.work_session import ClockStatusResponse, WorkSessionResponse, StaffPayrollSummary
from app.services.pdf_service import generate_payroll_pdf

router = APIRouter(prefix="/staff", tags=["Staff & Payroll"])


def get_staff_repo(db: Session = Depends(get_db)) -> StaffRepository:
    return StaffRepository(db)


@router.get("/clock-status", response_model=ClockStatusResponse)
def get_clock_status(
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: StaffRepository = Depends(get_staff_repo),
):
    """Check if the current user is currently clocked in."""
    session = repo.get_active_session(ctx.studio_id, ctx.user_id)
    return ClockStatusResponse(
        is_clocked_in=session is not None,
        active_session=WorkSessionResponse.model_validate(session) if session else None
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
):
    """Calculate payroll for all staff in the studio for the given period."""
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
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")

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
