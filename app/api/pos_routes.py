"""
POS / Cash Register API

POST /api/pos/checkout   — process a sale (cart → transaction)
GET  /api/pos/history    — list recent POS transactions (admin)
GET  /api/pos/history/{id} — single transaction detail
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.pos_transaction import PosTransaction, PosTransactionItem
from app.models.product import Product
from app.models.client import Client
from app.models.client_points_ledger import ClientPointsLedger
from app.models.studio_settings import StudioSettings

router = APIRouter(prefix="/pos", tags=["POS"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class CartItem(BaseModel):
    product_id: Optional[str] = None   # None for manual item
    description: str
    quantity: int = 1
    unit_price_cents: int


class CheckoutIn(BaseModel):
    items: list[CartItem]
    method: str = "cash"
    client_id: Optional[str] = None
    discount_cents: int = 0
    points_redeemed: int = 0
    coupon_code: Optional[str] = None
    notes: Optional[str] = None
    send_receipt: bool = True
    idempotency_key: Optional[str] = None


class TransactionItemOut(BaseModel):
    id: str
    product_id: Optional[str]
    description: str
    quantity: int
    unit_price_cents: int
    total_price_cents: int


class TransactionOut(BaseModel):
    id: str
    client_id: Optional[str]
    client_name: Optional[str]
    cashier_name: Optional[str]
    total_cents: int
    discount_cents: int
    method: str
    status: str
    notes: Optional[str]
    items: list[TransactionItemOut]
    points_earned: int
    created_at: str
    receipt_message_job_id: Optional[str] = None


def _build_transaction_out(db: Session, txn: PosTransaction) -> TransactionOut:
    from app.models.user import User
    client = db.get(Client, txn.client_id) if txn.client_id else None
    cashier = db.get(User, txn.cashier_id) if txn.cashier_id else None
    items = db.scalars(
        select(PosTransactionItem).where(PosTransactionItem.transaction_id == txn.id)
    ).all()
    return TransactionOut(
        id=str(txn.id),
        client_id=str(txn.client_id) if txn.client_id else None,
        client_name=client.full_name if client else None,
        cashier_name=cashier.display_name or cashier.email if cashier else None,
        total_cents=txn.total_cents,
        discount_cents=txn.discount_cents,
        method=txn.method,
        status=txn.status,
        notes=txn.notes,
        items=[
            TransactionItemOut(
                id=str(i.id),
                product_id=str(i.product_id) if i.product_id else None,
                description=i.description,
                quantity=i.quantity,
                unit_price_cents=i.unit_price_cents,
                total_price_cents=i.total_price_cents,
            ) for i in items
        ],
        points_earned=0,
        created_at=txn.created_at.isoformat(),
    )


# ── Checkout ──────────────────────────────────────────────────────────────────

@router.post("/checkout", response_model=TransactionOut)
def pos_checkout(
    body: CheckoutIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if not body.items:
        raise HTTPException(status_code=400, detail="העגלה ריקה")

    # Idempotent replay: a stalled/lost response can make the client resubmit
    # the exact same checkout — return the already-created transaction instead
    # of creating a duplicate sale.
    if body.idempotency_key:
        existing = db.scalar(
            select(PosTransaction).where(
                PosTransaction.studio_id == ctx.studio_id,
                PosTransaction.idempotency_key == body.idempotency_key,
            )
        )
        if existing:
            return _build_transaction_out(db, existing)

    valid_methods = {"cash", "bit", "credit", "credit_card", "paybox", "bank_transfer", "apple_pay", "google_pay", "other"}
    if body.method not in valid_methods:
        raise HTTPException(status_code=400, detail=f"אמצעי תשלום לא חוקי: {body.method}")

    # Resolve client
    client = None
    if body.client_id:
        client = db.get(Client, uuid.UUID(body.client_id))
        if not client or client.studio_id != ctx.studio_id:
            raise HTTPException(status_code=404, detail="לקוח לא נמצא")

    # Build items + validate products + reduce stock
    db_items: list[PosTransactionItem] = []
    subtotal = 0

    for item in body.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="כמות חייבת להיות חיובית")
        if item.unit_price_cents < 0:
            raise HTTPException(status_code=400, detail="מחיר חייב להיות חיובי")

        product_id = None
        if item.product_id:
            product_id = uuid.UUID(item.product_id)
            product = db.get(Product, product_id)
            if not product or product.studio_id != ctx.studio_id:
                raise HTTPException(status_code=404, detail=f"מוצר {item.description} לא נמצא")
            if product.stock_quantity < item.quantity:
                raise HTTPException(status_code=400, detail=f"אין מספיק מלאי עבור {product.name}")
            product.stock_quantity -= item.quantity

        total_cents = item.unit_price_cents * item.quantity
        subtotal += total_cents
        db_items.append(PosTransactionItem(
            product_id=product_id,
            description=item.description,
            quantity=item.quantity,
            unit_price_cents=item.unit_price_cents,
            total_price_cents=total_cents,
        ))

    discount = max(0, body.discount_cents)
    total = max(0, subtotal - discount)

    # Create transaction
    txn = PosTransaction(
        studio_id=ctx.studio_id,
        client_id=client.id if client else None,
        cashier_id=ctx.user_id,
        total_cents=total,
        discount_cents=discount,
        method=body.method,
        status="paid",
        notes=body.notes,
        idempotency_key=body.idempotency_key,
    )
    db.add(txn)
    db.flush()  # get txn.id

    for di in db_items:
        di.transaction_id = txn.id
        db.add(di)

    # Deduct redeemed points from client balance
    points_redeemed = max(0, int(body.points_redeemed or 0))
    if client and points_redeemed > 0:
        actual_redeem = min(points_redeemed, int(client.loyalty_points or 0))
        if actual_redeem > 0:
            client.loyalty_points = max(0, int(client.loyalty_points or 0) - actual_redeem)
            db.add(ClientPointsLedger(
                studio_id=ctx.studio_id,
                client_id=client.id,
                delta_points=-actual_redeem,
                reason=f"מימוש נקודות בקופה",
            ))

    # Award loyalty points from cashback — club members only
    points_earned = 0
    if client and getattr(client, "is_club_member", False):
        settings = db.scalar(select(StudioSettings).where(StudioSettings.studio_id == ctx.studio_id))
        cashback_pct = getattr(settings, "points_percent_per_payment", 0) if settings else 0
        if cashback_pct and cashback_pct > 0:
            points_earned = int(total * cashback_pct / 10000)  # cents * pct% → points
            if points_earned > 0:
                client.loyalty_points = int(client.loyalty_points or 0) + points_earned
                db.add(ClientPointsLedger(
                    studio_id=ctx.studio_id,
                    client_id=client.id,
                    delta_points=points_earned,
                    reason=f"רכישה בקופה — {total / 100:.2f}₪",
                ))

    # Mark coupon as redeemed
    if body.coupon_code:
        from app.models.birthday_coupon import BirthdayCoupon
        now_utc = datetime.now(timezone.utc)
        coupon = db.scalar(
            select(BirthdayCoupon).where(
                BirthdayCoupon.studio_id == ctx.studio_id,
                BirthdayCoupon.code == body.coupon_code.upper().strip(),
                BirthdayCoupon.status == "active",
            )
        )
        if coupon:
            coupon.status = "redeemed"
            coupon.redeemed_at = now_utc

    try:
        db.commit()
    except Exception:
        # Concurrent duplicate submit with the same idempotency_key raced past
        # the earlier check-and-return — roll back and return the row the
        # other request already committed instead of surfacing a 500.
        db.rollback()
        if body.idempotency_key:
            existing = db.scalar(
                select(PosTransaction).where(
                    PosTransaction.studio_id == ctx.studio_id,
                    PosTransaction.idempotency_key == body.idempotency_key,
                )
            )
            if existing:
                return _build_transaction_out(db, existing)
        raise
    db.refresh(txn)

    # Auto-create receipt for POS sale — including anonymous walk-in sales
    if txn.total_cents > 0:
        try:
            import types as _types
            from app.crud.payment import _auto_create_invoice
            _fake_payment = _types.SimpleNamespace(
                id=txn.id,
                amount_cents=txn.total_cents,
                method=txn.method,
                type="payment",
            )
            _items_desc = ", ".join(i.description for i in db_items[:3])
            _fake_appt = _types.SimpleNamespace(id=None, title=_items_desc or "מכירה בקופה")
            _auto_create_invoice(db, ctx.studio_id, _fake_payment, _fake_appt, client)
        except Exception:
            import logging as _l
            _l.getLogger(__name__).exception("[pos] auto-invoice failed for txn %s", txn.id)

    # WhatsApp thank-you message to client — only if user requested it
    receipt_message_job_id: Optional[str] = None
    if body.send_receipt and client and client.phone and not getattr(client, "whatsapp_opted_out", False):
        try:
            from app.models.studio_settings import StudioSettings as _SS
            from app.services.message_worker import send_whatsapp_message
            from app.models.message_job import MessageJob
            _settings = db.get(_SS, ctx.studio_id)
            _pts_total = int(client.loyalty_points or 0)
            _pts_block = ""
            if client.is_club_member:
                if points_earned > 0:
                    _pts_block = f"\n\n🎁 צברת {points_earned} נקודות! יתרה: {_pts_total} נקודות."
                else:
                    _pts_block = f"\n\n⭐ יתרת נקודות: {_pts_total} נקודות."
            _review = ""
            if _settings and _settings.review_link_google:
                _review = f"\n\n⭐ נשמח לביקורת שלך בגוגל!\n{_settings.review_link_google.strip()}"
            _custom_tpl = getattr(_settings, "pos_receipt_wa_template", None) if _settings else None
            if _custom_tpl:
                from app.crud.automation import format_template
                _body = format_template(_custom_tpl, {
                    "client_name": client.full_name or "",
                    "total_amount": f"₪{total / 100:.2f}",
                    "points_earned": str(points_earned),
                    "loyalty_points": str(_pts_total),
                })
            else:
                _body = (
                    f"היי {client.full_name}! 😊\nתודה על הרכישה ❤️"
                    f"{_pts_block}{_review}"
                )
            now_utc = datetime.now(timezone.utc)
            _job = MessageJob(
                studio_id=ctx.studio_id,
                client_id=client.id,
                channel="whatsapp",
                to_phone=client.phone,
                body=_body,
                scheduled_at=now_utc,
                status="pending",
                reminder_type="pos_receipt",
            )
            db.add(_job)
            db.commit()
            db.refresh(_job)
            receipt_message_job_id = str(_job.id)
        except Exception:
            import logging as _l
            _l.getLogger(__name__).exception("Failed to queue POS receipt message")

    # Club invite for non-members
    if client and not client.is_club_member:
        try:
            from app.crud.automation import maybe_enqueue_club_invite
            maybe_enqueue_club_invite(db, ctx.studio_id, client)
        except Exception:
            pass

    # Build response
    from app.models.user import User
    cashier = db.get(User, ctx.user_id) if ctx.user_id else None

    return TransactionOut(
        id=str(txn.id),
        client_id=str(txn.client_id) if txn.client_id else None,
        client_name=client.full_name if client else None,
        cashier_name=cashier.display_name or cashier.email if cashier else None,
        total_cents=txn.total_cents,
        discount_cents=txn.discount_cents,
        method=txn.method,
        status=txn.status,
        notes=txn.notes,
        items=[
            TransactionItemOut(
                id=str(di.id),
                product_id=str(di.product_id) if di.product_id else None,
                description=di.description,
                quantity=di.quantity,
                unit_price_cents=di.unit_price_cents,
                total_price_cents=di.total_price_cents,
            ) for di in db_items
        ],
        points_earned=points_earned,
        created_at=txn.created_at.isoformat(),
        receipt_message_job_id=receipt_message_job_id,
    )


@router.post("/cancel-receipt/{job_id}")
def cancel_pos_receipt(
    job_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Cancel a just-queued WhatsApp receipt before the background worker
    (which polls every ~20s) picks it up and sends it. No-ops with a clear
    result if it's already been sent by the time this is called."""
    from app.models.message_job import MessageJob
    exists = db.scalar(
        select(MessageJob.id).where(
            MessageJob.id == job_id,
            MessageJob.studio_id == ctx.studio_id,
            MessageJob.reminder_type == "pos_receipt",
        )
    )
    if not exists:
        raise HTTPException(status_code=404, detail="הודעה לא נמצאה")

    # Atomic conditional update — avoids a lost-update race against the
    # background worker, which also only touches rows still "pending".
    result = db.execute(
        MessageJob.__table__.update()
        .where(MessageJob.id == job_id, MessageJob.status == "pending")
        .values(status="canceled")
    )
    db.commit()
    if result.rowcount == 0:
        return {"ok": False, "already_sent": True}
    return {"ok": True, "already_sent": False}


