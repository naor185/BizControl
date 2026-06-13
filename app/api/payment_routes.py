from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload
import io
import os

from app.db.deps import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.payment import Payment
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.studio import Studio
from app.schemas.payment import PaymentCreate, PaymentOut, AppointmentBalanceOut
from app.crud.payment import create_payment, appointment_balance, delete_all_client_payments
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

@router.delete("/client/{client_id}/all", status_code=status.HTTP_200_OK)
def delete_all_for_client(
    client_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    count = delete_all_client_payments(db, ctx.studio_id, client_id)
    return {"deleted": count}


@router.delete("/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(
    payment_id: UUID,
    with_appointment: bool = Query(default=False),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role != "superadmin":
        raise HTTPException(status_code=403, detail="מחיקת תשלום זמינה לסופר-אדמין בלבד")
    from app.crud.payment import delete_payment
    ok = delete_payment(db, ctx.studio_id, payment_id, with_appointment=with_appointment)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Payment {payment_id} not found")
    return None


@router.post("/{payment_id}/credit")
def issue_credit_note(
    payment_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Issue a credit note (זיכוי) for a payment. Creates the linked invoice first if it doesn't exist."""
    import uuid as _uuid
    from sqlalchemy import text

    # Verify payment belongs to studio
    payment = db.scalar(select(Payment).where(Payment.id == payment_id, Payment.studio_id == ctx.studio_id))
    if not payment:
        raise HTTPException(status_code=404, detail="תשלום לא נמצא")

    # Find linked invoice (auto-created on payment or manually linked)
    invoice_row = db.execute(
        text("SELECT * FROM invoices WHERE source_id = :pid AND studio_id = :sid AND doc_type != 'credit' LIMIT 1"),
        {"pid": str(payment_id), "sid": str(ctx.studio_id)},
    ).fetchone()

    # If no invoice exists yet, create one on the fly
    if not invoice_row:
        from app.models.appointment import Appointment
        from app.models.client import Client
        from app.crud.payment import _auto_create_invoice
        appt = db.get(Appointment, payment.appointment_id) if payment.appointment_id else None
        client = db.get(Client, payment.client_id) if payment.client_id else None
        if not client:
            raise HTTPException(status_code=400, detail="לא נמצא לקוח מקושר לתשלום")
        _auto_create_invoice(db, ctx.studio_id, payment, appt, client)
        invoice_row = db.execute(
            text("SELECT * FROM invoices WHERE source_id = :pid AND studio_id = :sid AND doc_type != 'credit' LIMIT 1"),
            {"pid": str(payment_id), "sid": str(ctx.studio_id)},
        ).fetchone()
        if not invoice_row:
            raise HTTPException(status_code=500, detail="שגיאה ביצירת קבלה לזיכוי")

    orig = dict(invoice_row._mapping)

    if orig["status"] == "credited":
        raise HTTPException(status_code=400, detail="קבלה זו כבר זוכתה")

    # Get original items
    orig_items = db.execute(
        text("SELECT * FROM invoice_items WHERE invoice_id = :id ORDER BY sort_order"),
        {"id": orig["id"]},
    ).fetchall()

    # Get next credit note number
    credit_number_row = db.execute(
        text("""
            INSERT INTO invoice_series (studio_id, doc_type, next_number)
            VALUES (:sid, 'credit', 1001)
            ON CONFLICT (studio_id, doc_type)
            DO UPDATE SET next_number = invoice_series.next_number + 1
            RETURNING next_number - 1
        """),
        {"sid": str(ctx.studio_id)},
    ).fetchone()
    db.commit()
    credit_number = credit_number_row[0]
    credit_id = str(_uuid.uuid4())

    db.execute(
        text("""
            INSERT INTO invoices (
                id, studio_id, doc_type, doc_number, status,
                client_id, client_name, client_phone, client_email,
                business_name, business_type, business_number,
                business_address, business_phone, business_email, business_logo_url,
                subtotal_cents, vat_rate, vat_amount_cents, total_cents, tip_cents,
                credits_invoice_id, issued_by_id, issued_at
            ) VALUES (
                :id, :sid, 'credit', :dn, 'issued',
                :cid, :cname, :cphone, :cemail,
                :bname, :btype, :bnum,
                :baddr, :bphone, :bemail, :blogo,
                :sub, :vr, :vat, :total, 0,
                :orig_id, :uid, NOW()
            )
        """),
        {
            "id": credit_id, "sid": str(ctx.studio_id), "dn": credit_number,
            "cid": orig.get("client_id"), "cname": orig.get("client_name"),
            "cphone": orig.get("client_phone"), "cemail": orig.get("client_email"),
            "bname": orig.get("business_name"), "btype": orig.get("business_type"),
            "bnum": orig.get("business_number"), "baddr": orig.get("business_address"),
            "bphone": orig.get("business_phone"), "bemail": orig.get("business_email"),
            "blogo": orig.get("business_logo_url"),
            "sub": -(orig.get("subtotal_cents") or 0),
            "vr": orig.get("vat_rate"), "vat": -(orig.get("vat_amount_cents") or 0),
            "total": -(orig.get("total_cents") or 0),
            "orig_id": orig["id"], "uid": ctx.user_id,
        },
    )

    for i, item in enumerate(orig_items):
        it = dict(item._mapping)
        db.execute(
            text("""
                INSERT INTO invoice_items
                    (id, invoice_id, description, quantity, unit_price_cents,
                     total_price_cents, sort_order)
                VALUES (:id, :inv, :desc, :qty, :up, :tp, :sort)
            """),
            {
                "id": str(_uuid.uuid4()), "inv": credit_id,
                "desc": it["description"], "qty": float(it["quantity"]),
                "up": -(it["unit_price_cents"]), "tp": -(it["total_price_cents"]),
                "sort": i,
            },
        )

    # Mark original as credited
    db.execute(
        text("UPDATE invoices SET status='credited', credited_by_id=:cid WHERE id=:id"),
        {"cid": credit_id, "id": orig["id"]},
    )

    # Create a matching refund Payment so dashboard revenue = net 0
    refund_payment = Payment(
        studio_id=ctx.studio_id,
        appointment_id=payment.appointment_id,
        client_id=payment.client_id,
        amount_cents=abs(orig.get("total_cents") or 0),
        currency=payment.currency,
        type="refund",
        status="paid",
        method=payment.method,
        notes=f"[זיכוי אוטומטי] עבור תשלום {str(payment_id)[:8]}",
    )
    db.add(refund_payment)
    db.commit()

    credit_row = db.execute(text("SELECT * FROM invoices WHERE id = :id"), {"id": credit_id}).fetchone()
    result = dict(credit_row._mapping)
    result["doc_type_label"] = "זיכוי"
    result["total_ils"] = round((result.get("total_cents") or 0) / 100, 2)
    return result

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
    settings = db.get(StudioSettings, ctx.studio_id)

    logo_url = None
    if settings and settings.logo_filename:
        logo_url = os.path.join("uploads", settings.logo_filename)
    elif studio and studio.logo_url:
        logo_url = studio.logo_url

    pdf_bytes = generate_receipt_pdf(
        payment=payment,
        appointment=appointment,
        client=client,
        studio_name=studio.name if studio else "Studio",
        studio_slug=studio.slug if studio else "",
        logo_url=logo_url,
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

    logo_url_inv = None
    if settings and settings.logo_filename:
        logo_url_inv = os.path.join("uploads", settings.logo_filename)
    elif studio and studio.logo_url:
        logo_url_inv = studio.logo_url

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
        logo_url=logo_url_inv,
    )

    short_id = str(payment_id)[:8].upper()
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice_{short_id}.pdf"'},
    )
