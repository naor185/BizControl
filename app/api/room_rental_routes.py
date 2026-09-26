"""
Renting a room out (classes extras 7): rentals, a regular renter's weekly series, packages of hours, their payments
and the month renter by renter. The room's rules (price, shortest rental, discounts, cancelling) are on the room
(class_routes' rooms). app/services/room_rentals.py does the work.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext
from app.core.features import require_module
from app.core.permissions import may, require_action
from app.models.classes import Room, RoomRental, RoomRentalPackage, RoomRentalSeries
from app.models.client import Client
from app.services import class_payments as payments
from app.services import classes as svc
from app.services import room_rentals as rentals

router = APIRouter(prefix="/classes", tags=["Room rentals"],
                   dependencies=[Depends(require_module("classes")), Depends(require_module("rooms"))])
MANAGE = Depends(require_action("bookings.manage"))


def _get(db: Session, model, studio_id, obj_id, missing: str):
    obj = db.get(model, obj_id)
    if not obj or obj.studio_id != studio_id:
        raise HTTPException(404, missing)
    return obj


def _fail(db: Session, e: ValueError):
    db.rollback()
    if isinstance(e, rentals.ClashError):
        listed = ", ".join(svc.clash_text(x) for x in e.found)
        raise HTTPException(409, f"החדר תפוס באותה שעה: {listed}")
    raise HTTPException(400, str(e))


def _rentals_out(db: Session, rows: list[RoomRental]) -> list[dict]:
    from app.models.payment import Payment
    from sqlalchemy import func
    rooms = {r.id: r.name for r in db.scalars(select(Room).where(Room.id.in_({x.room_id for x in rows}))).all()} if rows else {}
    names = {c.id: c.full_name for c in db.scalars(select(Client).where(Client.id.in_({x.client_id for x in rows}))).all()} if rows else {}
    paid = dict(db.execute(select(Payment.room_rental_id, func.coalesce(func.sum(Payment.amount_cents), 0))
                           .where(Payment.room_rental_id.in_([x.id for x in rows]), Payment.status == "paid", Payment.type != "refund")
                           .group_by(Payment.room_rental_id)).all()) if rows else {}
    return [{"id": str(r.id), "room_id": str(r.room_id), "room_name": rooms.get(r.room_id, ""), "client_id": str(r.client_id),
             "renter": names.get(r.client_id, ""), "starts_at": r.starts_at.isoformat(), "ends_at": r.ends_at.isoformat(),
             "status": r.status, "price_cents": r.price_cents, "fee_cents": r.fee_cents, "charge_cents": rentals.charge(r),
             "paid_cents": int(paid.get(r.id, 0)), "from_package": r.package_id is not None, "package_minutes": r.package_minutes,
             "series_id": str(r.series_id) if r.series_id else None, "note": r.note} for r in rows]


@router.get("/rentals")
def list_rentals(from_day: Optional[date] = None, to_day: Optional[date] = None, room_id: Optional[uuid.UUID] = None,
                 ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    lo_day = from_day or svc.today_il()
    hi_day = to_day or lo_day + timedelta(days=13)
    q = select(RoomRental).where(RoomRental.studio_id == ctx.studio_id, RoomRental.status != "canceled",
                                 RoomRental.starts_at >= svc.at_il(lo_day, time(0, 0)),
                                 RoomRental.starts_at < svc.at_il(hi_day + timedelta(days=1), time(0, 0)))
    if room_id:
        q = q.where(RoomRental.room_id == room_id)
    return _rentals_out(db, list(db.scalars(q.order_by(RoomRental.starts_at)).all()))


class RentIn(BaseModel):
    room_id: uuid.UUID
    client_id: uuid.UUID
    day: date
    start_time: time
    duration_minutes: int = Field(ge=15, le=24 * 60)
    note: Optional[str] = Field(None, max_length=300)


@router.post("/rentals")
def rent(body: RentIn, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    """Rents the room — 409 with what it clashes with when the room is taken."""
    room = _get(db, Room, ctx.studio_id, body.room_id, "החדר לא נמצא")
    client = _get(db, Client, ctx.studio_id, body.client_id, "השוכר/ת לא נמצא/ה")
    starts = svc.at_il(body.day, body.start_time)
    try:
        r = rentals.book(db, room, client, starts, starts + timedelta(minutes=body.duration_minutes), note=body.note, user_id=ctx.user_id)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return _rentals_out(db, [r])[0]


class CancelIn(BaseModel):
    waive: bool = False             # no late charge — the owner or a manager


@router.post("/rentals/{rental_id}/cancel")
def cancel(rental_id: uuid.UUID, body: CancelIn, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    r = _get(db, RoomRental, ctx.studio_id, rental_id, "ההשכרה לא נמצאה")
    if body.waive and not may(ctx.role, "limits.override"):
        raise HTTPException(403, "ביטול בלי חיוב — לבעלים או למנהל")
    try:
        rentals.cancel(db, r, user_id=ctx.user_id, waive=body.waive)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return _rentals_out(db, [r])[0]


class PayIn(BaseModel):
    amount_cents: int = Field(gt=0, le=10_000_000)
    method: str
    send_receipt: bool = True


@router.post("/rentals/{rental_id}/payments")
def pay_rental(rental_id: uuid.UUID, body: PayIn, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    r = _get(db, RoomRental, ctx.studio_id, rental_id, "ההשכרה לא נמצאה")
    try:
        payments.record(db, ctx.studio_id, db.get(Client, r.client_id), amount_cents=body.amount_cents, method=body.method,
                        rental=r, send_receipt=body.send_receipt)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return _rentals_out(db, [r])[0]


# ── a regular renter ─────────────────────────────────────────────────────────

class SeriesIn(BaseModel):
    room_id: uuid.UUID
    client_id: uuid.UUID
    weekday: int = Field(ge=0, le=6)
    start_time: time
    duration_minutes: int = Field(ge=15, le=24 * 60)
    starts_on: date
    ends_on: Optional[date] = None
    note: Optional[str] = Field(None, max_length=300)
    dry_run: bool = False           # only the dates the room is taken


def _series_out(db: Session, s: RoomRentalSeries) -> dict:
    return {"id": str(s.id), "room_id": str(s.room_id), "client_id": str(s.client_id),
            "renter": (db.get(Client, s.client_id).full_name if s.client_id else ""), "weekday": s.weekday,
            "start_time": s.start_time.strftime("%H:%M"), "duration_minutes": s.duration_minutes,
            "starts_on": s.starts_on.isoformat(), "ends_on": s.ends_on.isoformat() if s.ends_on else None, "is_active": s.is_active}


@router.post("/rental-series")
def start_series(body: SeriesIn, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    room = _get(db, Room, ctx.studio_id, body.room_id, "החדר לא נמצא")
    client = _get(db, Client, ctx.studio_id, body.client_id, "השוכר/ת לא נמצא/ה")
    if body.dry_run:
        return {"taken": rentals.preview_series(db, room, weekday=body.weekday, start_time=body.start_time,
                                                duration_minutes=body.duration_minutes, starts_on=body.starts_on, ends_on=body.ends_on)}
    try:
        s, result = rentals.start_series(db, room, client, weekday=body.weekday, start_time=body.start_time,
                                         duration_minutes=body.duration_minutes, starts_on=body.starts_on, ends_on=body.ends_on,
                                         note=body.note, user_id=ctx.user_id)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return {**_series_out(db, s), **result}


@router.get("/rental-series")
def list_series(ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    return [_series_out(db, s) for s in db.scalars(select(RoomRentalSeries).where(
        RoomRentalSeries.studio_id == ctx.studio_id, RoomRentalSeries.is_active.is_(True)).order_by(RoomRentalSeries.weekday)).all()]


class StopIn(BaseModel):
    cancel_coming: bool = False


@router.post("/rental-series/{series_id}/stop")
def stop_series(series_id: uuid.UUID, body: StopIn, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    s = _get(db, RoomRentalSeries, ctx.studio_id, series_id, "ההשכרה הקבועה לא נמצאה")
    n = rentals.stop_series(db, s, cancel_coming=body.cancel_coming, user_id=ctx.user_id)
    db.commit()
    return {**_series_out(db, s), "canceled": n}


# ── packages of hours ────────────────────────────────────────────────────────

class PackageIn(BaseModel):
    room_id: uuid.UUID
    client_id: uuid.UUID


def _package_out(db: Session, p: RoomRentalPackage) -> dict:
    return {"id": str(p.id), "room_id": str(p.room_id), "client_id": str(p.client_id), "minutes_total": p.minutes_total,
            "minutes_left": rentals.package_left(db, p), "price_cents": p.price_cents, "created_at": p.created_at.isoformat()}


@router.post("/rental-packages")
def sell_package(body: PackageIn, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    room = _get(db, Room, ctx.studio_id, body.room_id, "החדר לא נמצא")
    try:
        p = rentals.sell_package(db, room, _get(db, Client, ctx.studio_id, body.client_id, "השוכר/ת לא נמצא/ה"), user_id=ctx.user_id)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return _package_out(db, p)


@router.get("/rental-packages")
def list_packages(client_id: Optional[uuid.UUID] = None, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    q = select(RoomRentalPackage).where(RoomRentalPackage.studio_id == ctx.studio_id)
    if client_id:
        q = q.where(RoomRentalPackage.client_id == client_id)
    return [_package_out(db, p) for p in db.scalars(q.order_by(RoomRentalPackage.created_at.desc())).all()]


@router.post("/rental-packages/{package_id}/payments")
def pay_package(package_id: uuid.UUID, body: PayIn, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    p = _get(db, RoomRentalPackage, ctx.studio_id, package_id, "החבילה לא נמצאה")
    try:
        payments.record(db, ctx.studio_id, db.get(Client, p.client_id), amount_cents=body.amount_cents, method=body.method,
                        rental_package=p, send_receipt=body.send_receipt)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return _package_out(db, p)


@router.get("/rentals/summary")
def month_summary(month: Optional[date] = None, ctx: AuthContext = MANAGE, db: Session = Depends(get_db)):
    """The month renter by renter: rentals, hours, charged, paid, left to pay, package minutes left."""
    return rentals.month_summary(db, ctx.studio_id, month or svc.today_il())
