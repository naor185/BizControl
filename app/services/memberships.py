"""
Memberships — selling one, the punch card's balance, whether a client may book a class, and what
happens to the entry a booking holds (app/models/memberships.py has the tables).

- Selling copies the type's rules into the membership (later edits of the type do not reach it).
  A punch card opens its entry log with its entries.
- The balance comes from the log only: available = opening + corrections − reserved + returned;
  consumed = closed as consumed. A booking reserves one entry; its close consumes or returns that
  same entry — never another one. A later change of mind (a no-show made justified, attendance
  changed) is a correction (±1), written only when the booking's entry state really changes.
- Eligibility, when the business uses memberships: a membership valid on the class's day (not frozen,
  not cancelled), covering the class, with an entry left (punch card) or under its weekly limit.
  Unlimited is tried first, then weekly, then punch cards, so entries are not spent needlessly.
- Unlimited memberships reserve nothing. Weekly-limit memberships track the booking's entry state
  (for counting the week) without a log.
"""
from __future__ import annotations

from datetime import date, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession
from app.models.memberships import Membership, MembershipEntry, MembershipType
from app.services import classes as svc

KIND_LABELS = {"unlimited": "ללא הגבלה", "weekly": "מגבלה שבועית", "punch": "כרטיסייה"}
VALID = ("pending", "active", "ending")           # statuses that can cover a class (by dates)
ORDER = {"unlimited": 0, "weekly": 1, "punch": 2}


class MembershipError(ValueError):
    pass


def uses_memberships(db: Session, studio_id) -> bool:
    return svc.classes_on(db, studio_id, {}) and _module(db, studio_id, "memberships")


def _module(db: Session, studio_id, module_id: str) -> bool:
    from app.core.features import is_module_enabled
    from app.models.studio import Studio
    st = db.get(Studio, studio_id)
    return bool(st) and is_module_enabled(db, st.id, st.subscription_plan or "free", module_id)


# ── selling ──────────────────────────────────────────────────────────────────

def snapshot(t: MembershipType) -> dict:
    return {"name": t.name, "kind": t.kind, "entries": t.entries, "duration_days": t.duration_days,
            "covers_all": t.covers_all, "covered_templates": [str(x) for x in (t.covered_templates or [])],
            "price_cents": t.price_cents}


def sell(db: Session, client, mtype: MembershipType, *, starts_on: date | None = None, price_cents: int | None = None,
         notes: str | None = None, user_id=None, origin: str = "user", opening_entries: int | None = None) -> Membership:
    """A membership for a client from a type — starting today or later (then pending)."""
    if mtype.studio_id != client.studio_id:
        raise MembershipError("סוג המנוי לא נמצא")
    today = svc.today_il()
    start = starts_on or today
    rules = snapshot(mtype)
    m = Membership(studio_id=client.studio_id, client_id=client.id, type_id=mtype.id,
                   status="pending" if start > today else "active", starts_on=start,
                   ends_on=start + timedelta(days=mtype.duration_days - 1) if mtype.duration_days else None,
                   rules=rules, price_cents=mtype.price_cents if price_cents is None else price_cents,
                   notes=(notes or None), source=origin, created_by=user_id)
    m.renewal_expected_on = (m.ends_on + timedelta(days=1)) if m.ends_on else None
    db.add(m)
    db.flush()
    if mtype.kind == "punch":
        db.add(MembershipEntry(studio_id=m.studio_id, membership_id=m.id, stage="opening",
                               amount=mtype.entries if opening_entries is None else opening_entries,
                               reason="פתיחת הכרטיסייה", source=origin, created_by=user_id))
        db.flush()
    return m


def renew(db: Session, m: Membership, *, starts_on: date | None = None, user_id=None) -> Membership:
    """A new membership of the same type, starting the day after this one ends (or today)."""
    t = db.get(MembershipType, m.type_id) if m.type_id else None
    if not t or not t.is_active:
        raise MembershipError("סוג המנוי הזה כבר לא נמכר")
    from app.models.client import Client
    today = svc.today_il()
    start = starts_on or max(today, (m.ends_on + timedelta(days=1)) if m.ends_on else today)
    return sell(db, db.get(Client, m.client_id), t, starts_on=start, user_id=user_id)


