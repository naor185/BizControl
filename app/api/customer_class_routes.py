"""
BizFind: a logged-in customer's group classes at one business — the week's schedule (spots left, not
who is booked), "my classes", "my membership", booking and cancelling. Only for a client of the
business with a covering membership (app/services/class_self_booking.py has the rules); booking and
cancelling go through the same functions the staff use (app/services/class_bookings.py), so the
confirmation, the late-cancel rules and the messages are the same.
"""
from __future__ import annotations

import uuid
from datetime import date, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.marketplace_customer_routes import _get_customer_id
from app.core.database import get_db
from app.models.classes import ClassBooking, ClassSession, ClassTemplate, Room
from app.models.memberships import Membership
from app.models.studio import Studio
from app.models.user import User
from app.services import class_bookings as bookings
from app.services import class_self_booking as selfb
from app.services import class_waitlist as wl
from app.services import classes as svc
from app.services import memberships as ms
from app.services import policies

router = APIRouter(prefix="/marketplace/classes", tags=["MarketplaceClasses"])
NOT_A_CLIENT = "ההרשמה לשיעורים פתוחה ללקוחות העסק עם מנוי"


def _open(db: Session, slug: str, customer_id: str):
    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active.is_(True)))
    if not studio or not selfb.open_to_clients(db, studio):
        raise HTTPException(404, "אין הרשמה לשיעורים בעסק הזה")
    return studio, selfb.client_of(db, customer_id, studio.id)


def _memberships(db: Session, client) -> list[dict]:
    if client is None:
        return []
    today = svc.today_il()
    rows = db.scalars(select(Membership).where(Membership.client_id == client.id)).all()
    bals = ms.balance(db, [m.id for m in rows if m.rules.get("kind") == "punch"])
    out = []
    for m in rows:
        status = ms.status_now(m, bals.get(m.id), today)
        if status not in ("active", "ending", "pending", "frozen"):
            continue
        out.append({"name": m.rules.get("name"), "kind": m.rules.get("kind"), "kind_label": ms.KIND_LABELS.get(m.rules.get("kind"), ""),
                    "status": status, "starts_on": m.starts_on.isoformat(), "ends_on": m.ends_on.isoformat() if m.ends_on else None,
                    "entries_left": bals[m.id]["available"] if m.id in bals else None,
                    "freeze_from": m.freeze_from.isoformat() if m.freeze_from else None,
                    "freeze_until": m.freeze_until.isoformat() if m.freeze_until else None,
                    "weekly_limit": m.rules.get("entries") if m.rules.get("kind") == "weekly" else None})
    return out


def _names(db: Session, studio_id, sessions) -> tuple[dict, dict, dict]:
    tpl_ids = {s.template_id for s in sessions if s.template_id}
    tpls = {t.id: t for t in db.scalars(select(ClassTemplate).where(ClassTemplate.id.in_(tpl_ids))).all()} if tpl_ids else {}
    rooms = {r.id: r.name for r in db.scalars(select(Room).where(Room.studio_id == studio_id)).all()}
    staff = {u.id: u.display_name for u in db.scalars(select(User).where(User.studio_id == studio_id)).all()}
    return tpls, rooms, staff


