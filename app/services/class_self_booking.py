"""
Clients booking group classes themselves on BizFind.

The owner's decision (2026-09-25): a client books a class only if they are a client of the business —
the logged-in BizFind customer's phone matches an active client there (as "my businesses" does) — and
have a membership that covers the class (app/services/memberships.find_eligible). No single entries,
no booking beyond the spots — those stay with the staff. It is open when the business has the classes
and memberships modules, the owner did not turn client_booking off, and it has a recurring class.

A client books inside the owner's booking window (booking_opens_days ahead, until
booking_closes_minutes before — the class's own if it has them) and cancels until the class starts;
inside the free-cancel window it is a late cancellation and the owner's rules apply, exactly as when
the staff cancel. A client sees how many spots are left — never who else is booked.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession, ClassTemplate
from app.models.memberships import Membership
from app.services import classes as svc
from app.services import memberships as ms
from app.services import policies


def open_to_clients(db: Session, studio) -> bool:
    if not studio or not ms._module(db, studio.id, "classes") or not ms._module(db, studio.id, "memberships"):
        return False
    if not policies.get_policy(db, studio.id, "client_booking"):
        return False
    return db.scalar(select(ClassTemplate.id).where(ClassTemplate.studio_id == studio.id,
                                                    ClassTemplate.is_active.is_(True)).limit(1)) is not None


def client_of(db: Session, customer_id: str, studio_id):
    """The business's client this BizFind customer is — matched by phone, as "my businesses" does."""
    from app.models.client import Client
    row = db.execute(text("SELECT phone FROM marketplace_customers WHERE id = :id"), {"id": customer_id}).fetchone()
    if not row or not row[0]:
        return None
    return db.scalar(select(Client).where(Client.studio_id == studio_id, Client.phone == row[0],
                                          Client.is_active.is_(True)).order_by(Client.created_at).limit(1))


def booking_window(db: Session, s: ClassSession) -> tuple[datetime, datetime]:
    opens = s.starts_at - timedelta(days=policies.get_policy(db, s.studio_id, "booking_opens_days", template_id=s.template_id))
    closes = s.starts_at - timedelta(minutes=policies.get_policy(db, s.studio_id, "booking_closes_minutes", template_id=s.template_id))
    return opens, closes


def free_cancel_until(db: Session, s: ClassSession) -> datetime:
    return s.starts_at - timedelta(hours=policies.get_policy(db, s.studio_id, "free_cancel_hours", template_id=s.template_id))


def why_not(db: Session, s: ClassSession, client, *, spots_left: int, booked: bool, actor_id=None) -> str | None:
    """None when this client may book this class now; otherwise the reason, in the client's words. actor_id: who
    books — the holder of a family membership booking for someone on it (default: the client themselves)."""
    now = svc.now_utc()
    if client is None:
        return "ההרשמה לשיעורים פתוחה ללקוחות העסק עם מנוי"
    if booked:
        return None
    if s.status != "scheduled" or s.starts_at <= now:
        return "השיעור כבר התחיל" if s.status == "scheduled" else "השיעור בוטל"
    from app.services import courses
    tpl = db.get(ClassTemplate, s.template_id) if s.template_id else None
    if courses.is_course(tpl) and not courses.rule(db, tpl, "course_drop_in"):
        return "ההרשמה היא לקורס כולו"
    opens, closes = booking_window(db, s)
    if now < opens:
        d, t = svc.il_date_time(opens)
        return f"ההרשמה נפתחת ב-{d} בשעה {t}"
    if now > closes:
        return "ההרשמה לשיעור הזה נסגרה"
    if spots_left <= 0:
        return "השיעור מלא"
    m, why = ms.find_eligible(db, client.id, s)
    if m is None:
        return why
    from app.services import membership_family as family
    if family.is_family(m.rules) and m.rules.get("booking_by") == "holder" and (actor_id or client.id) != m.client_id:
        return "ההרשמה דרך בעל/ת המנוי המשפחתי"      # the owner's choice: the holder books for everyone
    return None


def family_of(db: Session, client) -> list:
    """The people this client may book for on BizFind: themselves first, then everyone on the family memberships
    they hold (still valid)."""
    from app.services import membership_family as family
    if client is None:
        return []
    today = svc.today_il()
    out = [client]
    from app.models.client import Client
    for m in db.scalars(select(Membership).where(Membership.client_id == client.id, Membership.studio_id == client.studio_id)).all():
        if not family.is_family(m.rules) or ms.status_now(m, None, today) in ("expired", "canceled"):
            continue
        for cid in family.people(db, m)[1:]:
            if all(x.id != cid for x in out):
                out.append(db.get(Client, cid))
    return out


def my_bookings(db: Session, client, session_ids) -> dict:
    """{session_id: booking} — this client's bookings that still count (not cancelled)."""
    ids = list(session_ids)
    if client is None or not ids:
        return {}
    rows = db.scalars(select(ClassBooking).where(ClassBooking.client_id == client.id, ClassBooking.session_id.in_(ids),
                                                 ClassBooking.status != "canceled")).all()
    return {b.session_id: b for b in rows}
