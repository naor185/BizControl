"""
A family / shared membership (classes extras 6) — one membership for several people. Every choice is the
owner's, on the membership type, copied into the membership when it is sold (rules), so a later change of the
type does not change memberships already sold:

- max_members: how many people (1 = a personal membership, the default; empty = no limit);
- entries_mode — how entries count: "shared" (the default — one balance for all: a card of 10, whoever comes
  takes from the same 10; a weekly limit for the family together), "each" (every person their own: 10 each /
  N a week each), or "shared_capped" (one balance, each person at most member_cap of it / a week);
- pricing — the price for the number of people: "fixed" (the default), "per_member" (price × people),
  "first_plus_extra" (price + extra_member_cents for each more), "first_plus_discount" (price, and each more at
  extra_member_percent off);
- booking_by: "each" (the default — every person books for themselves) or "holder" (only the holder, e.g. a
  parent for a child; the staff can always book);
- members_change after the sale: "free" (the default — no price change), "priced" (the price grows by the
  pricing), "locked" (no change).
The holder is memberships.client_id; the others are membership_members. A freeze, stop or cancel is of the whole
membership. On a punch card with "each", every person's entries are added to the card's log (opening, one per
person) and a person removed takes their unused entries with them.
"""
from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession
from app.models.memberships import Membership, MembershipEntry, MembershipMember

ENTRIES_MODES = ("shared", "each", "shared_capped")
PRICINGS = ("fixed", "per_member", "first_plus_extra", "first_plus_discount")
BOOKING_BY = ("each", "holder")
MEMBERS_CHANGE = ("free", "priced", "locked")
FIELDS = ("max_members", "entries_mode", "member_cap", "pricing", "extra_member_cents", "extra_member_percent",
          "booking_by", "members_change")
USED = ("reserved", "consumed")                     # a booking's entry that counts as used


def rules_of(t) -> dict:
    """The family choices of a membership type, for the membership's rules."""
    return {f: getattr(t, f) for f in FIELDS}


def is_family(rules: dict) -> bool:
    return rules.get("max_members", 1) != 1


def price_for(rules: dict, people: int) -> int:
    """The price of the membership for this many people, by the owner's pricing."""
    base, n = int(rules.get("price_cents") or 0), max(1, people)
    how = rules.get("pricing") or "fixed"
    if how == "per_member":
        return base * n
    if how == "first_plus_extra":
        return base + int(rules.get("extra_member_cents") or 0) * (n - 1)
    if how == "first_plus_discount":
        each_more = round(base * (100 - int(rules.get("extra_member_percent") or 0)) / 100)
        return base + each_more * (n - 1)
    return base


def others(db: Session, m: Membership) -> list[MembershipMember]:
    return list(db.scalars(select(MembershipMember).where(MembershipMember.membership_id == m.id,
                                                          MembershipMember.removed_at.is_(None))
                           .order_by(MembershipMember.added_at)).all())


def people(db: Session, m: Membership) -> list:
    """Everyone on the membership — the holder first."""
    return [m.client_id] + [x.client_id for x in others(db, m)]


def memberships_of(db: Session, client_id, studio_id) -> list[Membership]:
    """The memberships this client may use: their own, and those they are on as a family member."""
    on = select(MembershipMember.membership_id).where(MembershipMember.client_id == client_id, MembershipMember.removed_at.is_(None))
    return list(db.scalars(select(Membership).where(Membership.studio_id == studio_id,
                                                    or_(Membership.client_id == client_id, Membership.id.in_(on)))).all())


def per_person_limit(rules: dict) -> int | None:
    """How many entries (a card) / a week (weekly) each person may use — None: only the shared limit."""
    mode = rules.get("entries_mode") or "shared"
    if mode == "each":
        return rules.get("entries")
    if mode == "shared_capped":
        return rules.get("member_cap")
    return None


def person_used(db: Session, m: Membership, client_id, *, lo=None, hi=None) -> int:
    """The entries this person holds or used on this membership (between two moments, for a week)."""
    q = select(func.count()).select_from(ClassBooking).join(ClassSession, ClassSession.id == ClassBooking.session_id).where(
        ClassBooking.membership_id == m.id, ClassBooking.client_id == client_id, ClassBooking.status != "canceled",
        func.coalesce(ClassBooking.entry_state, "reserved").in_(USED))
    if lo is not None:
        q = q.where(ClassSession.starts_at >= lo, ClassSession.starts_at < hi)
    return db.scalar(q) or 0


