"""
Changing a membership (stage 5): freeze, back from a freeze, stop at the end of the period, undo the
stop, cancel now — only the moves the plan's state diagram allows — and the client's notices.

- Freeze: from a date to a return date (required). The membership's end moves out by the frozen days.
  Bookings inside the freeze are cancelled, their entries go back, and the client gets one message.
  It comes back by itself on the return date (the nightly job), with a message the day before; an
  early return shortens the extension. The membership type's freeze rules, copied into the membership
  when it was sold, decide: allowed at all, shortest freeze, most days, most freezes, a fee (recorded
  on the change, never collected).
- Stop: runs until its end date, then ends and is not renewed; its bookings stay. Undo = active again.
- Cancel: ends today; future bookings are cancelled and their entries go back. (A membership that has
  not started yet can be cancelled too — a sale made by mistake.)
- Every change goes into the change log (membership_events) with who, when and why. A change made by
  someone other than the owner rings the owner's bell (membership_changed_by_staff).
- Notices, once each (a daily job): the membership ends in 7 and in 3 days, 2 entries are left on a
  punch card — not when a renewal is already sold — and "back from the freeze tomorrow".
"""
from __future__ import annotations

from datetime import time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession
from app.models.memberships import Membership, MembershipEvent
from app.services import classes as svc
from app.services import memberships as ms
from app.services import notifications

# the plan's diagram: which status each change may start from
ALLOWED = {"freeze": {"active"}, "unfreeze": {"frozen", "active"}, "stop": {"active"}, "unstop": {"ending"},
           "cancel": {"active", "frozen", "ending", "pending"}}
REFUSED = {"freeze": "אפשר להקפיא רק מנוי פעיל", "unfreeze": "המנוי לא בהקפאה", "stop": "אפשר לעצור רק מנוי פעיל",
           "unstop": "המנוי לא נעצר", "cancel": "המנוי כבר הסתיים או בוטל"}


def _d(day) -> str:
    return f"{day.day}/{day.month}"


def _status(db: Session, m: Membership) -> str:
    bal = ms.balance(db, [m.id]).get(m.id) if m.rules.get("kind") == "punch" else None
    return ms.status_now(m, bal, svc.today_il())


def _check(db: Session, m: Membership, change: str) -> str:
    status = _status(db, m)
    if status not in ALLOWED[change]:
        raise ms.MembershipError(REFUSED[change])
    return status


def _client(db: Session, m: Membership):
    from app.models.client import Client
    return db.get(Client, m.client_id)


def _tell_owner(db: Session, m: Membership, status_word: str, user_id, role: str | None) -> None:
    """A change made by someone other than the owner rings the owner's bell."""
    if role in (None, "owner", "superadmin"):
        return
    from app.models.user import User
    u = db.get(User, user_id) if user_id else None
    notifications.notify(db, m.studio_id, "membership_changed_by_staff", origin="user",
                         about=f"membership:{m.id}:{status_word}:{svc.now_utc().isoformat()}",
                         context={"client_name": _client(db, m).full_name, "status_word": status_word,
                                  "staff_name": (u.display_name or u.email) if u else ""})


def _cancel_bookings(db: Session, m: Membership, *, from_day=None, until_day=None, reason: str, user_id=None) -> int:
    """Cancels this membership's coming bookings (optionally only between two dates); entries go back."""
    now = svc.now_utc()
    q = (select(ClassBooking).join(ClassSession, ClassSession.id == ClassBooking.session_id)
         .where(ClassBooking.membership_id == m.id, ClassBooking.status == "booked", ClassSession.starts_at > now))
    if from_day is not None:
        q = q.where(ClassSession.starts_at >= svc.at_il(from_day, time(0, 0)))
    if until_day is not None:
        q = q.where(ClassSession.starts_at < svc.at_il(until_day, time(0, 0)))
    rows = db.scalars(q).all()
    for b in rows:
        b.status, b.canceled_at, b.canceled_by, b.cancel_reason = "canceled", now, user_id, reason
        ms.settle(db, b, "return", reason="המנוי הוקפא" if reason == "membership_frozen" else "המנוי בוטל", user_id=user_id)
    db.flush()
    return len(rows)


def _canceled_text(n: int, punch: bool) -> str:
    if not n:
        return ""
    what = "הרשמה אחת בתקופה הזו בוטלה" if n == 1 else f"{n} הרשמות בתקופה הזו בוטלו"
    return f" {what}{' והכניסות חזרו לכרטיסייה' if punch else ''}."


# ── the changes ──────────────────────────────────────────────────────────────

