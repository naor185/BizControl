"""
Bookings for group classes — booking a client into a session, cancelling, attendance, and the two
background checks before a class (the reminder, the minimum participants).

- A booking holds a spot while it is booked, attended or no_show; a cancelled or late-cancelled one
  frees it. A full session refuses a booking; the owner or a manager may book beyond the spots
  (limits.override) and the booking says so (over_capacity). The session row is locked while the spots
  are counted, so two people cannot take the last spot at the same moment.
- With memberships on, a booking needs a membership that covers the class (app/services/memberships)
  — it reserves an entry on a punch card — or a paid single entry the staff record (drop_in).
- Cancelling inside the free-cancel window (the owner's free_cancel_hours — the class's own if it has
  one) is a late cancellation and the owner's rule applies (app/services/penalties); on time, the
  entry goes back. Staff can cancel without it counting as late (waive_late), or mark a late
  cancellation or a no-show as justified. A client who cancelled late and books again: that late
  cancellation no longer counts.
- Attendance (attended / no_show) can be marked from an hour before the class.
- A course (app/services/courses.py) is booked as a whole — one enrollment books every coming session; a
  single session of it only when the owner allows it (course_drop_in). A session booked by an enrollment
  needs no membership unless the owner set memberships to cover the course, and cancelling or missing it
  applies no late-cancel / no-show rule — the course is paid.
- Before a class: the reminder reminder_hours ahead (0 = none), and the minimum-participants check
  min_check_hours ahead — below the minimum the class is cancelled (when the owner turned automatic
  cancelling on) or the staff are alerted. Each runs once per session.
Every message goes through notifications.notify(); a client's messages are service messages.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession, ClassTemplate
from app.services import classes as svc
from app.services import memberships as ms
from app.services import notifications, penalties, policies

HOLDS_SPOT = svc.HOLDS_SPOT
MARK_FROM = timedelta(hours=1)          # attendance can be marked from an hour before the class
LOOK_AHEAD = timedelta(hours=72)        # the longest reminder / check time the settings allow


class BookingError(ValueError):
    pass


class FullError(BookingError):
    pass


def holding(db: Session, session_id) -> int:
    return db.scalar(select(func.count()).select_from(ClassBooking).where(
        ClassBooking.session_id == session_id, ClassBooking.status.in_(HOLDS_SPOT))) or 0


class NotEligible(BookingError):
    """No membership covers this class for this client (the reason is the message)."""


def eligibility(db: Session, session: ClassSession, client) -> dict:
    """What covers this client for this class — for the screen before booking."""
    if not ms.uses_memberships(db, session.studio_id):
        return {"required": False, "membership": None, "reason": None}
    m, why = ms.find_eligible(db, client.id, session)
    bal = ms.balance(db, [m.id]).get(m.id) if m and m.rules.get("kind") == "punch" else None
    return {"required": True, "membership": ms.label(m, bal), "reason": why}


def book(db: Session, session: ClassSession, client, *, user_id=None, origin: str = "user",
         over_capacity_ok: bool = False, drop_in: bool = False, notify_booked: bool = True, enrollment=None) -> ClassBooking:
    """Books a client into a session and sends the confirmation (class_booked). When the business uses
    memberships, a membership must cover the class — or the staff record a paid single entry (drop_in)."""
    s = db.execute(select(ClassSession).where(ClassSession.id == session.id).with_for_update()).scalar_one()
    if s.status != "scheduled":
        raise BookingError("השיעור בוטל")
    if s.ends_at <= svc.now_utc():
        raise BookingError("השיעור כבר הסתיים")
    if client.studio_id != s.studio_id:
        raise BookingError("הלקוח לא נמצא")
    from app.services import courses
    tpl = db.get(ClassTemplate, s.template_id) if s.template_id else None
    course = courses.is_course(tpl)
    if course and enrollment is None and not courses.rule(db, tpl, "course_drop_in"):
        raise BookingError("ההרשמה היא לקורס כולו")
    existing = db.scalar(select(ClassBooking).where(ClassBooking.session_id == s.id, ClassBooking.client_id == client.id,
                                                    ClassBooking.status != "canceled"))
    if existing and existing.status != "late_canceled":
        raise BookingError(f"{client.full_name}: כבר ברשימה של השיעור")
    from app.services.class_waitlist import held_for_others
    taken = holding(db, s.id) + held_for_others(db, s.id, client.id)     # a spot offered to a waiter is theirs
    over = taken >= s.capacity
    if over and not over_capacity_ok:
        raise FullError("השיעור מלא")
    membership = None
    paid_course = enrollment is not None and not courses.covered_by_membership(db, tpl)
    if ms.uses_memberships(db, s.studio_id) and not drop_in and not paid_course:
        membership, why = ms.find_eligible(db, client.id, s)
        if membership is None:
            raise NotEligible(f"{why} — אפשר לרשום ככניסה בודדת")
    now = svc.now_utc()
    if existing:
        # a late cancellation taken back: it no longer counts — its fee is waived, its entry returned
        penalties.waive_fee(db, existing.id, "נרשם/ה מחדש לאותו שיעור", user_id=user_id)
        ms.settle(db, existing, "return", reason="נרשם/ה מחדש לאותו שיעור", user_id=user_id)
        existing.status, existing.cancel_reason = "canceled", "rebooked"
        db.flush()
    b = ClassBooking(studio_id=s.studio_id, session_id=s.id, client_id=client.id, status="booked",
                     source=origin, created_by=user_id, over_capacity=over, drop_in=drop_in,
                     enrollment_id=enrollment.id if enrollment is not None else None)
    db.add(b)
    db.flush()
    if membership is not None:
        ms.reserve(db, b, membership, user_id=user_id, origin=origin)
    from app.models.wait_list import WaitListEntry
    for e in db.scalars(select(WaitListEntry).where(WaitListEntry.session_id == s.id, WaitListEntry.client_id == client.id,
                                                    WaitListEntry.status.in_(("waiting", "notified")))).all():
        e.status, e.confirmed_at, e.booking_id = "confirmed", now, b.id      # was waiting — now booked
    ctx = svc._context(db, s)
    if notify_booked:                      # the waitlist sends its own message (waitlist_promoted)
        notifications.notify(db, s.studio_id, "class_booked", origin=origin, about=f"booking:{b.id}:{now.isoformat()}",
                             context=ctx, clients=[client])
    if not over and taken + 1 >= s.capacity:
        notifications.notify(db, s.studio_id, "class_full", origin=origin, about=f"session:{s.id}:full", context=ctx)
    return b


def cancel(db: Session, booking: ClassBooking, *, user_id=None, origin: str = "user", waive_late: bool = False) -> str:
    """Cancels a booking and tells the client. Inside the free-cancel window it is a late cancellation
    and the owner's rule applies (penalties) — unless the staff waive it. Returns the new status."""
    if booking.status != "booked":
        raise BookingError("ההרשמה כבר לא פעילה")
    from app.models.client import Client
    s = db.get(ClassSession, booking.session_id)
    now = svc.now_utc()
    late = (not waive_late and not booking.from_waitlist and not booking.enrollment_id     # from the waitlist, a paid course: free
            and s.status == "scheduled"
            and policies.is_late_cancel(db, s.studio_id, s.starts_at, now, template_id=s.template_id))
    booking.status = "late_canceled" if late else "canceled"
    booking.canceled_at, booking.canceled_by = now, user_id
    booking.cancel_reason = "late" if late else ("waived" if waive_late else "on_time")
    db.flush()
    if late:
        penalties.apply(db, booking, "late_cancel", user_id=user_id, origin=origin)
    else:
        ms.settle(db, booking, "return", reason="ביטול בזמן" if not waive_late else "ביטול בלי חיוב", user_id=user_id)
    notifications.notify(db, s.studio_id, "booking_cancelled", origin=origin,
                         about=f"booking:{booking.id}:cancel:{now.isoformat()}",
                         context={**svc._context(db, s), "entry_note": ms.entry_note(db, booking)},
                         clients=[db.get(Client, booking.client_id)])
    from app.services.class_waitlist import promote
    promote(db, s)                          # the freed spot goes to the first in line
    return booking.status


