from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload
import io

from app.db.deps import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.payment import Payment
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.studio import Studio
from app.schemas.payment import PaymentCreate, PaymentOut, AppointmentBalanceOut
from app.services.payment_service import PaymentService
from app.crud.payment import create_payment, list_payments, appointment_balance
from app.models.studio_settings import StudioSettings
from app.services.pdf_service import generate_receipt_pdf, generate_invoice_pdf

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

@router.get("/{payment_id}/receipt")
def download_receipt(
    payment_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    payment = db.scalar(select(Payment).where(Payment.id == payment_id, Payment.studio_id == ctx.studio_id))
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    appointment = db.get(Appointment, payment.appointment_id) if payment.appointment_id else None
    client = db.get(Client, payment.client_id) if payment.client_id else None
    studio = db.get(Studio, ctx.studio_id)

    pdf_bytes = generate_receipt_pdf(
        payment=payment,
        appointment=appointment,
        client=client,
        studio_name=studio.name if studio else "Studio",
        studio_slug=studio.slug if studio else "",
    )

    short_id = str(payment_id)[:8].upper()
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="receipt_{short_id}.pdf"'},
    )


@router.get("/{payment_id}/invoice")
def download_invoice(
    payment_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    payment = db.scalar(select(Payment).where(Payment.id == payment_id, Payment.studio_id == ctx.studio_id))
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    appointment = db.get(Appointment, payment.appointment_id) if payment.appointment_id else None
    client      = db.get(Client, payment.client_id) if payment.client_id else None
    studio      = db.get(Studio, ctx.studio_id)
    settings    = db.get(StudioSettings, ctx.studio_id)

    pdf_bytes = generate_invoice_pdf(
        payment=payment,
        appointment=appointment,
        client=client,
        studio_name=studio.name if studio else "Studio",
        studio_slug=studio.slug if studio else "",
        studio_address=settings.studio_address if settings else None,
        bank_name=settings.bank_name if settings else None,
        bank_branch=settings.bank_branch if settings else None,
        bank_account=settings.bank_account if settings else None,
        vat_percent=float(settings.vat_percent) if settings else 18.0,
    )

    short_id = str(payment_id)[:8].upper()
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice_{short_id}.pdf"'},
    )
