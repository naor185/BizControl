from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.deps import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.payment import Payment
from app.schemas.payment import PaymentCreate, PaymentOut, AppointmentBalanceOut
from app.services.payment_service import PaymentService
from app.crud.payment import create_payment, list_payments, appointment_balance

router = APIRouter(prefix="/payments", tags=["Payments"])

@router.post("", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
def create(payload: PaymentCreate, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        return create_payment(db, ctx.studio_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.get("", response_model=list[PaymentOut])
def list_(
    appointment_id: UUID | None = Query(default=None),
    client_id: UUID | None = Query(default=None),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    stmt = select(Payment).where(Payment.studio_id == ctx.studio_id)
    if appointment_id:
        stmt = stmt.where(Payment.appointment_id == appointment_id)
    if client_id:
        stmt = stmt.where(Payment.client_id == client_id)
    stmt = stmt.options(joinedload(Payment.client)).order_by(Payment.created_at.desc())
    return list(db.scalars(stmt).all())

@router.delete("/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(
    payment_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    service = PaymentService(db)
    ok = service.delete_payment(ctx.studio_id, payment_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Payment {payment_id} not found")
    return None

@router.get("/appointments/{appointment_id}/balance", response_model=AppointmentBalanceOut)
def balance(appointment_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    res = appointment_balance(db, ctx.studio_id, appointment_id)
    if res is None:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return res