def adjust(db: Session, m: Membership, delta: int, reason: str, *, user_id=None) -> None:
    """A manual correction of a punch card's entries (with a reason)."""
    if m.rules.get("kind") != "punch":
        raise MembershipError("תיקון כניסות — רק בכרטיסייה")
    if not delta or not reason.strip():
        raise MembershipError("חסרים מספר וסיבה")
    if balance(db, [m.id])[m.id]["available"] + delta < 0:
        raise MembershipError("אחרי התיקון היתרה תהיה שלילית")
    db.add(MembershipEntry(studio_id=m.studio_id, membership_id=m.id, stage="adjust", amount=delta,
                           reason=reason.strip()[:160], created_by=user_id))
    db.flush()


# ── balance and status ───────────────────────────────────────────────────────

def balance(db: Session, membership_ids) -> dict:
    """{membership_id: {total, reserved, consumed, available}} — from the entry log. total = what was
    bought plus manual corrections; a correction made for a booking (attendance changed) counts as
    used, not as a change of the total."""
    ids = list(membership_ids)
    out = {i: {"total": 0, "reserved": 0, "consumed": 0, "available": 0} for i in ids}
    if not ids:
        return out
    for_booking = MembershipEntry.booking_id.isnot(None)
    rows = db.execute(select(MembershipEntry.membership_id, MembershipEntry.stage, MembershipEntry.outcome, for_booking,
                             func.coalesce(func.sum(MembershipEntry.amount), 0))
                      .where(MembershipEntry.membership_id.in_(ids))
                      .group_by(MembershipEntry.membership_id, MembershipEntry.stage, MembershipEntry.outcome, for_booking)).all()
    raw: dict = {}
    for mid, stage, outcome, booked, total in rows:
        key = ("adjust_booking" if booked else "adjust") if stage == "adjust" else (stage, outcome)
        raw.setdefault(mid, {})[key] = raw.get(mid, {}).get(key, 0) + int(total)
    for mid, r in raw.items():
        total = r.get(("opening", None), 0) + r.get("adjust", 0)
        reserves = r.get(("reserve", None), 0)
        consumed, returned = r.get(("close", "consume"), 0), r.get(("close", "return"), 0)
        available = total + r.get("adjust_booking", 0) - reserves + returned
        reserved = reserves - consumed - returned
        out[mid] = {"total": total, "reserved": reserved, "consumed": total - available - reserved, "available": available}
    return out


def status_now(m: Membership, bal: dict | None, today: date) -> str:
    """The status as of today — dates and entries decide, before the nightly job writes it down."""
    if m.status in ("canceled", "frozen", "expired"):
        return m.status
    if m.ends_on and m.ends_on < today:
        return "expired"
    if m.rules.get("kind") == "punch" and bal and bal["available"] <= 0 and bal["reserved"] <= 0:
        return "expired"
    if m.starts_on > today:
        return "pending"
    return "active" if m.status == "pending" else m.status


def refresh_statuses(db: Session) -> int:
    """The nightly job: write down pending → active and → expired. Returns how many changed."""
    today = svc.today_il()
    rows = db.scalars(select(Membership).where(Membership.status.in_(VALID))).all()
    bals = balance(db, [m.id for m in rows if m.rules.get("kind") == "punch"])
    changed = 0
    for m in rows:
        new = status_now(m, bals.get(m.id), today)
        if new != m.status:
            m.status = new
            changed += 1
    db.commit()
    return changed


# ── may this client book this class ──────────────────────────────────────────

def covers(m: Membership, template_id) -> bool:
    r = m.rules
    return bool(r.get("covers_all", True)) or (template_id is not None and str(template_id) in (r.get("covered_templates") or []))


def week_used(db: Session, m: Membership, day: date) -> int:
    """Bookings this membership holds in the Israeli week (Sun–Sat) of `day`."""
    start = day - timedelta(days=svc.js_weekday(day))
    lo, hi = svc.at_il(start, time(0, 0)), svc.at_il(start + timedelta(days=7), time(0, 0))
    return db.scalar(select(func.count()).select_from(ClassBooking).join(ClassSession, ClassSession.id == ClassBooking.session_id).where(
        ClassBooking.membership_id == m.id, ClassBooking.status != "canceled",
        func.coalesce(ClassBooking.entry_state, "reserved") != "returned",
        ClassSession.starts_at >= lo, ClassSession.starts_at < hi)) or 0