def add(db: Session, m: Membership, client, *, user_id=None, at_sale: bool = False) -> MembershipMember:
    """Another person on the membership — at the sale, or later by the owner's members_change rule."""
    from app.services import memberships as ms
    r = m.rules
    if not is_family(r):
        raise ms.MembershipError("זה מנוי אישי — לאדם אחד")
    if client.studio_id != m.studio_id:
        raise ms.MembershipError("הלקוח לא נמצא")
    current = people(db, m)
    if client.id in current:
        raise ms.MembershipError(f"{client.full_name} כבר במנוי")
    if r.get("max_members") is not None and len(current) >= r["max_members"]:
        raise ms.MembershipError(f"המנוי הזה לעד {r['max_members']} אנשים")
    change = r.get("members_change") or "free"
    if not at_sale and change == "locked":
        raise ms.MembershipError("בסוג המנוי הזה אי אפשר להוסיף אנשים אחרי המכירה")
    # the moment of this row itself (not the transaction's) — people added together keep the order they were added in
    row = MembershipMember(studio_id=m.studio_id, membership_id=m.id, client_id=client.id, added_by=user_id,
                           added_at=func.clock_timestamp())
    db.add(row)
    if r.get("kind") == "punch" and (r.get("entries_mode") or "shared") == "each":
        db.add(MembershipEntry(studio_id=m.studio_id, membership_id=m.id, stage="opening", amount=r.get("entries") or 0,
                               reason=f"הכניסות של {client.full_name}"[:160], created_by=user_id))
    if not at_sale:
        extra = price_for(r, len(current) + 1) - price_for(r, len(current)) if change == "priced" else 0
        m.price_cents += extra
        ms.log_event(db, m, "member_added", m.status, m.status, fee_cents=extra,
                     reason=f"{client.full_name} נוסף/ה למנוי" + (f" — המחיר עלה ב-₪{extra / 100:,.0f}" if extra else ""), user_id=user_id)
    db.flush()
    return row


def remove(db: Session, m: Membership, client_id, *, user_id=None) -> dict:
    """A person off the membership (not the holder): their coming classes on it are cancelled (entries back);
    on a card with an allowance each, their unused entries leave with them. The price does not change."""
    from app.models.client import Client
    from app.services import classes as svc
    from app.services import memberships as ms
    if client_id == m.client_id:
        raise ms.MembershipError("בעל/ת המנוי לא יוצא/ת מהמנוי — מבטלים את המנוי")
    row = db.scalar(select(MembershipMember).where(MembershipMember.membership_id == m.id, MembershipMember.client_id == client_id,
                                                   MembershipMember.removed_at.is_(None)))
    if row is None:
        raise ms.MembershipError("לא נמצא/ה במנוי")
    if (m.rules.get("members_change") or "free") == "locked":
        raise ms.MembershipError("בסוג המנוי הזה אי אפשר לשנות את האנשים אחרי המכירה")
    now = svc.now_utc()
    coming = db.scalars(select(ClassBooking).join(ClassSession, ClassSession.id == ClassBooking.session_id).where(
        ClassBooking.membership_id == m.id, ClassBooking.client_id == client_id, ClassBooking.status == "booked",
        ClassSession.starts_at > now)).all()
    for b in coming:
        b.status, b.canceled_at, b.canceled_by, b.cancel_reason = "canceled", now, user_id, "left_membership"
        ms.settle(db, b, "return", reason="יצא/ה מהמנוי המשפחתי", user_id=user_id)
    db.flush()
    r = m.rules
    if r.get("kind") == "punch" and (r.get("entries_mode") or "shared") == "each":
        unused = max(0, (r.get("entries") or 0) - person_used(db, m, client_id))
        if unused:
            db.add(MembershipEntry(studio_id=m.studio_id, membership_id=m.id, stage="adjust", amount=-unused,
                                   reason="הכניסות של מי שיצא/ה מהמנוי", created_by=user_id))
    row.removed_at = now
    name = (db.get(Client, client_id).full_name or "") if client_id else ""
    ms.log_event(db, m, "member_removed", m.status, m.status, reason=f"{name} יצא/ה מהמנוי", user_id=user_id)
    db.flush()
    return {"canceled_bookings": len(coming)}
