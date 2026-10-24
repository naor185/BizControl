"""A link to pay, sent to a client on WhatsApp (the owner, 2026-10-24): "the card terminal isn't connected to the
system — at the end of the payment, send the client a link". From the till (the cart's items, and who sold them) or
from an appointment (what is left to pay). The client opens /pay/r/<id> — the business's logo, what it is for, the
business's Bit / PayBox / bank transfer — and taps "שילמתי", with a picture of the payment if they like; the business
hears it at once (the bell, a push) and approves: the sale is recorded then — in the till (api/pos_routes.pos_checkout)
or as the appointment's payment (crud/payment.create_payment) — with its receipt. Like the deposit
(services/deposit_report), and the same page look.

A card payment through the link needs a clearing company (Grow) — not yet; the link offers what the business has."""
from __future__ import annotations

import io
import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.notification import Notification
from app.models.payment_request import PaymentRequest
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings

log = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024
MAX_SIDE = 1600
OPEN = ("waiting", "reported")
# how the business got the money — what both the till and an appointment's payment take
METHODS = ("cash", "bit", "paybox", "credit_card", "bank_transfer")


def link(req: PaymentRequest) -> str:
    from app.crud.automation import _site
    return f"{_site()}/pay/r/{req.id}"


def _ils(cents: int) -> str:
    v = cents / 100
    return f"₪{v:g}" if v == int(v) else f"₪{v:.2f}"


def create(db: Session, studio_id, user_id, *, client_id, appointment_id=None, items=None, discount_cents: int = 0,
           amount_cents: int | None = None, performer_id=None) -> PaymentRequest:
    """The request, and the WhatsApp to the client with its link. From an appointment: amount_cents (what is left);
    from the till: the items (and the discount) make the amount."""
    client = db.get(Client, client_id) if client_id else None
    if not client or client.studio_id != studio_id:
        raise HTTPException(404, "הלקוח לא נמצא")
    if not client.phone:
        raise HTTPException(400, "ללקוח אין מספר טלפון")
    appt = None
    clean: list[dict] = []
    if appointment_id:
        appt = db.get(Appointment, appointment_id)
        if not appt or appt.studio_id != studio_id:
            raise HTTPException(404, "התור לא נמצא")
        if appt.client_id != client.id:
            raise HTTPException(400, "התור שייך ללקוח אחר")
        if not amount_cents or amount_cents <= 0:
            raise HTTPException(400, "יש לבחור סכום")
        total = int(amount_cents)
    else:
        for it in items or []:
            qty, price = int(it.get("quantity") or 1), int(it.get("unit_price_cents") or 0)
            desc = str(it.get("description") or "").strip()[:300]
            if qty <= 0 or price < 0 or not desc:
                raise HTTPException(400, "פריט לא תקין")
            clean.append({"product_id": it.get("product_id") or None, "description": desc, "quantity": qty,
                          "unit_price_cents": price})
        if not clean:
            raise HTTPException(400, "העגלה ריקה")
        total = max(0, sum(i["quantity"] * i["unit_price_cents"] for i in clean) - max(0, int(discount_cents or 0)))
        if total <= 0:
            raise HTTPException(400, "יש לבחור סכום")
    if performer_id:
        from app.models.user import User
        p = db.get(User, performer_id)
        if not p or p.studio_id != studio_id or not p.is_active:
            raise HTTPException(400, "איש הצוות לא נמצא")

    req = PaymentRequest(studio_id=studio_id, client_id=client.id, appointment_id=appt.id if appt else None,
                         items=clean, discount_cents=max(0, int(discount_cents or 0)) if not appt else 0,
                         amount_cents=total, performer_id=performer_id or None, created_by=user_id, status="waiting")
    db.add(req)
    db.flush()

    from app.models.message_job import MessageJob
    studio = db.get(Studio, studio_id)
    first = (client.full_name or "").split(" ")[0]
    what = (appt.title if appt and appt.title else None) or (clean[0]["description"] if len(clean) == 1 else None)
    body = (f"היי {first} 👋\n"
            + (f"לתשלום ב{studio.name if studio else 'עסק'}: {_ils(total)}" + (f" · {what}" if what else "")) + "\n"
            + f"{link(req)}")
    db.add(MessageJob(studio_id=studio_id, client_id=client.id, appointment_id=appt.id if appt else None,
                      channel="whatsapp", to_phone=client.phone, body=body, reminder_type="payment_request",
                      scheduled_at=datetime.now(timezone.utc), status="pending"))
    db.commit()
    db.refresh(req)
    return req


def get_public(db: Session, request_id) -> PaymentRequest:
    req = db.get(PaymentRequest, request_id)
    if not req:
        raise HTTPException(404, "הקישור לא נמצא")
    return req


def public_view(db: Session, req: PaymentRequest) -> dict:
    """What the link shows the client — this request only: the business, what it is for, how to pay."""
    from app.core.i18n import studio_locale
    from app.core.sites import logo_address
    studio = db.get(Studio, req.studio_id)
    s = db.get(StudioSettings, req.studio_id)
    client = db.get(Client, req.client_id) if req.client_id else None
    appt = db.get(Appointment, req.appointment_id) if req.appointment_id else None
    return {
        "status": req.status,
        "business_name": studio.name if studio else "",
        "logo_url": logo_address(studio.logo_url if studio else None, s.logo_filename if s else None),
        "client_first_name": (client.full_name or "").split(" ")[0] if client else "",
        "title": appt.title if appt else None,
        "items": [{"description": i["description"], "quantity": i["quantity"], "unit_price_cents": i["unit_price_cents"]}
                  for i in (req.items or [])],
        "discount_cents": req.discount_cents,
        "amount_cents": req.amount_cents,
        "bit_link": s.bit_link if s else None,
        "paybox_link": s.paybox_link if s else None,
        "bank_name": s.bank_name if s else None,
        "bank_branch": s.bank_branch if s else None,
        "bank_account": s.bank_account if s else None,
        "reported": req.reported_at is not None,
        "has_proof": bool(req.proof_url),
        "locale": studio_locale(db, req.studio_id),
    }