def find_eligible(db: Session, client_id, session: ClassSession) -> tuple[Membership | None, str | None]:
    """The membership that covers this class for this client, or (None, why not)."""
    day = session.starts_at.astimezone(svc.IL).date()
    mine = db.scalars(select(Membership).where(Membership.client_id == client_id, Membership.studio_id == session.studio_id)).all()
    if not mine:
        return None, "אין מנוי"
    frozen = [m for m in mine if m.status == "frozen" and m.starts_on <= day and (not m.ends_on or m.ends_on >= day)]
    valid = [m for m in mine if m.status in VALID and m.starts_on <= day and (not m.ends_on or m.ends_on >= day)]
    if not valid:
        return None, "המנוי מוקפא ביום השיעור" if frozen else "אין מנוי בתוקף ביום השיעור"
    valid.sort(key=lambda m: (ORDER.get(m.rules.get("kind"), 9), m.ends_on or date.max))
    bals = balance(db, [m.id for m in valid if m.rules.get("kind") == "punch"])
    why = None
    for m in valid:
        kind = m.rules.get("kind")
        if not covers(m, session.template_id):
            why = why or "המנוי לא כולל את השיעור הזה"
            continue
        if kind == "punch" and bals[m.id]["available"] <= 0:
            why = "נגמרו הכניסות בכרטיסייה"
            continue
        if kind == "weekly" and week_used(db, m, day) >= (m.rules.get("entries") or 0):
            why = f"כבר נוצלו {m.rules.get('entries')} כניסות בשבוע של השיעור"
            continue
        return m, None
    return None, why


# ── the entry a booking holds ────────────────────────────────────────────────

def reserve(db: Session, booking: ClassBooking, m: Membership, *, user_id=None, origin: str = "user") -> None:
    booking.membership_id = m.id
    kind = m.rules.get("kind")
    if kind == "unlimited":
        booking.entry_state = None
        return
    booking.entry_state = "reserved"
    if kind == "punch":
        db.add(MembershipEntry(studio_id=m.studio_id, membership_id=m.id, booking_id=booking.id, stage="reserve",
                               amount=1, reason="הרשמה לשיעור", source=origin, created_by=user_id))
    db.flush()


def settle(db: Session, booking: ClassBooking, outcome: str, *, reason: str, user_id=None) -> None:
    """The booking's entry is consumed or returned. The first decision closes it; a later change of
    mind is a correction (±1). Nothing is written when the state does not change — so a repeated
    action never moves the balance."""
    if not booking.membership_id or booking.entry_state is None:
        return
    want = "consumed" if outcome == "consume" else "returned"
    if booking.entry_state == want:
        return
    m = db.get(Membership, booking.membership_id)
    punch = m.rules.get("kind") == "punch"
    if booking.entry_state == "reserved":
        if punch:
            db.add(MembershipEntry(studio_id=m.studio_id, membership_id=m.id, booking_id=booking.id, stage="close",
                                   outcome=outcome, amount=1, reason=reason[:160], created_by=user_id))
    elif punch:
        db.add(MembershipEntry(studio_id=m.studio_id, membership_id=m.id, booking_id=booking.id, stage="adjust",
                               amount=1 if want == "returned" else -1, reason=reason[:160], created_by=user_id))
    booking.entry_state = want
    db.flush()


def entry_note(db: Session, booking: ClassBooking) -> str:
    """For the client's message: what happened to their punch-card entry."""
    if not booking.membership_id or booking.entry_state not in ("consumed", "returned"):
        return ""
    m = db.get(Membership, booking.membership_id)
    if m.rules.get("kind") != "punch":
        return ""
    return "הכניסה חזרה לכרטיסייה." if booking.entry_state == "returned" else "הכניסה נוצלה מהכרטיסייה."


def label(m: Membership | None, bal: dict | None) -> str | None:
    """"כרטיסייה 10 · נותרו 7" — for the class list."""
    if not m:
        return None
    name = m.rules.get("name") or KIND_LABELS.get(m.rules.get("kind"), "מנוי")
    if m.rules.get("kind") == "punch" and bal:
        return f"{name} · נותרו {bal['available']}"
    return name