@router.get("/{slug}/schedule")
def schedule(slug: str, week: Optional[date] = None, customer_id: str = Depends(_get_customer_id),
             db: Session = Depends(get_db)):
    """The week (Sunday–Saturday, Israel time) — with what this client may do in each class."""
    studio, client = _open(db, slug, customer_id)
    today = svc.today_il()
    start = week or today
    start = start - timedelta(days=svc.js_weekday(start))
    lo, hi = svc.at_il(start, time(0, 0)), svc.at_il(start + timedelta(days=7), time(0, 0))
    sessions = db.scalars(select(ClassSession).where(ClassSession.studio_id == studio.id, ClassSession.status == "scheduled",
                                                     ClassSession.starts_at >= lo, ClassSession.starts_at < hi)
                          .order_by(ClassSession.starts_at)).all()
    mine = selfb.my_bookings(db, client, [s.id for s in sessions])
    tpls, rooms, staff = _names(db, studio.id, sessions)
    waiting_on = wl.enabled(db, studio.id)
    now = svc.now_utc()
    out = []
    for s in sessions:
        t, b = tpls.get(s.template_id), mine.get(s.id)
        spots = wl.spots_left(db, s, client.id if client else None)
        why = selfb.why_not(db, s, client, spots_left=spots, booked=b is not None)
        line = wl.queue(db, s.id) if waiting_on else []
        me = next(((i, e) for i, e in enumerate(line, start=1) if client and e.client_id == client.id), None)
        # waiting is for someone who could book if there were a spot (a membership that covers it…)
        can_wait = (waiting_on and why == "השיעור מלא" and me is None and s.starts_at - now >= wl.CUTOFF
                    and len(line) < (policies.get_policy(db, studio.id, "waitlist_max", template_id=s.template_id) or 0)
                    and selfb.why_not(db, s, client, spots_left=1, booked=False) is None)
        until = selfb.free_cancel_until(db, s)
        out.append({"id": str(s.id), "name": t.name if t else "שיעור", "color": (t.color if t else None) or "#6366f1",
                    "starts_at": s.starts_at.isoformat(), "ends_at": s.ends_at.isoformat(),
                    "room_name": rooms.get(s.room_id), "instructor_name": staff.get(s.instructor_id),
                    "spots_left": spots, "my_booking": {"id": str(b.id), "status": b.status} if b else None,
                    "can_book": b is None and why is None, "why_not": None if b else why,
                    "free_cancel_until": until.isoformat(), "late_if_cancel_now": now > until,
                    "waitlist": {"can_join": can_wait, "count": len(line),
                                 "mine": {"id": str(me[1].id), "position": me[0], "status": me[1].status,
                                          "offer_expires_at": me[1].offer_expires_at.isoformat() if me[1].offer_expires_at else None}
                                 if me else None}})
    return {"studio": {"name": studio.name, "slug": studio.slug}, "is_client": client is not None,
            "week": start.isoformat(), "memberships": _memberships(db, client), "sessions": out}


