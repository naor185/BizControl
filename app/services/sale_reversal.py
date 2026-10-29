"""A credit note undoes the sale — everything it gave or took goes back (the owner, 2026-10-26: "of course everything
resets when a payment is credited").

On a payment (an appointment's deposit or payment, a membership, a class, a course, a room rental):
- the money: a refund, the way it went back (crud/payment.record_refund) — income, ויקי, the client's balance and the
  artist's commission (staff_repository: payments less refunds) net it out
- the club points it earned are taken back (down to 0 — points already spent can't be taken twice); the points used
  to pay are given back, and their "[מערכת] … נקודות" row no longer closes the bill
- its coupon can be used again (a birthday coupon is active again)
- products sold with it go back to stock
On a till sale: the sale is void (out of income), its stock back, its coupon and its points as above.

Each change is a new line in the points history ("זיכוי — …"), nothing is erased. Called by both credit notes — the
payments page and the documents page — and by voiding a till sale. The caller commits."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

# lines from before 2026-10-26 have no payment_id / pos_transaction_id — they're found by what they say and when
_NEAR = timedelta(minutes=5)


def _points(db: Session, studio_id, client_id, *, link, legacy_earned, legacy_used, reason_back_earned: str,
            reason_back_used: str, payment_id=None, pos_transaction_id=None) -> tuple[int, int]:
    """Take back the points earned, give back the points used. (taken, given)"""
    from app.models.client import Client
    from app.models.client_points_ledger import ClientPointsLedger as L
    client = db.get(Client, client_id) if client_id else None
    if client is None:
        return 0, 0
    lines = db.scalars(select(L).where(L.studio_id == studio_id, L.client_id == client.id,
                                       or_(link, and_(L.payment_id.is_(None), L.pos_transaction_id.is_(None),
                                                      or_(legacy_earned, legacy_used))))).all()
    earned = sum(x.delta_points for x in lines if x.delta_points > 0 and not (x.reason or "").startswith("זיכוי"))
    used = sum(-x.delta_points for x in lines if x.delta_points < 0 and not (x.reason or "").startswith("זיכוי"))
    if any((x.reason or "").startswith("זיכוי") for x in lines):
        return 0, 0                                     # already reversed
    taken = min(earned, int(client.loyalty_points or 0))
    client.loyalty_points = int(client.loyalty_points or 0) - taken + used
    if taken:
        db.add(L(studio_id=studio_id, client_id=client.id, payment_id=payment_id, pos_transaction_id=pos_transaction_id,
                 delta_points=-taken, reason=reason_back_earned))
    if used:
        db.add(L(studio_id=studio_id, client_id=client.id, payment_id=payment_id, pos_transaction_id=pos_transaction_id,
                 delta_points=used, reason=reason_back_used))
    return taken, used


def undo_payment(db: Session, payment, total_cents: int, method: str | None = None) -> dict:
    from app.crud.payment import record_refund
    from app.models.client_points_ledger import ClientPointsLedger as L
    from app.models.payment import Payment
    from app.models.product import Product
    from app.models.product_sale import ProductSale
    from app.services import coupons
    record_refund(db, payment, total_cents, method=method)

    near = and_(L.created_at >= payment.created_at - timedelta(minutes=1), L.created_at <= payment.created_at + _NEAR)
    legacy_earned = and_(L.delta_points > 0, or_(
        L.reason.ilike(f"%{payment.id}%"),
        and_(L.appointment_id == payment.appointment_id, L.reason.ilike("Cashback for deposit%"))
        if payment.type == "deposit" and payment.appointment_id else False))
    legacy_used = and_(L.delta_points < 0, L.appointment_id == payment.appointment_id, L.reason.ilike("%redeemed%"), near) \
        if payment.appointment_id else False
    taken, given = _points(db, payment.studio_id, payment.client_id, link=L.payment_id == payment.id,
                           legacy_earned=legacy_earned, legacy_used=legacy_used,
                           reason_back_earned="זיכוי — בוטלו הנקודות שנצברו על התשלום",
                           reason_back_used="זיכוי — הוחזרו הנקודות ששולמו בהן", payment_id=payment.id)
    if given and payment.appointment_id:                 # the points' own row no longer closes the bill
        for row in db.scalars(select(Payment).where(
                Payment.studio_id == payment.studio_id, Payment.appointment_id == payment.appointment_id,
                Payment.client_id == payment.client_id, Payment.status == "paid", Payment.id != payment.id,
                Payment.notes.ilike("[מערכת]%נקודות%"),
                Payment.created_at >= payment.created_at - timedelta(minutes=1),
                Payment.created_at <= payment.created_at + _NEAR)).all():
            row.status = "void"

    released = coupons.release(db, payment_id=payment.id)
    restocked = 0
    for sale in db.scalars(select(ProductSale).where(ProductSale.payment_id == payment.id)).all():
        product = db.get(Product, sale.product_id)
        if product is not None and product.stock_quantity is not None:
            product.stock_quantity += sale.quantity
            restocked += sale.quantity
        db.delete(sale)
    return {"points_taken": taken, "points_given": given, "coupon": bool(released), "restocked": restocked,
            "reopened": _reopen_if_unpaid(db, payment)}


def _reopen_if_unpaid(db: Session, payment) -> bool:
    """A balance payment closes its appointment (crud/payment); credited back with no other balance payment standing,
    the appointment is open again — it can be paid, closed or canceled (the owner, 2026-10-29: a ₪1 test payment,
    credited, left a "done" helix appointment owing ₪180 that couldn't be canceled)."""
    from app.models.appointment import Appointment
    from app.models.payment import Payment
    if payment.type != "payment" or not payment.appointment_id:
        return False
    appt = db.get(Appointment, payment.appointment_id)
    if appt is None or appt.status != "done":
        return False
    db.flush()                                            # the refund just recorded counts
    rows = db.scalars(select(Payment).where(Payment.appointment_id == appt.id, Payment.status == "paid")).all()
    refunds = [r for r in rows if r.type == "refund"]
    for r in rows:
        if r.type != "payment" or (r.notes or "").startswith("[מערכת]"):
            continue
        back = sum(f.amount_cents for f in refunds if str(r.id)[:8] in (f.notes or ""))   # record_refund's note
        if r.amount_cents - back > 0:
            return False                                  # another balance payment still stands
    appt.status, appt.done_at = "scheduled", None
    return True


def undo_till_sale(db: Session, txn) -> dict:
    from app.models.client_points_ledger import ClientPointsLedger as L
    from app.models.pos_transaction import PosTransactionItem
    from app.models.product import Product
    from app.services import coupons
    if txn.status == "void":
        return {"points_taken": 0, "points_given": 0, "coupon": False, "restocked": 0}
    restocked = 0
    for item in db.scalars(select(PosTransactionItem).where(PosTransactionItem.transaction_id == txn.id)).all():
        if item.product_id:
            product = db.get(Product, item.product_id)
            if product is not None and product.stock_quantity is not None:
                product.stock_quantity += item.quantity
                restocked += item.quantity
    txn.status = "void"
    released = coupons.release(db, pos_transaction_id=txn.id)
    near = and_(L.created_at >= txn.created_at - timedelta(minutes=1), L.created_at <= txn.created_at + _NEAR)
    taken, given = _points(db, txn.studio_id, txn.client_id, link=L.pos_transaction_id == txn.id,
                           legacy_earned=and_(L.delta_points > 0, L.reason.ilike("רכישה בקופה%"), near),
                           legacy_used=and_(L.delta_points < 0, L.reason.ilike("מימוש נקודות בקופה%"), near),
                           reason_back_earned="זיכוי — בוטלו הנקודות שנצברו ברכישה בקופה",
                           reason_back_used="זיכוי — הוחזרו הנקודות שמומשו בקופה", pos_transaction_id=txn.id)
    return {"points_taken": taken, "points_given": given, "coupon": bool(released), "restocked": restocked}


def undo_receipt(db: Session, studio_id, source_id, total_cents: int, method: str | None = None) -> dict | None:
    """A credit note on a receipt the system issued (invoices.source = 'payment'): its source is a payment or a till
    sale. None when it's neither (nothing to undo)."""
    from app.models.payment import Payment
    from app.models.pos_transaction import PosTransaction
    paid = db.scalar(select(Payment).where(Payment.id == source_id, Payment.studio_id == studio_id, Payment.type != "refund"))
    if paid is not None:
        return undo_payment(db, paid, total_cents, method=method)
    txn = db.scalar(select(PosTransaction).where(PosTransaction.id == source_id, PosTransaction.studio_id == studio_id))
    if txn is not None:
        return undo_till_sale(db, txn)
    return None