def _open(req: PaymentRequest) -> None:
    if req.status == "paid":
        raise HTTPException(409, "התשלום כבר אושר")
    if req.status == "canceled":
        raise HTTPException(409, "הקישור בוטל")


def save_proof(db: Session, req: PaymentRequest, data: bytes) -> None:
    _open(req)
    if not data:
        raise HTTPException(400, "לא התקבלה תמונה")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "התמונה גדולה מדי")
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(400, "זו לא תמונה — צלמו מסך של אישור התשלום")
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=85)
    from app.services.image_store import save_image
    url = save_image(out.getvalue(), "image/jpeg", folder=f"payment-proofs/{req.studio_id}", prefix="proof", db=db)
    if not url:
        raise HTTPException(503, "לא הצלחנו לשמור את התמונה — נסו שוב")
    req.proof_url = url
    db.commit()


def report(db: Session, req: PaymentRequest, note: str | None) -> None:
    """The client tapped "שילמתי" — the business is told once."""
    _open(req)
    first = req.reported_at is None
    req.reported_at = req.reported_at or datetime.now(timezone.utc)
    req.status = "reported"
    if note and note.strip():
        req.client_note = note.strip()[:500]
    db.commit()
    if first:
        _notify(db, req)


def _notify(db: Session, req: PaymentRequest) -> None:
    try:
        client = db.get(Client, req.client_id) if req.client_id else None
        title = "דיווח על תשלום בקישור"
        body = f"{client.full_name if client else 'לקוח'} — {_ils(req.amount_cents)}" + (" · עם צילום" if req.proof_url else "")
        target = "/dashboard#payment-requests"
        key = f"payment_request_reported:{req.id}"
        if db.scalar(select(Notification.id).where(Notification.studio_id == req.studio_id, Notification.dedup_key == key)):
            return
        db.add(Notification(studio_id=req.studio_id, type="payment_request", title=title, body=body,
                            action_url=target, dedup_key=key))
        db.commit()
        from app.crud.push import enqueue_push_to_studio_admins
        enqueue_push_to_studio_admins(db, req.studio_id, title=title, body=body, deep_link=target,
                                      reminder_type="payment_request_reported")
    except Exception as e:
        db.rollback()
        log.warning("payment request notification failed for %s: %s", req.id, e)


def approve(db: Session, ctx, req: PaymentRequest, method: str, send_receipt: bool) -> dict:
    """The business got the money — the sale is recorded now, with its receipt: in the till (the items, who sold them)
    or as the appointment's payment."""
    _open(req)
    if method not in METHODS:
        raise HTTPException(400, f"אמצעי תשלום לא חוקי: {method}")
    if req.appointment_id:
        from app.crud.payment import create_payment
        from app.schemas.payment import PaymentCreate
        try:
            pay = create_payment(db, ctx.studio_id, PaymentCreate(
                appointment_id=req.appointment_id, client_id=req.client_id, amount_cents=req.amount_cents,
                type="payment", status="paid", method=method, notes="שולם בקישור לתשלום", send_receipt=send_receipt))
        except ValueError as e:
            raise HTTPException(404, str(e))
        req.payment_id = pay.id
    else:
        from app.api.pos_routes import CartItem, CheckoutIn, pos_checkout
        txn = pos_checkout(CheckoutIn(
            items=[CartItem(**i) for i in req.items], method=method,
            client_id=str(req.client_id) if req.client_id else None, discount_cents=req.discount_cents,
            send_receipt=send_receipt, idempotency_key=f"preq-{req.id}",
            performer_id=str(req.performer_id) if req.performer_id else None), ctx, db)
        req.pos_transaction_id = uuid.UUID(str(txn.id))
    req.status, req.paid_at, req.paid_method = "paid", datetime.now(timezone.utc), method
    db.commit()
    return {"status": "paid"}


def cancel(db: Session, req: PaymentRequest) -> None:
    if req.status == "paid":
        raise HTTPException(409, "התשלום כבר אושר")
    req.status = "canceled"
    db.commit()


def open_list(db: Session, studio_id) -> list[dict]:
    """The links still waiting — sent, or reported paid — newest first."""
    rows = db.scalars(select(PaymentRequest).where(PaymentRequest.studio_id == studio_id, PaymentRequest.status.in_(OPEN))
                      .order_by(PaymentRequest.created_at.desc()).limit(50)).all()
    out = []
    for r in rows:
        client = db.get(Client, r.client_id) if r.client_id else None
        appt = db.get(Appointment, r.appointment_id) if r.appointment_id else None
        out.append({
            "id": str(r.id), "status": r.status, "amount_cents": r.amount_cents,
            "client_name": client.full_name if client else None, "client_id": str(r.client_id) if r.client_id else None,
            "what": (appt.title if appt else None) or ", ".join(i["description"] for i in (r.items or []))[:120],
            "from": "appointment" if r.appointment_id else "till",
            "reported_at": r.reported_at.isoformat() if r.reported_at else None, "proof_url": r.proof_url,
            "client_note": r.client_note, "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return out
