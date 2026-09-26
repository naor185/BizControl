"""
A course — a class template with an end date or a number of sessions — with one registration and one price
for all its sessions (classes extras 4).

- Enrolling books the client into every coming session of the course at once (all or nothing: a full
  session refuses the whole enrollment). The owner's rules decide (the business's default, or the course's
  own): whether a membership covers the course (then each session takes an entry as any booking, and there
  is no course price) or it is paid separately (course_price_cents); joining after the course began — for
  the sessions that are left, at full price, or not at all; whether a single session may be booked alone;
  whether clients enroll themselves on BizFind.
- The price is fixed on the enrollment (the staff may change it — a discount, a sibling). Payments and
  refunds are recorded on it (payments.course_enrollment_id), never collected.
- Cancelling an enrollment cancels its coming sessions (entries back, no late-cancel rule — the course is
  paid) and works out the refund the owner's rule gives: decided case by case (the default), in full until
  some days before the first session, or for the sessions that are left. The refund is recorded when the
  staff record it.
- The client gets one message when enrolled (course_enrolled) and one when the enrollment is cancelled
  (course_left). Cancelling a single session of a course is an ordinary on-time cancellation.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession, ClassTemplate, CourseEnrollment
from app.services import classes as svc
from app.services import memberships as ms
from app.services import notifications, policies

HOLDING = ("waiting", "offered", "active")


class CourseError(ValueError):
    pass


def is_course(t: ClassTemplate | None) -> bool:
    """A course: an end date or several sessions. One session is a one-time class, not a course."""
    return bool(t and (t.ends_on or (t.sessions_count and t.sessions_count > 1)))


def rule(db: Session, t: ClassTemplate, key: str):
    return policies.get_policy(db, t.studio_id, key, template_id=t.id)


def sessions(db: Session, t: ClassTemplate, *, coming_only: bool = False) -> list[ClassSession]:
    q = select(ClassSession).where(ClassSession.template_id == t.id, ClassSession.status != "canceled")
    if coming_only:
        q = q.where(ClassSession.starts_at > svc.now_utc())
    return list(db.scalars(q.order_by(ClassSession.starts_at)).all())


def covered_by_membership(db: Session, t: ClassTemplate) -> bool:
    return ms.uses_memberships(db, t.studio_id) and bool(rule(db, t, "course_covered_by_membership"))


def price_now(db: Session, t: ClassTemplate) -> int | None:
    """What joining now costs — the course price, or for the sessions that are left (the owner's rule)."""
    if covered_by_membership(db, t) or t.course_price_cents is None:
        return None
    every, coming = sessions(db, t), sessions(db, t, coming_only=True)
    if not coming:
        return None
    if len(coming) < len(every) and rule(db, t, "course_late_join") == "prorated":
        return round(t.course_price_cents * len(coming) / len(every) / 100) * 100          # whole shekels
    return t.course_price_cents


def enrollment_of(db: Session, t: ClassTemplate, client_id, statuses=HOLDING) -> CourseEnrollment | None:
    return db.scalar(select(CourseEnrollment).where(CourseEnrollment.template_id == t.id, CourseEnrollment.client_id == client_id,
                                                    CourseEnrollment.status.in_(statuses)))


def enrolled_count(db: Session, t: ClassTemplate) -> int:
    return db.scalar(select(func.count()).select_from(CourseEnrollment).where(
        CourseEnrollment.template_id == t.id, CourseEnrollment.status == "active")) or 0


def why_not_enroll(db: Session, t: ClassTemplate, client, *, for_client: bool = False, taking_offer: bool = False) -> str | None:
    """None when this client may enroll now; otherwise the reason, in the client's words."""
    from app.services.class_waitlist import spots_left
    if not is_course(t) or not t.is_active:
        return "הקורס לא פתוח להרשמה"
    if for_client and not rule(db, t, "course_self_enroll"):
        return "ההרשמה לקורס דרך העסק"
    coming = sessions(db, t, coming_only=True)
    if not coming:
        return "הקורס הסתיים"
    if len(coming) < len(sessions(db, t)) and rule(db, t, "course_late_join") == "no":
        return "הקורס כבר התחיל וההרשמה אליו נסגרה"
    mine = enrollment_of(db, t, client.id)
    if mine and mine.status == "active":
        return "כבר רשום/ה לקורס"
    if not taking_offer and held_for_others(db, t, client.id):
        return "הקורס מלא"
    if any(spots_left(db, s, client.id) <= 0 for s in coming):
        return "הקורס מלא"
    return None


def held_for_others(db: Session, t: ClassTemplate, client_id=None) -> int:
    """Spots of the course offered from its waitlist and still held — for anyone but this client."""
    q = select(func.count()).select_from(CourseEnrollment).where(
        CourseEnrollment.template_id == t.id, CourseEnrollment.status == "offered",
        CourseEnrollment.offer_expires_at > svc.now_utc())
    if client_id is not None:
        q = q.where(CourseEnrollment.client_id != client_id)
    return db.scalar(q) or 0


def _course_note(db: Session, t: ClassTemplate, e: CourseEnrollment, first: ClassSession) -> str:
    d, tm = svc.il_date_time(first.starts_at)
    note = f"{e.sessions_total} מפגשים, הראשון ב-{d} בשעה {tm}."
    if e.price_cents:
        note += f" המחיר: ₪{e.price_cents / 100:,.0f} — התשלום בעסק."
    return note


def enroll(db: Session, t: ClassTemplate, client, *, price_cents: int | None = None, user_id=None, origin: str = "user",
           for_client: bool = False, enrollment: CourseEnrollment | None = None) -> CourseEnrollment:
    """Books the client into every coming session of the course. `enrollment`: a waiter's row, taken up."""
    from app.services import class_bookings as bookings
    why = why_not_enroll(db, t, client, for_client=for_client, taking_offer=enrollment is not None)
    if why:
        raise CourseError(why)
    coming = sessions(db, t, coming_only=True)
    covered = covered_by_membership(db, t)
    if covered:
        price = 0
    elif price_cents is not None:
        price = price_cents                                  # the staff's price (a discount, a sibling…)
    else:
        price = price_now(db, t) or 0
    now = svc.now_utc()
    enrollment = enrollment or enrollment_of(db, t, client.id, ("waiting", "offered"))   # a waiter enrolled by the staff
    e = enrollment or CourseEnrollment(studio_id=t.studio_id, template_id=t.id, client_id=client.id, source=origin, created_by=user_id)
    e.status, e.price_cents, e.sessions_total, e.enrolled_at = "active", price, len(coming), now
    e.position, e.offer_expires_at = None, None
    if enrollment is None:
        db.add(e)
    db.flush()
    for s in coming:                                         # all or nothing — a refusal rolls the whole enrollment back
        bookings.book(db, s, client, user_id=user_id, origin=origin, notify_booked=False, enrollment=e)
    notifications.notify(db, t.studio_id, "course_enrolled", origin=origin, about=f"enrollment:{e.id}",
                         context={**svc._context(db, coming[0]), "course_note": _course_note(db, t, e, coming[0])}, clients=[client])
    db.flush()
    return e


def paid(db: Session, enrollment_ids) -> dict:
    """{enrollment_id: {"paid": cents, "refunded": cents}}."""
    from app.models.payment import Payment
    ids = list(enrollment_ids)
    out = {i: {"paid": 0, "refunded": 0} for i in ids}
    if not ids:
        return out
    for eid, kind, total in db.execute(select(Payment.course_enrollment_id, Payment.type, func.coalesce(func.sum(Payment.amount_cents), 0))
                                       .where(Payment.course_enrollment_id.in_(ids), Payment.status == "paid")
                                       .group_by(Payment.course_enrollment_id, Payment.type)).all():
        out[eid]["refunded" if kind == "refund" else "paid"] += int(total)
    return out


def refund_due(db: Session, e: CourseEnrollment) -> int | None:
    """What the owner's rule gives back if the enrollment is cancelled now — None when the owner decides case
    by case. Of what was paid (less what was already refunded)."""
    t = db.get(ClassTemplate, e.template_id)
    money = paid(db, [e.id])[e.id]
    net = max(0, money["paid"] - money["refunded"])
    how = rule(db, t, "course_refund")
    if how == "manual":
        return None
    if not net:
        return 0
    if how == "full_until":
        first = sessions(db, t)
        limit = first[0].starts_at - timedelta(days=rule(db, t, "course_refund_days")) if first else None
        return net if limit and svc.now_utc() <= limit else 0
    left = db.scalar(select(func.count()).select_from(ClassBooking).join(ClassSession, ClassSession.id == ClassBooking.session_id)
                     .where(ClassBooking.enrollment_id == e.id, ClassBooking.status == "booked",
                            ClassSession.starts_at > svc.now_utc())) or 0
    return round(net * left / e.sessions_total / 100) * 100 if e.sessions_total else 0


def cancel(db: Session, e: CourseEnrollment, *, user_id=None, origin: str = "user", reason: str | None = None) -> dict:
    """Cancels the enrollment and its coming sessions (entries back, no late-cancel rule). Returns the refund
    the owner's rule gives (None: the owner decides)."""
    from app.models.client import Client
    if e.status != "active":
        raise CourseError("ההרשמה לקורס כבר לא פעילה")
    t = db.get(ClassTemplate, e.template_id)
    due = refund_due(db, e)
    now = svc.now_utc()
    rows = db.scalars(select(ClassBooking).join(ClassSession, ClassSession.id == ClassBooking.session_id)
                      .where(ClassBooking.enrollment_id == e.id, ClassBooking.status == "booked", ClassSession.starts_at > now)).all()
    for b in rows:
        b.status, b.canceled_at, b.canceled_by, b.cancel_reason = "canceled", now, user_id, "course_canceled"
        ms.settle(db, b, "return", reason="ההרשמה לקורס בוטלה", user_id=user_id)
    e.status, e.canceled_at, e.canceled_by = "canceled", now, user_id
    e.cancel_reason = (reason or "").strip()[:300] or None
    db.flush()
    note = f"לפי מדיניות העסק מגיע לך החזר של ₪{due / 100:,.0f}." if due else ""
    notifications.notify(db, t.studio_id, "course_left", origin=origin, about=f"enrollment:{e.id}:cancel",
                         context={"class_name": t.name, "course_note": note}, clients=[db.get(Client, e.client_id)])
    from app.services.class_waitlist import promote
    for s in {b.session_id for b in rows}:                   # a session's own waitlist (a single session, when allowed)
        promote(db, db.get(ClassSession, s))
    return {"canceled_sessions": len(rows), "refund_due_cents": due}


def record_refund(db: Session, e: CourseEnrollment, amount_cents: int, method: str, *, user_id=None, notes: str | None = None):
    """A refund given back for the course — recorded (never paid out by the system), up to what was paid."""
    from app.models.payment import Payment
    from app.services.class_payments import METHODS
    money = paid(db, [e.id])[e.id]
    if amount_cents <= 0:
        raise CourseError("סכום ההחזר חסר")
    if amount_cents > money["paid"] - money["refunded"]:
        raise CourseError("ההחזר גדול ממה ששולם")
    if method not in METHODS:
        raise CourseError("אמצעי תשלום לא מוכר")
    p = Payment(studio_id=e.studio_id, appointment_id=None, client_id=e.client_id, course_enrollment_id=e.id,
                amount_cents=amount_cents, currency="ILS", type="refund", status="paid", method=method,
                notes=(notes or "החזר על קורס")[:500])
    db.add(p)
    db.flush()
    return p