# ── History ───────────────────────────────────────────────────────────────────

@router.get("/history", response_model=list[dict])
def pos_history(
    days: int = Query(30, ge=1, le=365),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    txns = db.scalars(
        select(PosTransaction).where(
            PosTransaction.studio_id == ctx.studio_id,
            PosTransaction.created_at >= since,
            PosTransaction.status == "paid",
        ).order_by(PosTransaction.created_at.desc())
    ).all()

    from app.models.user import User

    result = []
    for t in txns:
        client = db.get(Client, t.client_id) if t.client_id else None
        cashier = db.get(User, t.cashier_id) if t.cashier_id else None
        items = db.scalars(
            select(PosTransactionItem).where(PosTransactionItem.transaction_id == t.id)
        ).all()
        result.append({
            "id": str(t.id),
            "client_name": client.full_name if client else "אנונימי",
            "cashier_name": cashier.display_name or cashier.email if cashier else None,
            "total_cents": t.total_cents,
            "discount_cents": t.discount_cents,
            "method": t.method,
            "items_count": len(items),
            "created_at": t.created_at.isoformat(),
        })
    return result


@router.get("/history/{txn_id}", response_model=dict)
def pos_transaction_detail(
    txn_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    txn = db.get(PosTransaction, txn_id)
    if not txn or txn.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="עסקה לא נמצאה")

    from app.models.user import User
    client = db.get(Client, txn.client_id) if txn.client_id else None
    cashier = db.get(User, txn.cashier_id) if txn.cashier_id else None
    items = db.scalars(
        select(PosTransactionItem).where(PosTransactionItem.transaction_id == txn.id)
    ).all()

    return {
        "id": str(txn.id),
        "client_id": str(txn.client_id) if txn.client_id else None,
        "client_name": client.full_name if client else "אנונימי",
        "cashier_name": cashier.display_name or cashier.email if cashier else None,
        "total_cents": txn.total_cents,
        "discount_cents": txn.discount_cents,
        "method": txn.method,
        "status": txn.status,
        "notes": txn.notes,
        "items": [
            {
                "id": str(i.id),
                "product_id": str(i.product_id) if i.product_id else None,
                "description": i.description,
                "quantity": i.quantity,
                "unit_price_cents": i.unit_price_cents,
                "total_price_cents": i.total_price_cents,
            } for i in items
        ],
        "created_at": txn.created_at.isoformat(),
    }


@router.post("/void/{txn_id}")
def void_transaction(
    txn_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="אין הרשאה")
    txn = db.get(PosTransaction, txn_id)
    if not txn or txn.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="עסקה לא נמצאה")
    if txn.status == "void":
        raise HTTPException(status_code=400, detail="עסקה כבר מבוטלת")

    # Restore stock
    items = db.scalars(
        select(PosTransactionItem).where(PosTransactionItem.transaction_id == txn.id)
    ).all()
    for item in items:
        if item.product_id:
            product = db.get(Product, item.product_id)
            if product:
                product.stock_quantity += item.quantity

    txn.status = "void"
    db.commit()
    return {"ok": True}


