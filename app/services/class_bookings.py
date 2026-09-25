"""
Bookings for group classes — booking a client into a session, cancelling, attendance, and the two
background checks before a class (the reminder, the minimum participants).

- A booking holds a spot while it is booked, attended or no_show; a cancelled or late-cancelled one
  frees it. A full session refuses a booking; the owner or a manager may book beyond the spots
  (limits.override) and the booking says so (over_capacity). The session row is locked while the spots
  are counted, so two people cannot take the last spot at the same moment.
- Cancelling inside the free-cancel window (the owner's free_cancel_hours — the class's own if it has
  one) is a late cancellation: the booking stays as late_canceled (what that costs comes with
  memberships, stage 4). Staff can cancel without it counting as late (waive_late). A client who
  cancelled late and books again gets the same booking back.
- Attendance (attended / no_show) can be marked from an hour before the class.
- Before a class: the reminder reminder_hours ahead (0 = none), and the minimum-participants check
  min_check_hours ahead — below the minimum the class is cancelled (when the owner turned automatic
  cancelling on) or the staff are alerted. Each runs once per session.
Every message goes through notifications.notify(); a client's messages are service messages.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession
from app.services import classes as svc
from app.services import notifications, policies

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


def book(db: Session, session: ClassSession, client, *, user_id=None, origin: str = "user",
         over_capacity_ok: bool = False) -> ClassBooking:
    """Books a client into a session and sends the confirmation (class_booked)."""
    s = db.execute(select(ClassSession).where(ClassSession.id == session.id).with_for_update()).scalar_one()
    if s.status != "scheduled":
        raise BookingError("השיעור בוטל")
    if s.ends_at <= svc.now_utc():
        raise BookingError("השיעור כבר הסתיים")
    if client.studio_id != s.studio_id:
        raise BookingError("הלקוח לא נמצא")
    existing = db.scalar(select(ClassBooking).where(ClassBooking.session_id == s.id, ClassBooking.client_id == client.id,
                                                    ClassBooking.status != "canceled"))
    if existing and existing.status != "late_canceled":
        raise BookingError(f"{client.full_name}: כבר ברשימה של השיעור")
    taken = holding(db, s.id)
    over = taken >= s.capacity
    if over and not over_capacity_ok:
        raise FullError("השיעור מלא")
    now = svc.now_utc()
    if existing:                                   # a late cancellation taken back
        b = existing
        b.status, b.canceled_at, b.cancel_reason, b.canceled_by, b.over_capacity = "booked", None, None, None, over
    else:
        b = ClassBooking(studio_id=s.studio_id, session_id=s.id, client_id=client.id, status="booked",
                         source=origin, created_by=user_id, over_capacity=over)
        db.add(b)
    db.flush()
    ctx = svc._context(db, s)
    notifications.notify(db, s.studio_id, "class_booked", origin=origin, about=f"booking:{b.id}:{now.isoformat()}",
                         context=ctx, clients=[client])
    if not over and taken + 1 >= s.capacity:
        notifications.notify(db, s.studio_id, "class_full", origin=origin, about=f"session:{s.id}:full", context=ctx)
    return b


def cancel(db: Session, booking: ClassBooking, *, user_id=None, origin: str = "user", waive_late: bool = False) -> str:
    """Cancels a booking — late inside the free-cancel window unless waived — and tells the client.
    Returns the new status."""
    if booking.status != "booked":
        raise BookingError("ההרשמה כבר לא פעילה")
    from app.models.client import Client
    s = db.get(ClassSession, booking.session_id)
    now = svc.now_utc()
    late = (not waive_late and s.status == "scheduled"
            and policies.is_late_cancel(db, s.studio_id, s.starts_at, now, template_id=s.template_id))
    booking.status = "late_canceled" if late else "canceled"
    booking.canceled_at, booking.canceled_by = now, user_id
    booking.cancel_reason = "late" if late else ("waived" if waive_late else "on_time")
    db.flush()
    # entry_note: what happened to the client's entry — filled once memberships exist (stage 4)
    notifications.notify(db, s.studio_id, "booking_cancelled", origin=origin,
                         about=f"booking:{booking.id}:cancel:{now.isoformat()}",
                         context={**svc._context(db, s), "entry_note": ""}, clients=[db.get(Client, booking.client_id)])
    return booking.status


def mark(db: Session, booking: ClassBooking, status: str, *, user_id=None) -> None:
    """Attendance: attended / no_show — or back to booked."""
    if status not in ("attended", "no_show", "booked"):
        raise BookingError("סימון לא מוכר")
    if booking.status not in HOLDS_SPOT:
        raise BookingError("ההרשמה בוטלה")
    s = db.get(ClassSession, booking.session_id)
    if s.status not in ("scheduled", "done"):
        raise BookingError("השיעור בוטל")
    if svc.now_utc() < s.starts_at - MARK_FROM:
        raise BookingError("אפשר לסמן נוכחות משעה לפני השיעור")
    booking.status = status
    booking.marked_at, booking.marked_by = (None, None) if status == "booked" else (svc.now_utc(), user_id)
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