def freeze_usage(db: Session, m: Membership) -> tuple[int, int]:
    """(days used, freezes made) in this membership — an early return gives days back (its negative
    days); the nightly job's return on the planned date has none."""
    days = db.scalar(select(func.coalesce(func.sum(MembershipEvent.days), 0)).where(
        MembershipEvent.membership_id == m.id, MembershipEvent.action.in_(("freeze", "unfreeze")))) or 0
    count = db.scalar(select(func.count()).select_from(MembershipEvent).where(
        MembershipEvent.membership_id == m.id, MembershipEvent.action == "freeze")) or 0
    return int(days), int(count)


def freeze_problem(db: Session, m: Membership, from_on, until_on) -> str | None:
    """Why this freeze cannot be made — the membership's status and its type's freeze rules; None when it
    can. The one check, for the staff's freeze and a client's request alike."""
    if _status(db, m) not in ALLOWED["freeze"]:
        return REFUSED["freeze"]
    today = svc.today_il()
    if m.freeze_until and m.freeze_until > today:
        return "למנוי כבר יש הקפאה — קודם מחזירים אותו ממנה"
    r = m.rules
    if r.get("freeze_allowed") is False:
        return "סוג המנוי הזה לא מאפשר הקפאה"
    if from_on < today:
        return "תחילת ההקפאה כבר עברה"
    if until_on <= from_on:
        return "תאריך החזרה חייב להיות אחרי תחילת ההקפאה"
    if m.ends_on and from_on > m.ends_on:
        return "ההקפאה מתחילה אחרי סוף המנוי"
    days = (until_on - from_on).days
    used, count = freeze_usage(db, m)
    if r.get("freeze_min_days") and days < r["freeze_min_days"]:
        return f"הקפאה קצרה מדי — לפחות {r['freeze_min_days']} ימים"
    if r.get("freeze_max_count") and count >= r["freeze_max_count"]:
        return f"כבר נוצלו {count} הקפאות — המקסימום בסוג המנוי הזה"
    if r.get("freeze_max_days") and used + days > r["freeze_max_days"]:
        return f"נשארו {max(0, r['freeze_max_days'] - used)} ימי הקפאה במנוי הזה"
    return None


def freeze(db: Session, m: Membership, from_on, until_on, *, reason: str | None = None, fee_cents: int | None = None,
           user_id=None, role: str | None = None) -> dict:
    status = _check(db, m, "freeze")
    problem = freeze_problem(db, m, from_on, until_on)
    if problem:
        raise ms.MembershipError(problem)
    today = svc.today_il()
    r = m.rules
    days = (until_on - from_on).days
    m.freeze_from, m.freeze_until = from_on, until_on
    if m.ends_on:
        m.ends_on = m.ends_on + timedelta(days=days)
        m.renewal_expected_on = m.ends_on + timedelta(days=1)
    new_status = "frozen" if from_on <= today else status
    m.status = new_status
    canceled = _cancel_bookings(db, m, from_day=from_on, until_day=until_on, reason="membership_frozen", user_id=user_id)
    fee = (r.get("freeze_fee_cents") or 0) if fee_cents is None else fee_cents
    ms.log_event(db, m, "freeze", status, new_status, effective_on=from_on, days=days, fee_cents=fee, reason=reason, user_id=user_id)
    note = f"המנוי שלך מוקפא מ-{_d(from_on)} ויחזור לפעילות ב-{_d(until_on)}." + _canceled_text(canceled, r.get("kind") == "punch")
    notifications.notify(db, m.studio_id, "membership_frozen", origin="user", about=f"membership:{m.id}:freeze:{from_on}",
                         context={"freeze_note": note}, clients=[_client(db, m)])
    _tell_owner(db, m, "הוקפא", user_id, role)
    db.flush()
    return {"canceled_bookings": canceled, "days": days}


def unfreeze(db: Session, m: Membership, *, user_id=None, role: str | None = None) -> dict:
    """Back from the freeze today (the extension shortens), or a coming freeze called off."""
    status = _check(db, m, "unfreeze")
    today = svc.today_il()
    if not (m.freeze_from and m.freeze_until and m.freeze_until > today):
        raise ms.MembershipError(REFUSED["unfreeze"])
    coming = m.freeze_from > today
    given_back = (m.freeze_until - (m.freeze_from if coming else today)).days
    if m.ends_on:
        m.ends_on = m.ends_on - timedelta(days=given_back)
        m.renewal_expected_on = m.ends_on + timedelta(days=1)
    if coming:
        m.freeze_from = m.freeze_until = None
    else:
        m.freeze_until = today
    m.status = "active"
    ms.log_event(db, m, "unfreeze", status, "active", effective_on=today, days=-given_back,
                 reason="ההקפאה המתוכננת בוטלה" if coming else "חזרה מוקדמת", user_id=user_id)
    if not coming:
        notifications.notify(db, m.studio_id, "membership_frozen", origin="user", about=f"membership:{m.id}:back:{today}",
                             context={"freeze_note": "המנוי שלך חזר לפעילות היום."}, clients=[_client(db, m)])
    db.flush()
    return {"days_given_back": given_back}


