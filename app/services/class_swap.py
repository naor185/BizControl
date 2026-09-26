"""
Moving a booking to another class in one step — a class swap, by the staff or by the client on BizFind.

- The old booking steps aside as an on-time cancellation whatever the hour (a swap is not a late
  cancellation, and no fee is recorded) and its punch-card entry goes back; the new class takes an entry
  as any booking does — so the card never pays twice and never loses an entry. A paid single entry moves
  with its payment.
- The new class must be open (scheduled, not started), have a spot, and be covered by a membership —
  the same rules as booking. A client on BizFind also needs the class's booking window open, and the
  owner's rule (class_swap): only while cancelling is still free (the default), until the class starts,
  or not at all (then only through the business). The staff may swap until the class starts.
- The client gets one message (class_swapped); the freed spot goes to the first in the old class's waitlist.
- All or nothing: a refusal leaves both classes as they were (the caller rolls back).
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession, ClassTemplate
from app.services import classes as svc
from app.services import memberships as ms
from app.services import notifications, policies

WINDOW = timedelta(days=14)             # how far ahead the classes offered for a swap reach


class SwapError(ValueError):
    pass


def client_may_swap(db: Session, s: ClassSession) -> str | None:
    """None when a client may swap out of this class on BizFind now; otherwise the reason."""
    rule = policies.get_policy(db, s.studio_id, "class_swap", template_id=s.template_id)
    if rule == "off":
        return "החלפת שיעור אפשרית רק דרך העסק"
    from app.services.class_self_booking import free_cancel_until
    if rule == "free_cancel" and svc.now_utc() > free_cancel_until(db, s):
        return "כבר מאוחר להחליף את השיעור הזה"
    return None


def _step_aside(db: Session, booking: ClassBooking, *, user_id=None) -> None:
    """The old booking as an on-time cancellation — its entry back, its spot free."""
    booking.status, booking.canceled_at, booking.canceled_by = "canceled", svc.now_utc(), user_id
    booking.cancel_reason = "swapped"
    ms.settle(db, booking, "return", reason="הוחלף לשיעור אחר", user_id=user_id)
    db.flush()


def _check_old(db: Session, booking: ClassBooking, *, for_client: bool) -> ClassSession:
    if booking.status != "booked":
        raise SwapError("ההרשמה כבר לא פעילה")
    old = db.get(ClassSession, booking.session_id)
    if old.status != "scheduled" or old.starts_at <= svc.now_utc():
        raise SwapError("השיעור כבר התחיל — אי אפשר להחליף")
    if for_client:
        why = client_may_swap(db, old)
        if why:
            raise SwapError(why)
    return old


def _why_not(db: Session, s: ClassSession, client, booking: ClassBooking, *, for_client: bool) -> str | None:
    """Why this client cannot move into this class now (with the old booking already stepped aside)."""
    from app.services import class_self_booking as selfb
    from app.services.class_waitlist import spots_left
    if s.id == booking.session_id:
        return "זה אותו שיעור"
    if db.scalar(select(ClassBooking.id).where(ClassBooking.session_id == s.id, ClassBooking.client_id == client.id,
                                               ClassBooking.status.in_(svc.HOLDS_SPOT))):
        return "כבר רשום/ה לשיעור הזה"
    spots = spots_left(db, s, client.id)
    if for_client:
        return selfb.why_not(db, s, client, spots_left=spots, booked=False)
    if s.status != "scheduled" or s.starts_at <= svc.now_utc():
        return "השיעור כבר התחיל"
    if spots <= 0:
        return "השיעור מלא"
    if booking.drop_in or not ms.uses_memberships(db, s.studio_id):
        return None
    m, why = ms.find_eligible(db, client.id, s)
    return None if m else why


def options(db: Session, booking: ClassBooking, *, for_client: bool) -> dict:
    """The classes of the next two weeks this booking could move to — each with why not, when it cannot.
    Worked out as if the old booking had stepped aside (so its entry counts as free), then undone."""
    from app.models.client import Client
    try:
        old = _check_old(db, booking, for_client=for_client)
    except SwapError as e:
        return {"allowed": False, "reason": str(e), "sessions": []}
    client = db.get(Client, booking.client_id)
    now = svc.now_utc()
    sessions = db.scalars(select(ClassSession).where(
        ClassSession.studio_id == booking.studio_id, ClassSession.status == "scheduled", ClassSession.id != old.id,
        ClassSession.starts_at > now, ClassSession.starts_at < now + WINDOW).order_by(ClassSession.starts_at)).all()
    tpl_ids = {s.template_id for s in sessions if s.template_id}
    names = {t.id: t.name for t in db.scalars(select(ClassTemplate).where(ClassTemplate.id.in_(tpl_ids))).all()} if tpl_ids else {}
    from app.services.class_waitlist import spots_left
    out = []
    savepoint = db.begin_nested()
    try:
        _step_aside(db, booking)
        for s in sessions:
            why = _why_not(db, s, client, booking, for_client=for_client)
            out.append({"id": str(s.id), "name": names.get(s.template_id, "שיעור"), "starts_at": s.starts_at.isoformat(),
                        "spots_left": spots_left(db, s, client.id), "can_swap": why is None, "why_not": why})
    finally:
        savepoint.rollback()
    return {"allowed": True, "reason": None, "sessions": out}


def swap(db: Session, booking: ClassBooking, target: ClassSession, *, user_id=None, origin: str = "user",
         for_client: bool = False) -> ClassBooking:
    """Moves the booking into the target class. Returns the new booking; the caller commits (or rolls back)."""
    from app.models.client import Client
    from app.models.payment import Payment
    from app.services import class_bookings as bookings
    from app.services.class_waitlist import promote
    old = _check_old(db, booking, for_client=for_client)
    if target.studio_id != booking.studio_id:
        raise SwapError("השיעור לא נמצא")
    client = db.get(Client, booking.client_id)
    _step_aside(db, booking, user_id=user_id)          # first — so a punch card's last entry can pay for the new class
    why = _why_not(db, target, client, booking, for_client=for_client)
    if why:
        raise SwapError(why)
    new = bookings.book(db, target, client, user_id=user_id, origin=origin, drop_in=booking.drop_in, notify_booked=False)
    new.swapped_from_booking_id = booking.id
    if booking.drop_in:                                 # the single entry's payment moves with it
        for p in db.scalars(select(Payment).where(Payment.class_booking_id == booking.id)).all():
            p.class_booking_id = new.id
    d, t = svc.il_date_time(old.starts_at)
    ctx = svc._context(db, target)
    old_name = svc._context(db, old)["class_name"]
    notifications.notify(db, target.studio_id, "class_swapped", origin=origin, about=f"booking:{new.id}:swap",
                         context={**ctx, "swap_note": f"במקום {old_name} ב-{d} בשעה {t}."}, clients=[client])
    db.flush()
    promote(db, old)                                     # the freed spot goes to the first in line
    return new
