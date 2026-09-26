"""
Renting a room out (classes extras 7) — to an outside instructor or therapist, recorded as a client of the
business. Every rule is the owner's, on the room:

- the price: by the hour (rental_hour_cents, by the minute of the rental) or a fixed price a booking
  (rental_booking_cents); the shortest rental (rental_min_minutes); a discount for a regular renter
  (rental_series_discount_percent, for the rentals of a weekly series); a package of hours
  (rental_package_hours for rental_package_cents) — rentals of that room take their minutes from the renter's
  package before any price;
- cancelling: free until rental_free_cancel_hours before; later — the whole price, half, or nothing
  (rental_late_fee); from a package the minutes are kept, half returned or all returned the same way.
The staff may waive the late charge.

A rental checks the room against classes and other rentals (classes.clashes, which now sees rentals too — and a
class checks rentals the same way). A regular renter is a weekly series whose rentals are made ahead, like a
class's sessions (the owner's weeks_ahead), skipping a date the room is taken. Payments — for a rental or a
package — are recorded with a receipt, never collected. The renter gets a message when a rental is booked and when
it is cancelled (room_rental_booked / room_rental_canceled — the owner may turn them off or reword them).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.classes import Room, RoomRental, RoomRentalPackage, RoomRentalSeries
from app.services import classes as svc
from app.services import notifications, policies

PRICINGS = ("hourly", "per_booking")
LATE_FEES = ("full", "half", "none")
TAKES = ("booked", "late_canceled")          # a rental that still holds its package minutes (all or part)


class RentalError(ValueError):
    pass


class ClashError(RentalError):
    def __init__(self, found: list[dict]):
        super().__init__("החדר תפוס באותה שעה")
        self.found = found


def price(room: Room, minutes: int, *, regular: bool = False) -> int:
    """What renting this room for these minutes costs, by the owner's pricing (and the regular-renter discount)."""
    base = room.rental_booking_cents if room.rental_pricing == "per_booking" else round(room.rental_hour_cents * minutes / 60)
    if regular and room.rental_series_discount_percent:
        base = round(base * (100 - room.rental_series_discount_percent) / 100)
    return int(base)


def package_left(db: Session, pkg: RoomRentalPackage) -> int:
    used = db.scalar(select(func.coalesce(func.sum(RoomRental.package_minutes), 0)).where(
        RoomRental.package_id == pkg.id, RoomRental.status.in_(TAKES))) or 0
    return max(0, pkg.minutes_total - int(used))


def _package_for(db: Session, room: Room, client_id, minutes: int) -> RoomRentalPackage | None:
    """The renter's oldest package of this room with enough minutes left."""
    for pkg in db.scalars(select(RoomRentalPackage).where(RoomRentalPackage.room_id == room.id, RoomRentalPackage.client_id == client_id)
                          .order_by(RoomRentalPackage.created_at)).all():
        if package_left(db, pkg) >= minutes:
            return pkg
    return None


def _found(db: Session, room: Room, starts, ends, *, skip=None) -> list[dict]:
    found = svc.clashes(db, room.studio_id, [(starts, ends)], room_id=room.id, skip_rental=skip)["room"]
    return found


def _context(db: Session, r: RoomRental, room: Room) -> dict:
    d, t = svc.il_date_time(r.starts_at)
    _, until = svc.il_date_time(r.ends_at)
    return {"room_name": room.name, "rental_date": d, "rental_time": f"{t}–{until}"}