@router.get("/{txn_id}/receipt")
def download_pos_receipt(
    txn_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    import io
    from fastapi.responses import StreamingResponse
    from sqlalchemy import text as _t
    from app.api.invoice_routes import _build_pdf, DOC_TYPES
    from app.api.payment_routes import _attach_points

    txn = db.get(PosTransaction, txn_id)
    if not txn or txn.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="עסקה לא נמצאה")

    inv_row = db.execute(
        _t("SELECT * FROM invoices WHERE source_id = :sid AND studio_id = :stid AND doc_type != 'credit' LIMIT 1"),
        {"sid": str(txn_id), "stid": str(ctx.studio_id)},
    ).fetchone()
    if not inv_row:
        raise HTTPException(status_code=404, detail="לא נמצאה קבלה עבור עסקה זו")

    inv = dict(inv_row._mapping)
    items = db.execute(
        _t("SELECT * FROM invoice_items WHERE invoice_id = :id ORDER BY sort_order"),
        {"id": inv["id"]},
    ).fetchall()
    item_list = [dict(r._mapping) for r in items]
    _attach_points(db, inv)
    pdf_bytes = _build_pdf(inv, item_list)
    doc_label = DOC_TYPES.get(inv["doc_type"], "קבלה")
    filename = f"{doc_label}_{inv['doc_number']}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