def mark(db: Session, booking: ClassBooking, status: str, *, user_id=None) -> None:
    """Attendance: attended (the entry is consumed), no_show (the owner's rule applies) — or back to
    booked. Changing it later undoes what the earlier mark did (a fee from a no-show is waived and
    comes back if it is a no-show again)."""
    if status not in ("attended", "no_show", "booked"):
        raise BookingError("סימון לא מוכר")
    if booking.status not in HOLDS_SPOT:
        raise BookingError("ההרשמה בוטלה")
    s = db.get(ClassSession, booking.session_id)
    if s.status not in ("scheduled", "done"):
        raise BookingError("השיעור בוטל")
    if svc.now_utc() < s.starts_at - MARK_FROM:
        raise BookingError("אפשר לסמן נוכחות משעה לפני השיעור")
    if status == booking.status:
        return
    from app.models.client import Client
    client = db.get(Client, booking.client_id)
    was = booking.status
    booking.status = status
    booking.marked_at, booking.marked_by = (None, None) if status == "booked" else (svc.now_utc(), user_id)
    booking.justified = False
    if was == "no_show":
        client.no_show_count = max(0, (client.no_show_count or 0) - 1)
        penalties.waive_fee(db, booking.id, penalties.AUTO_WAIVE, user_id=user_id)
    if status == "attended":
        ms.settle(db, booking, "consume", reason="הגיע/ה לשיעור", user_id=user_id)
    elif status == "no_show":
        client.no_show_count = (client.no_show_count or 0) + 1
        if not booking.enrollment_id:                   # a session of a course the client registered for: no fee
            penalties.apply(db, booking, "no_show", user_id=user_id)
    db.flush()