def book(db: Session, room: Room, client, starts: datetime, ends: datetime, *, series: RoomRentalSeries | None = None,
         note: str | None = None, user_id=None, origin: str = "user", notify: bool = True) -> RoomRental:
    """Rents the room for this time — refused when the room is taken (ClashError with what it clashes with)."""
    if not room.rental_enabled or not room.is_active:
        raise RentalError("החדר הזה לא מושכר")
    if client.studio_id != room.studio_id:
        raise RentalError("השוכר/ת לא נמצא/ה")
    minutes = int((ends - starts).total_seconds() // 60)
    if minutes <= 0:
        raise RentalError("שעת הסיום לפני שעת ההתחלה")
    if minutes < room.rental_min_minutes:
        raise RentalError(f"השכרה לפחות {room.rental_min_minutes} דקות")
    if starts <= svc.now_utc():
        raise RentalError("השעה כבר עברה")
    found = _found(db, room, starts, ends)
    if found:
        raise ClashError(found)
    pkg = _package_for(db, room, client.id, minutes)
    r = RoomRental(studio_id=room.studio_id, room_id=room.id, client_id=client.id, series_id=series.id if series else None,
                   package_id=pkg.id if pkg else None, package_minutes=minutes if pkg else 0,
                   starts_at=starts, ends_at=ends, price_cents=0 if pkg else price(room, minutes, regular=series is not None),
                   note=(note or "").strip()[:300] or None, source=origin, created_by=user_id)
    db.add(r)
    db.flush()
    if notify:
        extra = "מתוך חבילת השעות שלך." if pkg else (f"המחיר: ₪{r.price_cents / 100:,.0f}." if r.price_cents else "")
        notifications.notify(db, room.studio_id, "room_rental_booked", origin=origin, about=f"rental:{r.id}",
                             context={**_context(db, r, room), "rental_note": extra}, clients=[client])
    return r


def late(db: Session, r: RoomRental, room: Room) -> bool:
    return svc.now_utc() > r.starts_at - timedelta(hours=room.rental_free_cancel_hours)


def cancel(db: Session, r: RoomRental, *, user_id=None, waive: bool = False, origin: str = "user") -> RoomRental:
    """Cancels the rental — inside the owner's late window it is charged (all / half / nothing), unless waived."""
    from app.models.client import Client
    if r.status != "booked":
        raise RentalError("ההשכרה כבר בוטלה")
    if r.starts_at <= svc.now_utc():
        raise RentalError("ההשכרה כבר התחילה")
    room = db.get(Room, r.room_id)
    charged = late(db, r, room) and not waive and room.rental_late_fee != "none"
    share = 1 if room.rental_late_fee == "full" else 0.5
    if charged:
        r.status = "late_canceled"
        r.fee_cents = round(r.price_cents * share)
        r.package_minutes = round(r.package_minutes * share)
    else:
        r.status, r.package_minutes = "canceled", 0
    r.canceled_at, r.canceled_by = svc.now_utc(), user_id
    db.flush()
    note = ""
    if charged and r.fee_cents:
        note = f"לפי מדיניות הביטולים יחויב ₪{r.fee_cents / 100:,.0f}."
    elif charged and r.package_minutes:
        note = "לפי מדיניות הביטולים השעות מהחבילה נוצלו." if share == 1 else "לפי מדיניות הביטולים חצי מהשעות נוצלו."
    notifications.notify(db, r.studio_id, "room_rental_canceled", origin=origin, about=f"rental:{r.id}:cancel",
                         context={**_context(db, r, room), "rental_note": note}, clients=[db.get(Client, r.client_id)])
    return r


def charge(r: RoomRental) -> int:
    """What this rental costs the renter now: its price while booked, the late charge once cancelled late."""
    return r.price_cents if r.status == "booked" else r.fee_cents if r.status == "late_canceled" else 0


# ── a regular renter: a weekly series ────────────────────────────────────────

def _dates(s: RoomRentalSeries, until: date) -> list[date]:
    day = s.starts_on + timedelta(days=(s.weekday - svc.js_weekday(s.starts_on)) % 7)
    last = min(until, s.ends_on) if s.ends_on else until
    out = []
    while day <= last:
        out.append(day)
        day += timedelta(days=7)
    return out


def extend(db: Session, s: RoomRentalSeries, *, user_id=None, notify: bool = False) -> dict:
    """Makes the series' rentals up to the owner's window (weeks_ahead) — a date already made, or with the room
    taken, is skipped. Returns {"made": n, "skipped": [dates taken]}."""
    from app.models.client import Client
    room, client = db.get(Room, s.room_id), db.get(Client, s.client_id)
    until = svc.today_il() + timedelta(weeks=policies.get_policy(db, s.studio_id, "weeks_ahead"))
    have = {svc.il_date_time(x)[0] for x in db.scalars(select(RoomRental.starts_at).where(RoomRental.series_id == s.id)).all()}
    made, skipped = 0, []
    for day in _dates(s, until):
        starts = svc.at_il(day, s.start_time)
        if starts <= svc.now_utc() or svc.il_date_time(starts)[0] in have:
            continue
        try:
            book(db, room, client, starts, starts + timedelta(minutes=s.duration_minutes), series=s, note=s.note,
                 user_id=user_id, origin="system" if user_id is None else "user", notify=notify)
            made += 1
        except ClashError:
            skipped.append(day.isoformat())
    return {"made": made, "skipped": skipped}


def start_series(db: Session, room: Room, client, *, weekday: int, start_time: time, duration_minutes: int,
                 starts_on: date, ends_on: date | None = None, note: str | None = None, user_id=None) -> tuple[RoomRentalSeries, dict]:
    if not room.rental_enabled:
        raise RentalError("החדר הזה לא מושכר")
    if ends_on and ends_on < starts_on:
        raise RentalError("תאריך הסיום לפני תאריך ההתחלה")
    s = RoomRentalSeries(studio_id=room.studio_id, room_id=room.id, client_id=client.id, weekday=weekday, start_time=start_time,
                         duration_minutes=duration_minutes, starts_on=starts_on, ends_on=ends_on,
                         note=(note or "").strip()[:300] or None, created_by=user_id)
    db.add(s)
    db.flush()
    result = extend(db, s, user_id=user_id)
    if not result["made"]:
        raise RentalError("אין אף תאריך פנוי — החדר תפוס בכל השבועות האלה")
    return s, result


def preview_series(db: Session, room: Room, *, weekday: int, start_time: time, duration_minutes: int, starts_on: date,
                   ends_on: date | None = None) -> list[str]:
    """The dates of a would-be series that clash (the room is taken) — for the staff before they confirm."""
    probe = RoomRentalSeries(studio_id=room.studio_id, room_id=room.id, client_id=None, weekday=weekday, start_time=start_time,
                             duration_minutes=duration_minutes, starts_on=starts_on, ends_on=ends_on)
    until = svc.today_il() + timedelta(weeks=policies.get_policy(db, room.studio_id, "weeks_ahead"))
    out = []
    for day in _dates(probe, until):
        starts = svc.at_il(day, start_time)
        if starts > svc.now_utc() and _found(db, room, starts, starts + timedelta(minutes=duration_minutes)):
            out.append(day.isoformat())
    return out


def stop_series(db: Session, s: RoomRentalSeries, *, cancel_coming: bool, user_id=None) -> int:
    """No more rentals made; the coming ones cancelled too when asked (never charged)."""
    s.is_active, s.stopped_at = False, svc.now_utc()
    n = 0
    if cancel_coming:
        for r in db.scalars(select(RoomRental).where(RoomRental.series_id == s.id, RoomRental.status == "booked",
                                                     RoomRental.starts_at > svc.now_utc())).all():
            cancel(db, r, user_id=user_id, waive=True)
            n += 1
    db.flush()
    return n


def extend_all(db: Session) -> int:
    """The nightly job: every active series gets its rentals up to the window."""
    made = 0
    for s in db.scalars(select(RoomRentalSeries).where(RoomRentalSeries.is_active.is_(True))).all():
        made += extend(db, s)["made"]
    db.commit()
    return made


# ── packages of hours ────────────────────────────────────────────────────────

def sell_package(db: Session, room: Room, client, *, user_id=None) -> RoomRentalPackage:
    if not room.rental_enabled or not room.rental_package_hours:
        raise RentalError("לחדר הזה אין חבילת שעות")
    pkg = RoomRentalPackage(studio_id=room.studio_id, room_id=room.id, client_id=client.id,
                            minutes_total=room.rental_package_hours * 60, price_cents=room.rental_package_cents, created_by=user_id,
                            created_at=svc.now_utc())     # the month it counts in — the same clock as the rentals
    db.add(pkg)
    db.flush()
    return pkg


# ── the month, renter by renter ──────────────────────────────────────────────

def month_summary(db: Session, studio_id, month: date) -> list[dict]:
    """Each renter's month: rentals, hours, what they were charged (rentals and packages bought), paid, left to pay,
    and the package minutes they still have."""
    from app.models.client import Client
    from app.models.payment import Payment
    lo = svc.at_il(month.replace(day=1), time(0, 0))
    nxt = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
    hi = svc.at_il(nxt, time(0, 0))
    rentals = db.scalars(select(RoomRental).where(RoomRental.studio_id == studio_id, RoomRental.starts_at >= lo,
                                                  RoomRental.starts_at < hi, RoomRental.status.in_(TAKES))).all()
    packages = db.scalars(select(RoomRentalPackage).where(RoomRentalPackage.studio_id == studio_id,
                                                          RoomRentalPackage.created_at >= lo, RoomRentalPackage.created_at < hi)).all()

    def paid_for(column, ids) -> dict:
        if not ids:
            return {}
        rows = db.execute(select(column, Payment.type, func.coalesce(func.sum(Payment.amount_cents), 0))
                          .where(column.in_(ids), Payment.status == "paid").group_by(column, Payment.type)).all()
        out: dict = {}
        for key, kind, total in rows:
            out[key] = out.get(key, 0) + (-int(total) if kind == "refund" else int(total))
        return out

    paid_r = paid_for(Payment.room_rental_id, [r.id for r in rentals])
    paid_p = paid_for(Payment.rental_package_id, [p.id for p in packages])
    people: dict = {}
    for r in rentals:
        x = people.setdefault(r.client_id, {"rentals": 0, "minutes": 0, "charged": 0, "paid": 0})
        x["rentals"] += 1
        x["minutes"] += int((r.ends_at - r.starts_at).total_seconds() // 60) if r.status == "booked" else 0
        x["charged"] += charge(r)
        x["paid"] += paid_r.get(r.id, 0)
    for p in packages:
        x = people.setdefault(p.client_id, {"rentals": 0, "minutes": 0, "charged": 0, "paid": 0})
        x["charged"] += p.price_cents
        x["paid"] += paid_p.get(p.id, 0)
    names = {c.id: c.full_name for c in db.scalars(select(Client).where(Client.id.in_(list(people)))).all()} if people else {}
    out = []
    for cid, x in people.items():
        left = sum(package_left(db, p) for p in db.scalars(select(RoomRentalPackage).where(RoomRentalPackage.client_id == cid)).all())
        out.append({"client_id": str(cid), "full_name": names.get(cid, ""), **x, "due": max(0, x["charged"] - x["paid"]),
                    "package_minutes_left": left})
    return sorted(out, key=lambda x: -x["due"])
