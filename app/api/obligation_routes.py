"""
Financial Obligations API
Routes for managing recurring payment obligations (loans, debts, receivables).
Creating an obligation auto-generates a monthly recurring calendar task.
"""
from __future__ import annotations

import math
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.financial_obligation import FinancialObligation
from app.models.task import Task

router = APIRouter(prefix="/obligations", tags=["Obligations"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ObligationCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    counterparty: Optional[str] = None
    direction: str = Field(..., pattern="^(incoming|outgoing)$")
    total_amount_cents: int = Field(..., gt=0)
    monthly_payment_cents: int = Field(..., gt=0)
    day_of_month: int = Field(..., ge=1, le=28)
    start_date: date
    color: Optional[str] = "#f97316"
    notes: Optional[str] = None


class ObligationUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    counterparty: Optional[str] = None
    notes: Optional[str] = None
    total_amount_cents: Optional[int] = Field(default=None, gt=0)
    monthly_payment_cents: Optional[int] = Field(default=None, gt=0)
    day_of_month: Optional[int] = Field(default=None, ge=1, le=28)
    color: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(active|paused|completed)$")


class ObligationOut(BaseModel):
    id: str
    title: str
    counterparty: Optional[str]
    direction: str
    total_amount_cents: int
    monthly_payment_cents: int
    day_of_month: int
    start_date: date
    months_paid: int
    months_total: int
    months_remaining: int
    amount_paid_cents: int
    amount_remaining_cents: int
    status: str
    color: str
    notes: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


def _to_out(ob: FinancialObligation) -> ObligationOut:
    months_total = math.ceil(ob.total_amount_cents / ob.monthly_payment_cents)
    months_paid = ob.months_paid
    months_remaining = max(0, months_total - months_paid)
    amount_paid = months_paid * ob.monthly_payment_cents
    amount_remaining = max(0, ob.total_amount_cents - amount_paid)
    return ObligationOut(
        id=str(ob.id),
        title=ob.title,
        counterparty=ob.counterparty,
        direction=ob.direction,
        total_amount_cents=ob.total_amount_cents,
        monthly_payment_cents=ob.monthly_payment_cents,
        day_of_month=ob.day_of_month,
        start_date=ob.start_date,
        months_paid=months_paid,
        months_total=months_total,
        months_remaining=months_remaining,
        amount_paid_cents=amount_paid,
        amount_remaining_cents=amount_remaining,
        status=ob.status,
        color=ob.color,
        notes=ob.notes,
        created_at=ob.created_at.isoformat(),
    )


def _make_task(ob: FinancialObligation, studio_id: uuid.UUID) -> Task:
    """Create a monthly recurring calendar task for this obligation."""
    months_total = math.ceil(ob.total_amount_cents / ob.monthly_payment_cents)
    # end date = start_date + months_total months
    start = ob.start_date
    end_month = start.month + months_total - 1
    end_year = start.year + (end_month - 1) // 12
    end_month = ((end_month - 1) % 12) + 1
    end_date = date(end_year, end_month, ob.day_of_month)

    arrow = "⬅️" if ob.direction == "incoming" else "➡️"
    amount_ils = ob.monthly_payment_cents / 100
    task_title = f"{arrow} {ob.title} — ₪{amount_ils:,.0f}"

    return Task(
        studio_id=studio_id,
        title=task_title,
        task_date=None,
        recurrence_type="monthly",
        recurrence_day=ob.day_of_month,
        recurrence_end_date=end_date,
        color=ob.color,
        notes=ob.notes,
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ObligationOut])
def list_obligations(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(FinancialObligation)
        .where(FinancialObligation.studio_id == ctx.studio_id)
        .order_by(FinancialObligation.created_at.desc())
    ).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=ObligationOut, status_code=201)
def create_obligation(
    body: ObligationCreate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    ob = FinancialObligation(
        studio_id=ctx.studio_id,
        title=body.title,
        counterparty=body.counterparty,
        direction=body.direction,
        total_amount_cents=body.total_amount_cents,
        monthly_payment_cents=body.monthly_payment_cents,
        day_of_month=body.day_of_month,
        start_date=body.start_date,
        color=body.color or "#f97316",
        notes=body.notes,
    )
    db.add(ob)
    db.flush()  # get ob.id

    # Auto-create calendar task
    task = _make_task(ob, ctx.studio_id)
    db.add(task)
    db.flush()
    ob.task_id = task.id

    db.commit()
    db.refresh(ob)
    return _to_out(ob)


@router.patch("/{ob_id}", response_model=ObligationOut)
def update_obligation(
    ob_id: uuid.UUID,
    body: ObligationUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    ob = db.get(FinancialObligation, ob_id)
    if not ob or ob.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="לא נמצא")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ob, k, v)

    # Sync linked task whenever any relevant field changes
    if ob.task_id and any(k in body.model_dump(exclude_unset=True) for k in ("title", "color", "monthly_payment_cents", "day_of_month", "total_amount_cents", "notes")):
        task = db.get(Task, ob.task_id)
        if task:
            updated = _make_task(ob, ctx.studio_id)
            task.title = updated.title
            task.color = updated.color
            task.recurrence_day = updated.recurrence_day
            task.recurrence_end_date = updated.recurrence_end_date
            task.notes = updated.notes

    db.commit()
    db.refresh(ob)
    return _to_out(ob)


@router.post("/{ob_id}/mark-paid", response_model=ObligationOut)
def mark_paid(
    ob_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Record one monthly payment. Optionally creates an expense record."""
    ob = db.get(FinancialObligation, ob_id)
    if not ob or ob.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="לא נמצא")
    if ob.status != "active":
        raise HTTPException(status_code=400, detail="ההתחייבות אינה פעילה")

    months_total = math.ceil(ob.total_amount_cents / ob.monthly_payment_cents)
    if ob.months_paid >= months_total:
        raise HTTPException(status_code=400, detail="כל התשלומים בוצעו")

    ob.months_paid += 1

    # Auto-create expense for outgoing obligations
    if ob.direction == "outgoing":
        try:
            from app.models.expense import Expense
            expense = Expense(
                studio_id=ctx.studio_id,
                description=f"{ob.title} — תשלום {ob.months_paid}/{months_total}",
                amount=ob.monthly_payment_cents / 100,
                category="התחייבות",
                expense_date=date.today(),
            )
            db.add(expense)
        except Exception:
            pass  # expense creation is best-effort

    # Auto-complete when fully paid
    if ob.months_paid >= months_total:
        ob.status = "completed"

    db.commit()
    db.refresh(ob)
    return _to_out(ob)


@router.post("/{ob_id}/unmark-paid", response_model=ObligationOut)
def unmark_paid(
    ob_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    ob = db.get(FinancialObligation, ob_id)
    if not ob or ob.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="לא נמצא")

    if ob.months_paid <= 0:
        raise HTTPException(status_code=400, detail="אין תשלומים לבטל")

    ob.months_paid -= 1
    if ob.status == "completed":
        ob.status = "active"

    db.commit()
    db.refresh(ob)
    return _to_out(ob)


@router.delete("/{ob_id}", status_code=204)
def delete_obligation(
    ob_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    ob = db.get(FinancialObligation, ob_id)
    if not ob or ob.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="לא נמצא")

    # Delete the linked calendar task too
    if ob.task_id:
        task = db.get(Task, ob.task_id)
        if task:
            db.delete(task)

    db.delete(ob)
    db.commit()
