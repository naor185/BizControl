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


# ── Checkout ──────────────────────────────────────────────────────────────────

@router.post("/checkout", response_model=TransactionOut)
def pos_checkout(
    body: CheckoutIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if not body.items:
        raise HTTPException(status_code=400, detail="העגלה ריקה")

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

    # Award loyalty points from cashback
    points_earned = 0
    if client:
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

    db.commit()
    db.refresh(txn)

    # WhatsApp thank-you message to client
    if client and client.phone and not getattr(client, "whatsapp_opted_out", False):
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
            _body = (
                f"היי {client.full_name}! 😊\nתודה על הרכישה ❤️"
                f"{_pts_block}{_review}"
            )
            now_utc = datetime.now(timezone.utc)
            db.add(MessageJob(
                studio_id=ctx.studio_id,
                client_id=client.id,
                channel="whatsapp",
                to_phone=client.phone,
                body=_body,
                scheduled_at=now_utc,
                status="pending",
                reminder_type="pos_receipt",
            ))
            db.commit()
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
    )


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