def justify(db: Session, booking: ClassBooking, *, user_id=None) -> None:
    """A late cancellation or a no-show the staff accept as justified: not counted, no fee, the entry
    goes back."""
    if booking.status not in ("late_canceled", "no_show"):
        raise BookingError("אפשר לסמן כמוצדק רק ביטול מאוחר או אי-הגעה")
    if booking.justified:
        return
    booking.justified = True
    penalties.waive_fee(db, booking.id, "מוצדק", user_id=user_id)
    ms.settle(db, booking, "return", reason="סומן כמוצדק", user_id=user_id)
    db.flush()


def mark_all_attended(db: Session, session: ClassSession, *, user_id=None) -> int:
    rows = db.scalars(select(ClassBooking).where(ClassBooking.session_id == session.id, ClassBooking.status == "booked")).all()
    for b in rows:
        mark(db, b, "attended", user_id=user_id)
    return len(rows)


# ── before a class (a job every few minutes) ─────────────────────────────────

def _coming(db: Session, mark_column):
    now = svc.now_utc()
    return now, db.scalars(select(ClassSession).where(
        ClassSession.status == "scheduled", mark_column.is_(None),
        ClassSession.starts_at > now, ClassSession.starts_at <= now + LOOK_AHEAD).order_by(ClassSession.starts_at)).all()


def sweep_reminders(db: Session) -> int:
    """The reminder to everyone booked, reminder_hours before the class. Returns messages queued."""
    now, sessions = _coming(db, ClassSession.reminded_at)
    on, hours, sent = {}, {}, 0
    for s in sessions:
        if not svc.classes_on(db, s.studio_id, on):
            continue
        h = hours.setdefault(s.studio_id, policies.get_policy(db, s.studio_id, "reminder_hours"))
        if not h or s.starts_at - timedelta(hours=h) > now:
            continue
        sent += notifications.notify(db, s.studio_id, "class_reminder", origin="system", about=f"session:{s.id}:reminder",
                                     context=svc._context(db, s), clients=svc.booked_clients(db, s.id))
        s.reminded_at = now
        db.commit()
    return sent


def sweep_min_participants(db: Session) -> int:
    """min_check_hours before a class with a minimum: below it the class is cancelled (automatic
    cancelling on) or the staff are alerted (class_at_risk). Returns how many classes were cancelled."""
    now, sessions = _coming(db, ClassSession.min_checked_at)
    on, cancelled = {}, 0
    for s in sessions:
        if not svc.classes_on(db, s.studio_id, on):
            continue
        minimum = policies.get_policy(db, s.studio_id, "min_participants", template_id=s.template_id)
        if not minimum:
            continue
        hours = policies.get_policy(db, s.studio_id, "min_check_hours", template_id=s.template_id)
        if s.starts_at - timedelta(hours=hours) > now:
            continue
        s.min_checked_at = now
        booked = holding(db, s.id)
        if booked < minimum:
            if policies.get_policy(db, s.studio_id, "auto_cancel_below_min", template_id=s.template_id):
                svc.cancel_session(db, s, origin="system", note="השיעור בוטל כי לא היו מספיק נרשמים.", automatic=True)
                cancelled += 1
            else:
                notifications.notify(db, s.studio_id, "class_at_risk", origin="system", about=f"session:{s.id}:at_risk",
                                     context={**svc._context(db, s), "booked": str(booked), "minimum": str(minimum)})
        db.commit()
    return cancelled