@router.get("/{slug}/mine")
def mine(slug: str, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    """My membership, my coming classes (with cancel) and what came before."""
    studio, client = _open(db, slug, customer_id)
    if client is None:
        return {"is_client": False, "memberships": [], "upcoming": [], "history": []}
    rows = db.execute(select(ClassBooking, ClassSession).join(ClassSession, ClassSession.id == ClassBooking.session_id)
                      .where(ClassBooking.client_id == client.id, ClassBooking.status != "canceled")
                      .order_by(ClassSession.starts_at.desc()).limit(60)).all()
    tpls, rooms, _ = _names(db, studio.id, [s for _, s in rows])
    now = svc.now_utc()
    upcoming, history = [], []
    for b, s in rows:
        t = tpls.get(s.template_id)
        item = {"id": str(b.id), "session_id": str(s.id), "name": t.name if t else "שיעור", "starts_at": s.starts_at.isoformat(),
                "ends_at": s.ends_at.isoformat(), "room_name": rooms.get(s.room_id), "status": b.status}
        if b.status == "booked" and s.starts_at > now and s.status == "scheduled":
            until = selfb.free_cancel_until(db, s)
            upcoming.append({**item, "free_cancel_until": until.isoformat(), "late_if_cancel_now": now > until})
        else:
            history.append(item)
    upcoming.sort(key=lambda x: x["starts_at"])
    from app.models.wait_list import WaitListEntry
    waits = []
    for e, s in db.execute(select(WaitListEntry, ClassSession).join(ClassSession, ClassSession.id == WaitListEntry.session_id)
                           .where(WaitListEntry.client_id == client.id, WaitListEntry.status.in_(wl.ACTIVE))
                           .order_by(ClassSession.starts_at)).all():
        t = db.get(ClassTemplate, s.template_id) if s.template_id else None
        position = next((i for i, x in enumerate(wl.queue(db, s.id), start=1) if x.id == e.id), None)
        waits.append({"id": str(e.id), "session_id": str(s.id), "name": t.name if t else "שיעור", "starts_at": s.starts_at.isoformat(),
                      "status": e.status, "position": position,
                      "offer_expires_at": e.offer_expires_at.isoformat() if e.offer_expires_at else None})
    return {"is_client": True, "memberships": _memberships(db, client), "upcoming": upcoming, "history": history[:30],
            "waitlist": waits}


@router.post("/{slug}/sessions/{session_id}/book")
def book(slug: str, session_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    if client is None:
        raise HTTPException(403, NOT_A_CLIENT)
    s = db.get(ClassSession, session_id)
    if not s or s.studio_id != studio.id:
        raise HTTPException(404, "השיעור לא נמצא")
    if selfb.my_bookings(db, client, [s.id]):
        raise HTTPException(400, "כבר נרשמת לשיעור הזה")
    spots = max(0, s.capacity - svc.booked_counts(db, [s.id]).get(s.id, 0))
    why = selfb.why_not(db, s, client, spots_left=spots, booked=False)
    if why:
        raise HTTPException(400, why)
    try:
        bookings.book(db, s, client, origin="user")
    except ValueError as e:                 # e.g. the last spot was just taken
        db.rollback()
        raise HTTPException(400, str(e).split(" — ")[0])
    db.commit()
    return {"ok": True, "message": "נרשמת! אישור נשלח אליך."}


@router.post("/{slug}/sessions/{session_id}/waitlist")
def join_waitlist(slug: str, session_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    if client is None:
        raise HTTPException(403, NOT_A_CLIENT)
    s = db.get(ClassSession, session_id)
    if not s or s.studio_id != studio.id:
        raise HTTPException(404, "השיעור לא נמצא")
    why = selfb.why_not(db, s, client, spots_left=1, booked=False)     # as if there were a spot
    if why:                                  # everything but the spots must let this client book
        raise HTTPException(400, why)
    try:
        wl.join(db, s, client)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    db.commit()
    return {"ok": True, "message": "נכנסת לרשימת ההמתנה. נודיע לך אם יתפנה מקום."}


def _my_entry(db: Session, studio, client, entry_id):
    from app.models.wait_list import WaitListEntry
    e = db.get(WaitListEntry, entry_id)
    if client is None or not e or e.studio_id != studio.id or e.client_id != client.id or e.session_id is None:
        raise HTTPException(404, "לא נמצא ברשימת ההמתנה")
    return e


@router.post("/{slug}/waitlist/{entry_id}/leave")
def leave_waitlist(slug: str, entry_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    try:
        wl.leave(db, _my_entry(db, studio, client, entry_id))
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    db.commit()
    return {"ok": True}


@router.post("/{slug}/waitlist/{entry_id}/confirm")
def confirm_waitlist(slug: str, entry_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    """The client takes the spot the waitlist offered them."""
    studio, client = _open(db, slug, customer_id)
    try:
        wl.confirm(db, _my_entry(db, studio, client, entry_id), origin="user")
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e).split(" — ")[0])
    db.commit()
    return {"ok": True, "message": "נרשמת! אישור נשלח אליך."}


@router.post("/{slug}/bookings/{booking_id}/cancel")
def cancel(slug: str, booking_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    b = db.get(ClassBooking, booking_id)
    if client is None or not b or b.studio_id != studio.id or b.client_id != client.id:
        raise HTTPException(404, "ההרשמה לא נמצאה")
    s = db.get(ClassSession, b.session_id)
    if s.starts_at <= svc.now_utc():
        raise HTTPException(400, "השיעור כבר התחיל — לביטול פנו לעסק")
    try:
        status = bookings.cancel(db, b, origin="user")
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    db.commit()
    return {"status": status, "late": status == "late_canceled"}
