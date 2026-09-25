"""
Payments for memberships and classes — recorded, never collected (the system does not charge money).

They go into the existing payments table (the plan's decision 9: extend payments, no parallel table):
a payment for a membership, or for a class booking — a single entry, or a fee the owner's rules
recorded. So every revenue report counts them by the payment's date, and they get an invoice/receipt
through the existing invoicing. What only belongs to an appointment — the thank-you after a treatment,
marking the appointment done, staff commission — is left out on purpose. Club points are the owner's choice
(the class settings, shown only when the business's plan has the club): a percentage for a membership and one
for a single entry, 0 = none; a fee earns none. Deleting the payment takes them back, as on any payment.
"""
from __future__ import annotations

import logging
from types import SimpleNamespace

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession, ClassTemplate
from app.models.memberships import ClassFee, Membership
from app.models.payment import Payment
from app.services import classes as svc
from app.services.penalties import EVENTS

METHODS = ("cash", "bit", "credit", "credit_card", "paypal", "bank", "bank_transfer", "paybox", "installment", "other")
_log = logging.getLogger(__name__)


class PaymentError(ValueError):
    pass


def invoice_subject(db: Session, payment: Payment) -> SimpleNamespace:
    """What the invoice line says: the membership, the class, or the fee."""
    if payment.membership_id:
        m = db.get(Membership, payment.membership_id)
        return SimpleNamespace(title=f"מנוי: {m.rules.get('name') if m else ''}".strip(), id=None)
    b = db.get(ClassBooking, payment.class_booking_id)
    s = db.get(ClassSession, b.session_id) if b else None
    t = db.get(ClassTemplate, s.template_id) if s and s.template_id else None
    when = " ".join(svc.il_date_time(s.starts_at)) if s else ""
    fee = db.scalar(select(ClassFee).where(ClassFee.booking_id == b.id)) if b else None
    if fee and fee.status == "paid":
        return SimpleNamespace(title=f"חיוב על {EVENTS.get(fee.event, '')}: {t.name if t else 'שיעור'} {when}".strip(), id=None)
    return SimpleNamespace(title=f"שיעור: {t.name if t else ''} {when}".strip(), id=None)


def record(db: Session, studio_id, client, *, amount_cents: int, method: str, membership: Membership | None = None,
           booking: ClassBooking | None = None, for_fee: bool = False, notes: str | None = None,
           external_ref: str | None = None, send_receipt: bool = True) -> Payment:
    """Records a paid payment for a membership or a class booking and issues its invoice/receipt.
    for_fee: this pays the booking's open fee (it becomes paid)."""
    if (membership is None) == (booking is None):
        raise PaymentError("תשלום על מנוי או על הרשמה לשיעור")
    if amount_cents <= 0:
        raise PaymentError("סכום התשלום חסר")
    if method not in METHODS:
        raise PaymentError("אמצעי תשלום לא מוכר")
    fee = None
    if for_fee:
        fee = db.scalar(select(ClassFee).where(ClassFee.booking_id == booking.id, ClassFee.status == "pending"))
        if not fee:
            raise PaymentError("אין חיוב פתוח להרשמה הזו")
    p = Payment(studio_id=studio_id, appointment_id=None, client_id=client.id,
                membership_id=membership.id if membership else None, class_booking_id=booking.id if booking else None,
                amount_cents=amount_cents, currency="ILS", type="payment", status="paid", method=method,
                external_ref=(external_ref or None), notes=(notes or None))
    db.add(p)
    if fee:
        fee.status, fee.paid_at = "paid", svc.now_utc()
    db.flush()
    if not fee:
        club_points(db, studio_id, client, p, for_membership=membership is not None)
    db.commit()
    try:
        from app.crud.payment import _auto_create_invoice
        _auto_create_invoice(db, studio_id, p, invoice_subject(db, p), client, send_receipt=send_receipt)
    except Exception:
        _log.exception("[auto-invoice] FAILED for class payment %s", p.id)
    return p


def club_points(db: Session, studio_id, client, p: Payment, *, for_membership: bool) -> int:
    """The owner's club points for a membership or single-entry payment — to a club member, when the business's
    plan has the club. Given like the points on any payment, so deleting the payment takes them back."""
    from app.crud.payment import award_points
    from app.services import policies
    from app.services.memberships import _module
    if not client.is_club_member or not _module(db, studio_id, "customer_club"):
        return 0
    percent = policies.get_policy(db, studio_id, "club_points_membership_percent" if for_membership else "club_points_entry_percent")
    return award_points(db, studio_id, client, p, percent)


def paid_for_membership(db: Session, membership_ids) -> dict:
    ids = list(membership_ids)
    if not ids:
        return {}
    rows = db.execute(select(Payment.membership_id, func.coalesce(func.sum(Payment.amount_cents), 0))
                      .where(Payment.membership_id.in_(ids), Payment.status == "paid", Payment.type != "refund")
                      .group_by(Payment.membership_id)).all()
    return {mid: int(total) for mid, total in rows}


def paid_for_bookings(db: Session, booking_ids) -> dict:
    """What was paid for each booking beyond its fee — i.e. for a single entry."""
    ids = list(booking_ids)
    if not ids:
        return {}
    rows = db.execute(select(Payment.class_booking_id, func.coalesce(func.sum(Payment.amount_cents), 0))
                      .where(Payment.class_booking_id.in_(ids), Payment.status == "paid", Payment.type != "refund")
                      .group_by(Payment.class_booking_id)).all()
    fees = {f.booking_id: f.amount_cents for f in db.scalars(select(ClassFee).where(
        ClassFee.booking_id.in_(ids), ClassFee.status == "paid")).all()}
    return {bid: max(0, int(total) - fees.get(bid, 0)) for bid, total in rows}
