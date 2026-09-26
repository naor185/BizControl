"""
Check-in at the door with a QR code (classes extras 5).

One code per business, printed at the entrance: a link to the business's check-in page on BizFind with a
secret key (studio_settings.class_checkin_token) — it cannot be guessed, and the owner can replace it at any
time (the old one stops working). The client scans it with their phone, signed in on BizFind:
- booked into a class that starts now → marked as attended at once (the entry is consumed as when the staff
  mark it; the staff see it in the class list);
- not booked → when the owner allows it (checkin_walk_in, on by default), the classes starting now that have
  a spot and that their membership covers are offered — one tap books them and marks them as attended (no
  "booked" message: they are at the door). Otherwise, and when there is none: "go to the front desk".
"Now" is the owner's window (checkin_opens_minutes before a class starts until checkin_closes_minutes after).
A client of the business is found by phone, as everywhere on BizFind.
"""
from __future__ import annotations

import hmac
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession, ClassTemplate
from app.services import classes as svc
from app.services import memberships as ms
from app.services import policies


class CheckinError(ValueError):
    pass


def code(db: Session, studio_id, *, renew: bool = False) -> str:
    """The business's check-in key — made the first time it is asked for; renew = a new one (the old one stops working)."""
    from app.models.studio_settings import StudioSettings
    s = db.get(StudioSettings, studio_id)
    if s is None:
        raise CheckinError("הגדרות העסק לא נמצאו")
    if renew or not s.class_checkin_token:
        s.class_checkin_token = secrets.token_urlsafe(24)
        db.flush()
    return s.class_checkin_token


def valid(db: Session, studio_id, key: str | None) -> bool:
    from app.models.studio_settings import StudioSettings
    s = db.get(StudioSettings, studio_id)
    return bool(key and s and s.class_checkin_token and hmac.compare_digest(key, s.class_checkin_token))


def _now_sessions(db: Session, studio_id) -> list[ClassSession]:
    now = svc.now_utc()
    before = timedelta(minutes=policies.get_policy(db, studio_id, "checkin_opens_minutes"))
    after = timedelta(minutes=policies.get_policy(db, studio_id, "checkin_closes_minutes"))
    return list(db.scalars(select(ClassSession).where(
        ClassSession.studio_id == studio_id, ClassSession.status == "scheduled",
        ClassSession.starts_at <= now + before, ClassSession.starts_at >= now - after).order_by(ClassSession.starts_at)).all())


def _names(db: Session, sessions) -> dict:
    ids = {s.template_id for s in sessions if s.template_id}
    return {t.id: t.name for t in db.scalars(select(ClassTemplate).where(ClassTemplate.id.in_(ids))).all()} if ids else {}


def _line(names: dict, s: ClassSession) -> dict:
    return {"session_id": str(s.id), "name": names.get(s.template_id, "שיעור"), "starts_at": s.starts_at.isoformat()}


def _walk_in_why_not(db: Session, s: ClassSession, client) -> str | None:
    from app.services import courses
    from app.services.class_waitlist import spots_left
    t = db.get(ClassTemplate, s.template_id) if s.template_id else None
    if courses.is_course(t) and not courses.rule(db, t, "course_drop_in"):
        return "ההרשמה היא לקורס כולו"
    if spots_left(db, s, client.id) <= 0:
        return "השיעור מלא"
    if ms.uses_memberships(db, s.studio_id):
        m, why = ms.find_eligible(db, client.id, s)
        return None if m else why
    return None


def check_in(db: Session, studio_id, client) -> dict:
    """The scan: marks the client's bookings in the classes starting now as attended, or — none — offers the
    classes they may walk into (the owner's choice)."""
    from app.services import class_bookings as bookings
    sessions = _now_sessions(db, studio_id)
    names = _names(db, sessions)
    mine = {b.session_id: b for b in db.scalars(select(ClassBooking).where(
        ClassBooking.client_id == client.id, ClassBooking.session_id.in_([s.id for s in sessions]),
        ClassBooking.status.in_(("booked", "attended")))).all()} if sessions else {}
    checked, already = [], []
    for s in sessions:
        b = mine.get(s.id)
        if b is None:
            continue
        if b.status == "attended":
            already.append(_line(names, s))
        else:
            bookings.mark(db, b, "attended")
            checked.append(_line(names, s))
    options = []
    if not checked and not already and policies.get_policy(db, studio_id, "checkin_walk_in"):
        from app.services.class_waitlist import spots_left
        options = [{**_line(names, s), "spots_left": spots_left(db, s, client.id)}
                   for s in sessions if s.id not in mine and _walk_in_why_not(db, s, client) is None]
    return {"checked_in": checked, "already": already, "options": options}


def walk_in(db: Session, studio_id, client, session: ClassSession) -> dict:
    """One tap at the door: booked into a class starting now and marked as attended."""
    from app.services import class_bookings as bookings
    if not policies.get_policy(db, studio_id, "checkin_walk_in"):
        raise CheckinError("הרשמה בכניסה — דרך הדלפק")
    if session.id not in {s.id for s in _now_sessions(db, studio_id)}:
        raise CheckinError("השיעור לא מתחיל עכשיו")
    why = _walk_in_why_not(db, session, client)
    if why:
        raise CheckinError(why)
    b = bookings.book(db, session, client, origin="user", notify_booked=False)
    bookings.mark(db, b, "attended")
    return _line(_names(db, [session]), session)
