"""
Pay for teaching group classes — the owner's choice for each staff member (users.class_pay_*), added to the
regular pay (hours, commission, a fixed salary) in the payroll report:

- per_class        a fixed sum for every class taught
- per_participant  a sum for every participant, with an optional minimum per class
- both             the fixed sum plus the sum per participant
- percent          a percentage of the class's single-entry payments (a membership's payment is not tied
                   to one class, so it is not counted; neither is a late-cancel / no-show fee)

A class counts when it took place in the period — it started and was not cancelled — and this staff member
taught it: the class's own instructor, so a substitute is the one paid. Participants are those marked as
attended, or — the owner's choice, for a business that does not mark attendance — everyone booked
(not cancelled).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession
from app.services import classes as svc

MODES = ("none", "per_class", "per_participant", "both", "percent")
COUNTS = ("attended", "booked")
_COUNTED = {"attended": ("attended",), "booked": ("booked", "attended", "no_show")}
CENT = Decimal("0.01")


def class_pay(db: Session, studio_id, user, start: datetime, end: datetime) -> dict:
    """This staff member's classes in the period: how many, how many participants, and the pay."""
    out = {"class_count": 0, "class_participants": 0, "class_pay": Decimal("0.00")}
    mode = user.class_pay_mode or "none"
    if mode == "none":
        return out
    sessions = db.scalars(select(ClassSession).where(
        ClassSession.studio_id == studio_id, ClassSession.instructor_id == user.id, ClassSession.status != "canceled",
        ClassSession.starts_at >= start, ClassSession.starts_at <= min(end, svc.now_utc()))).all()
    if not sessions:
        return out
    ids = [s.id for s in sessions]
    counted = dict(db.execute(select(ClassBooking.session_id, func.count()).where(
        ClassBooking.session_id.in_(ids), ClassBooking.status.in_(_COUNTED[user.class_pay_counts or "attended"]))
        .group_by(ClassBooking.session_id)).all())
    revenue: dict = {}
    if mode == "percent":
        from app.services.class_payments import paid_for_bookings
        bookings = db.execute(select(ClassBooking.id, ClassBooking.session_id).where(ClassBooking.session_id.in_(ids))).all()
        paid = paid_for_bookings(db, [b for b, _ in bookings])
        for b, sid in bookings:
            revenue[sid] = revenue.get(sid, 0) + paid.get(b, 0)

    per_class = Decimal(user.class_pay_per_class or 0)
    per_participant = Decimal(user.class_pay_per_participant or 0)
    total = Decimal("0.00")
    for s in sessions:
        n = counted.get(s.id, 0)
        if mode == "per_class":
            pay = per_class
        elif mode == "per_participant":
            pay = max(Decimal(user.class_pay_minimum or 0), per_participant * n)
        elif mode == "both":
            pay = per_class + per_participant * n
        else:                                   # percent of the class's single-entry payments
            pay = Decimal(revenue.get(s.id, 0)) / 100 * Decimal(user.class_pay_percent or 0) / 100
        total += pay
        out["class_participants"] += n
    out["class_count"] = len(sessions)
    out["class_pay"] = total.quantize(CENT)
    return out