def stop(db: Session, m: Membership, *, reason: str | None = None, user_id=None, role: str | None = None) -> None:
    """Runs until its end date, then ends and is not renewed. Its bookings stay."""
    status = _check(db, m, "stop")
    m.status = "ending"
    when = m.ends_on or svc.today_il()
    ms.log_event(db, m, "stop", status, "ending", effective_on=when, reason=reason, user_id=user_id)
    notifications.notify(db, m.studio_id, "membership_ended", origin="user", about=f"membership:{m.id}:stop:{svc.now_utc().isoformat()}",
                         context={"status_word": "נעצר", "date": _d(when)}, clients=[_client(db, m)])
    _tell_owner(db, m, "נעצר", user_id, role)
    db.flush()


def unstop(db: Session, m: Membership, *, user_id=None, role: str | None = None) -> None:
    status = _check(db, m, "unstop")
    m.status = "active"
    ms.log_event(db, m, "unstop", status, "active", effective_on=svc.today_il(), reason="העצירה בוטלה", user_id=user_id)
    db.flush()


def cancel(db: Session, m: Membership, *, reason: str | None = None, user_id=None, role: str | None = None) -> dict:
    """Ends today. Coming bookings are cancelled and their entries go back."""
    status = _check(db, m, "cancel")
    today = svc.today_il()
    canceled = _cancel_bookings(db, m, reason="membership_canceled", user_id=user_id)
    was_end = m.ends_on
    m.status = "canceled"
    if status != "pending":
        m.ends_on = today
    if m.freeze_until and m.freeze_until > today:          # a freeze now or coming ends with the membership
        if m.freeze_from > today:
            m.freeze_from = m.freeze_until = None
        else:
            m.freeze_until = today
    m.renewal_expected_on = None
    ms.log_event(db, m, "cancel", status, "canceled", effective_on=today, reason=reason
                 or (f"סיום מקורי: {was_end.isoformat()}" if was_end else None), user_id=user_id)
    notifications.notify(db, m.studio_id, "membership_ended", origin="user", about=f"membership:{m.id}:cancel",
                         context={"status_word": "בוטל", "date": _d(today)}, clients=[_client(db, m)])
    _tell_owner(db, m, "בוטל", user_id, role)
    db.flush()
    return {"canceled_bookings": canceled}


# ── notices (a daily job) ────────────────────────────────────────────────────

def _renewed(db: Session, m: Membership) -> bool:
    """Another membership of this client is already sold to follow (then no "renew" nudge)."""
    return db.scalar(select(Membership.id).where(Membership.client_id == m.client_id, Membership.id != m.id,
                                                 Membership.status.in_(("pending", "active")),
                                                 Membership.created_at > m.created_at).limit(1)) is not None


def sweep_notices(db: Session) -> int:
    """Ends in 7 / in 3 days; 2 entries left; back from the freeze tomorrow. Each once. Returns messages queued."""
    today = svc.today_il()
    on: dict = {}
    sent = 0
    rows = db.scalars(select(Membership).where(Membership.status.in_(("active", "ending", "frozen")))).all()
    bals = ms.balance(db, [m.id for m in rows if m.rules.get("kind") == "punch"])
    for m in rows:
        if not svc.classes_on(db, m.studio_id, on):
            continue
        client = _client(db, m)
        if m.freeze_until == today + timedelta(days=1) and m.freeze_from and m.freeze_from <= today:
            sent += notifications.notify(db, m.studio_id, "membership_frozen", origin="system",
                                         about=f"membership:{m.id}:return:{m.freeze_until}",
                                         context={"freeze_note": f"המנוי שלך חוזר לפעילות מחר, {_d(m.freeze_until)}."}, clients=[client])
        if m.status == "frozen" or _renewed(db, m):
            continue
        if m.ends_on and 0 <= (m.ends_on - today).days <= 7:
            left = (m.ends_on - today).days
            mark = 3 if left <= 3 else 7
            when = "היום" if left == 0 else "מחר" if left == 1 else f"בעוד {left} ימים"
            sent += notifications.notify(db, m.studio_id, "membership_expiring", origin="system",
                                         about=f"membership:{m.id}:expiring:{mark}",
                                         context={"expiry_note": f"המנוי שלך מסתיים {when} ({_d(m.ends_on)})."}, clients=[client])
        bal = bals.get(m.id)
        if bal and bal["available"] == 2:
            sent += notifications.notify(db, m.studio_id, "membership_expiring", origin="system",
                                         about=f"membership:{m.id}:entries:2",
                                         context={"expiry_note": "נותרו לך 2 כניסות בכרטיסייה."}, clients=[client])
    db.commit()
    return sent
