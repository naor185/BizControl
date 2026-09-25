"""
The waitlist of a full group class (stage 6) — the existing wait_list, with the class (session_id), the
place in line (position) and, for an offered spot, until when it is held (offer_expires_at).

- Joining: only when the class is full, up to the owner's waitlist_max per class (0 = no waitlist),
  not in the last 30 minutes. A client waits once per class.
- When a spot frees up — a booking cancelled (on time or late), the staff's cancel, more spots — the
  first in line moves up. With the owner's "auto" mode and a membership that covers the class, they are
  booked at once and told (waitlist_promoted) — and may still cancel free of charge. Otherwise (the
  "approval" mode, or no covering membership) they are offered the spot, held for them for the owner's
  confirm window (waitlist_confirm_minutes); not confirmed in time → it passes to the next
  (waitlist_expiring). A waiter whose membership is frozen on the class's day is skipped and stays in line.
- Nothing moves in the last 30 minutes before the class, and when the class starts the waitlist is
  cleared. A cancelled class clears it too.
- Behind the "class_waitlist" module. Every message goes through notifications.notify().
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import ClassSession
from app.models.wait_list import WaitListEntry
from app.services import classes as svc
from app.services import memberships as ms
from app.services import notifications, policies

ACTIVE = ("waiting", "notified")
CUTOFF = timedelta(minutes=30)          # no moving up, joining or waitlist messages this close to the class


class WaitlistError(ValueError):
    pass


def enabled(db: Session, studio_id) -> bool:
    return ms._module(db, studio_id, "classes") and ms._module(db, studio_id, "class_waitlist")


def queue(db: Session, session_id) -> list[WaitListEntry]:
    return list(db.scalars(select(WaitListEntry).where(WaitListEntry.session_id == session_id,
                                                       WaitListEntry.status.in_(ACTIVE))
                           .order_by(WaitListEntry.position, WaitListEntry.created_at)).all())


def held_for_others(db: Session, session_id, client_id=None) -> int:
    """Spots offered from the waitlist and still held — for anyone but this client."""
    q = select(func.count()).select_from(WaitListEntry).where(
        WaitListEntry.session_id == session_id, WaitListEntry.status == "notified",
        WaitListEntry.offer_expires_at > svc.now_utc())
    if client_id is not None:
        q = q.where(WaitListEntry.client_id != client_id)
    return db.scalar(q) or 0


def spots_left(db: Session, s: ClassSession, client_id=None) -> int:
    from app.services.class_bookings import holding
    return max(0, s.capacity - holding(db, s.id) - held_for_others(db, s.id, client_id))


def _context(db: Session, s: ClassSession) -> dict:
    return svc._context(db, s)


def join(db: Session, s: ClassSession, client, *, origin: str = "user") -> WaitListEntry:
    if not enabled(db, s.studio_id):
        raise WaitlistError("אין רשימת המתנה לשיעורים בעסק")
    if s.status != "scheduled" or s.starts_at - svc.now_utc() < CUTOFF:
        raise WaitlistError("ההמתנה לשיעור הזה נסגרה")
    from app.models.classes import ClassBooking
    if db.scalar(select(ClassBooking.id).where(ClassBooking.session_id == s.id, ClassBooking.client_id == client.id,
                                               ClassBooking.status.in_(("booked", "attended", "no_show")))):
        raise WaitlistError("כבר ברשימה של השיעור")
    line = queue(db, s.id)
    if any(e.client_id == client.id for e in line):
        raise WaitlistError("כבר ברשימת ההמתנה")
    if spots_left(db, s, client.id) > 0:
        raise WaitlistError("יש מקום פנוי — אפשר להירשם")
    most = policies.get_policy(db, s.studio_id, "waitlist_max", template_id=s.template_id)
    if not most:
        raise WaitlistError("אין רשימת המתנה לשיעור הזה")
    if len(line) >= most:
        raise WaitlistError("רשימת ההמתנה מלאה")
    e = WaitListEntry(studio_id=s.studio_id, client_id=client.id, client_name=client.full_name, client_phone=client.phone,
                      session_id=s.id, position=(max((x.position or 0) for x in line) + 1) if line else 1, status="waiting")
    db.add(e)
    db.flush()
    return e


def leave(db: Session, e: WaitListEntry) -> None:
    if e.status not in ACTIVE:
        raise WaitlistError("כבר לא ברשימת ההמתנה")
    was_offered = e.status == "notified"
    e.status = "canceled"
    db.flush()
    if was_offered:                     # the held spot is free again
        promote(db, db.get(ClassSession, e.session_id))


def move(db: Session, e: WaitListEntry, to_position: int) -> None:
    """The staff move someone in line (1 = first)."""
    line = [x for x in queue(db, e.session_id) if x.id != e.id]
    to = max(1, min(to_position, len(line) + 1))
    line.insert(to - 1, e)
    for i, x in enumerate(line, start=1):
        x.position = i
    db.flush()


def promote(db: Session, s: ClassSession | None, *, origin: str = "system") -> int:
    """Moves the line up into free spots. Returns how many moved up (booked or offered)."""
    if s is None or s.status != "scheduled" or not enabled(db, s.studio_id) or s.starts_at - svc.now_utc() < CUTOFF:
        return 0
    from app.models.client import Client
    from app.services import class_bookings as bookings
    mode = policies.get_policy(db, s.studio_id, "waitlist_mode", template_id=s.template_id)
    window = timedelta(minutes=policies.get_policy(db, s.studio_id, "waitlist_confirm_minutes", template_id=s.template_id))
    uses = ms.uses_memberships(db, s.studio_id)
    moved, skipped = 0, set()
    while spots_left(db, s) > 0:
        e = next((x for x in queue(db, s.id) if x.status == "waiting" and x.id not in skipped), None)
        if e is None:
            break
        client = db.get(Client, e.client_id)
        m, why = ms.find_eligible(db, client.id, s) if uses else (None, None)
        if uses and m is None and why == "המנוי מוקפא ביום השיעור":
            skipped.add(e.id)                               # stays in line, not moved up
            continue
        now = svc.now_utc()
        ctx = _context(db, s)
        if mode == "auto" and (not uses or m is not None):
            b = bookings.book(db, s, client, origin=origin, notify_booked=False)
            b.from_waitlist = True
            e.status, e.confirmed_at, e.booking_id = "confirmed", now, b.id
            note = "נרשמת אוטומטית — נתראה! אם לא מתאים, אפשר לבטל בלי חיוב."
        else:
            e.status, e.notified_at = "notified", now
            e.offer_expires_at = min(now + window, s.starts_at - CUTOFF)
            d, t = svc.il_date_time(e.offer_expires_at)
            note = f"המקום שמור לך עד {t} — לאישור: ב-BizFind או בהודעה לעסק."
        db.flush()
        notifications.notify(db, s.studio_id, "waitlist_promoted", origin=origin, about=f"waitlist:{e.id}:{e.status}",
                             context={**ctx, "promotion_note": note}, clients=[client])
        moved += 1
    return moved


def confirm(db: Session, e: WaitListEntry, *, drop_in: bool = False, user_id=None, origin: str = "user"):
    """An offered spot taken — by the client on BizFind or by the staff for them."""
    if e.status != "notified" or not e.offer_expires_at or e.offer_expires_at <= svc.now_utc():
        raise WaitlistError("ההצעה כבר לא בתוקף")
    from app.models.client import Client
    from app.services import class_bookings as bookings
    s = db.get(ClassSession, e.session_id)
    b = bookings.book(db, s, db.get(Client, e.client_id), user_id=user_id, origin=origin, drop_in=drop_in)
    b.from_waitlist = True
    e.status, e.confirmed_at, e.booking_id = "confirmed", svc.now_utc(), b.id
    db.flush()
    return b


def clear(db: Session, session_id, status: str = "expired") -> int:
    rows = db.scalars(select(WaitListEntry).where(WaitListEntry.session_id == session_id,
                                                  WaitListEntry.status.in_(ACTIVE))).all()
    for e in rows:
        e.status = status
    db.flush()
    return len(rows)


def sweep(db: Session) -> int:
    """Every few minutes: offers not confirmed in time pass to the next; started classes clear their
    line. Returns how many offers expired."""
    from app.models.client import Client
    now = svc.now_utc()
    expired = 0
    for e in db.scalars(select(WaitListEntry).where(WaitListEntry.session_id.isnot(None), WaitListEntry.status == "notified",
                                                    WaitListEntry.offer_expires_at <= now)).all():
        s = db.get(ClassSession, e.session_id)
        e.status = "expired"
        expired += 1
        if s and s.starts_at > now:
            notifications.notify(db, e.studio_id, "waitlist_expiring", origin="system", about=f"waitlist:{e.id}:expired",
                                  context={**_context(db, s),
                                           "expiry_note": f"הזמן לאישור המקום ב{_context(db, s)['class_name']} עבר, והמקום עבר לבא בתור."},
                                  clients=[db.get(Client, e.client_id)])
            promote(db, s)
        db.commit()
    started = db.scalars(select(ClassSession.id).join(WaitListEntry, WaitListEntry.session_id == ClassSession.id).where(
        WaitListEntry.status.in_(ACTIVE), ClassSession.starts_at <= now).distinct()).all()
    for sid in started:
        clear(db, sid)
    db.commit()
    return expired
