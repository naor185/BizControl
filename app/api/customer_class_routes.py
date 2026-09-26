"""
BizFind: a logged-in customer's group classes at one business — the week's schedule (spots left, not
who is booked), "my classes", "my membership", booking, cancelling, moving to another class, asking to
freeze the membership, and registering for a whole course (its waitlist too). Only for a client of the
business with a covering membership (app/services/class_self_booking.py has the rules); booking and
cancelling go through the same functions the staff use (app/services/class_bookings.py), so the
confirmation, the late-cancel rules and the messages are the same.
"""
from __future__ import annotations

import uuid
from datetime import date, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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
from app.services import class_swap
from app.services import courses
from app.services import membership_requests as requests
from app.services import class_waitlist as wl
from app.services import classes as svc
from app.services import membership_changes as changes
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
    from app.models.client import Client
    from app.services import membership_family as family
    today = svc.today_il()
    rows = family.memberships_of(db, client.id, client.studio_id)          # their own, and the family ones they are on
    bals = ms.balance(db, [m.id for m in rows if m.rules.get("kind") == "punch"])
    out = []
    for m in rows:
        status = ms.status_now(m, bals.get(m.id), today)
        if status not in ("active", "ending", "pending", "frozen"):
            continue
        waiting = requests.pending(db, m.id)
        why_not_freeze = requests.why_not_ask(db, m)
        used, _ = changes.freeze_usage(db, m)
        r = m.rules
        on_it = family.people(db, m) if family.is_family(m.rules) else [m.client_id]
        names = {c.id: c.full_name for c in db.scalars(select(Client).where(Client.id.in_(on_it))).all()}
        out.append({"family": {"holder": m.client_id == client.id, "holder_name": names.get(m.client_id, ""),
                               "others": [names.get(c, "") for c in on_it if c != client.id],
                               "booking_by": m.rules.get("booking_by") or "each"} if family.is_family(m.rules) else None,
                    "id": str(m.id), "name": m.rules.get("name"), "kind": m.rules.get("kind"), "kind_label": ms.KIND_LABELS.get(m.rules.get("kind"), ""),
                    "status": status, "starts_on": m.starts_on.isoformat(), "ends_on": m.ends_on.isoformat() if m.ends_on else None,
                    "entries_left": bals[m.id]["available"] if m.id in bals else None,
                    "freeze_from": m.freeze_from.isoformat() if m.freeze_from else None,
                    "freeze_until": m.freeze_until.isoformat() if m.freeze_until else None,
                    "weekly_limit": m.rules.get("entries") if m.rules.get("kind") == "weekly" else None,
                    # asking to freeze: hidden when the owner allows no requests or the type allows no freeze
                    "freeze": None if requests.hidden(db, m) else {
                        "can_ask": why_not_freeze is None and waiting is None, "why_not": why_not_freeze,
                        "min_days": r.get("freeze_min_days"),
                        "days_left": max(0, r["freeze_max_days"] - used) if r.get("freeze_max_days") else None,
                        "fee_cents": r.get("freeze_fee_cents") or 0,
                        "request": {"id": str(waiting.id), "from_on": waiting.from_on.isoformat(),
                                    "until_on": waiting.until_on.isoformat()} if waiting else None}})
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
    household = selfb.family_of(db, client)[1:]                            # the others the client may book for
    theirs = {p.id: selfb.my_bookings(db, p, [s.id for s in sessions]) for p in household}
    tpls, rooms, staff = _names(db, studio.id, sessions)
    waiting_on = wl.enabled(db, studio.id)
    now = svc.now_utc()
    course_info: dict = {}                   # a course's registration state — once per course in the week
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
        if courses.is_course(t) and t.id not in course_info:
            course_info[t.id] = _course_state(db, t, client)
        book_for = [{"client_id": str(p.id), "name": p.full_name,
                     "booked": s.id in theirs[p.id],
                     "can_book": s.id not in theirs[p.id] and selfb.why_not(db, s, p, spots_left=spots, booked=False, actor_id=client.id) is None}
                    for p in household]
        out.append({"course": course_info.get(s.template_id), "book_for": book_for,
                    "id": str(s.id), "name": t.name if t else "שיעור", "color": (t.color if t else None) or "#6366f1",
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
    people = {p.id: p.full_name for p in selfb.family_of(db, client)}       # the client, and those they book for
    rows = db.execute(select(ClassBooking, ClassSession).join(ClassSession, ClassSession.id == ClassBooking.session_id)
                      .where(ClassBooking.client_id.in_(list(people)), ClassBooking.status != "canceled")
                      .order_by(ClassSession.starts_at.desc()).limit(60)).all()
    tpls, rooms, _ = _names(db, studio.id, [s for _, s in rows])
    now = svc.now_utc()
    upcoming, history = [], []
    for b, s in rows:
        t = tpls.get(s.template_id)
        item = {"id": str(b.id), "session_id": str(s.id), "enrollment_id": str(b.enrollment_id) if b.enrollment_id else None,
                "for_name": None if b.client_id == client.id else people.get(b.client_id),
                "name": t.name if t else "שיעור", "starts_at": s.starts_at.isoformat(),
                "ends_at": s.ends_at.isoformat(), "room_name": rooms.get(s.room_id), "status": b.status}
        if b.status == "booked" and s.starts_at > now and s.status == "scheduled":
            until = selfb.free_cancel_until(db, s)
            upcoming.append({**item, "free_cancel_until": until.isoformat(), "late_if_cancel_now": now > until and not b.enrollment_id,
                             "can_swap": not b.enrollment_id and class_swap.client_may_swap(db, s) is None})
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
    from app.models.classes import CourseEnrollment
    mine_courses = []
    for e, t in db.execute(select(CourseEnrollment, ClassTemplate).join(ClassTemplate, ClassTemplate.id == CourseEnrollment.template_id)
                           .where(CourseEnrollment.client_id == client.id, CourseEnrollment.status.in_(("active", "waiting", "offered")))
                           .order_by(CourseEnrollment.created_at)).all():
        left = [x for x in upcoming if x["enrollment_id"] == str(e.id)]
        money = courses.paid(db, [e.id])[e.id]
        mine_courses.append({"id": str(e.id), "template_id": str(t.id), "name": t.name, "status": e.status,
                             "sessions_total": e.sessions_total, "sessions_left": len(left),
                             "next_starts_at": left[0]["starts_at"] if left else None,
                             "price_cents": e.price_cents, "paid_cents": money["paid"] - money["refunded"],
                             "position": e.position if e.status == "waiting" else None,
                             "offer_expires_at": e.offer_expires_at.isoformat() if e.status == "offered" and e.offer_expires_at else None})
    return {"is_client": True, "memberships": _memberships(db, client), "upcoming": upcoming, "history": history[:30],
            "waitlist": waits, "courses": mine_courses}


class BookIn(BaseModel):
    for_client_id: Optional[uuid.UUID] = None       # the holder of a family membership booking for someone on it


@router.post("/{slug}/sessions/{session_id}/book")
def book(slug: str, session_id: uuid.UUID, body: Optional[BookIn] = None, customer_id: str = Depends(_get_customer_id),
         db: Session = Depends(get_db)):
    studio, actor = _open(db, slug, customer_id)
    if actor is None:
        raise HTTPException(403, NOT_A_CLIENT)
    client = actor
    if body and body.for_client_id and body.for_client_id != actor.id:
        client = next((p for p in selfb.family_of(db, actor) if p.id == body.for_client_id), None)
        if client is None:
            raise HTTPException(403, "אפשר לרשום רק את מי שבמנוי המשפחתי שלך")
    s = db.get(ClassSession, session_id)
    if not s or s.studio_id != studio.id:
        raise HTTPException(404, "השיעור לא נמצא")
    if selfb.my_bookings(db, client, [s.id]):
        raise HTTPException(400, "כבר נרשמת לשיעור הזה")
    spots = max(0, s.capacity - svc.booked_counts(db, [s.id]).get(s.id, 0))
    why = selfb.why_not(db, s, client, spots_left=spots, booked=False, actor_id=actor.id)
    if why:
        raise HTTPException(400, why)
    try:
        bookings.book(db, s, client, origin="user")
    except ValueError as e:                 # e.g. the last spot was just taken
        db.rollback()
        raise HTTPException(400, str(e).split(" — ")[0])
    db.commit()
    return {"ok": True, "message": "נרשמת! אישור נשלח אליך." if client is actor else f"{client.full_name} נרשם/ה! אישור נשלח."}


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


def _course_state(db: Session, t: ClassTemplate, client) -> dict:
    """A course, for this client: its sessions and price now, and whether they may register or wait (or why not)."""
    e = courses.enrollment_of(db, t, client.id) if client else None
    why = NOT_A_CLIENT if client is None else (None if e else courses.why_not_enroll(db, t, client, for_client=True))
    most = policies.get_policy(db, t.studio_id, "waitlist_max", template_id=t.id) or 0
    can_wait = (client is not None and e is None and why == "הקורס מלא" and wl.enabled(db, t.studio_id)
                and bool(policies.get_policy(db, t.studio_id, "course_self_enroll", template_id=t.id))
                and len(courses.line(db, t)) < most)
    return {"template_id": str(t.id), "name": t.name, "sessions_total": len(courses.sessions(db, t)),
            "sessions_left": len(courses.sessions(db, t, coming_only=True)), "price_cents": courses.price_now(db, t),
            "covered_by_membership": courses.covered_by_membership(db, t),
            "single_ok": bool(courses.rule(db, t, "course_drop_in")),
            "enrollment": {"id": str(e.id), "status": e.status, "position": e.position,
                           "offer_expires_at": e.offer_expires_at.isoformat() if e.offer_expires_at else None} if e else None,
            "can_enroll": e is None and why is None, "why_not": why, "can_wait": can_wait}


def _studio_course(db: Session, studio, template_id) -> ClassTemplate:
    t = db.get(ClassTemplate, template_id)
    if not t or t.studio_id != studio.id or not courses.is_course(t):
        raise HTTPException(404, "הקורס לא נמצא")
    return t


def _course_call(db: Session, fn, *args, **kw):
    try:
        result = fn(db, *args, **kw)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e).split(" — ")[0])
    db.commit()
    return result


@router.post("/{slug}/courses/{template_id}/enroll")
def enroll_course(slug: str, template_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    """The client registers for the whole course — every coming session; the payment is at the business."""
    studio, client = _open(db, slug, customer_id)
    if client is None:
        raise HTTPException(403, NOT_A_CLIENT)
    e = _course_call(db, courses.enroll, _studio_course(db, studio, template_id), client, origin="user", for_client=True)
    price = f" המחיר: ₪{e.price_cents / 100:,.0f} — התשלום בעסק." if e.price_cents else ""
    return {"ok": True, "message": f"נרשמת לקורס! {e.sessions_total} מפגשים.{price}"}


@router.post("/{slug}/courses/{template_id}/waitlist")
def wait_for_course(slug: str, template_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    if client is None:
        raise HTTPException(403, NOT_A_CLIENT)
    _course_call(db, courses.join_waitlist, _studio_course(db, studio, template_id), client, for_client=True)
    return {"ok": True, "message": "נכנסת לרשימת ההמתנה לקורס. נודיע לך אם יתפנה מקום."}


def _my_course_wait(db: Session, studio, client, enrollment_id):
    from app.models.classes import CourseEnrollment
    e = db.get(CourseEnrollment, enrollment_id)
    if client is None or not e or e.studio_id != studio.id or e.client_id != client.id:
        raise HTTPException(404, "לא נמצא ברשימת ההמתנה")
    return e


@router.post("/{slug}/course-waits/{enrollment_id}/take")
def take_course_offer(slug: str, enrollment_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    _course_call(db, courses.take_offer, _my_course_wait(db, studio, client, enrollment_id), for_client=True)
    return {"ok": True, "message": "נרשמת לקורס! אישור נשלח אליך."}


@router.post("/{slug}/course-waits/{enrollment_id}/leave")
def leave_course_wait(slug: str, enrollment_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    _course_call(db, courses.leave_waitlist, _my_course_wait(db, studio, client, enrollment_id))
    return {"ok": True}


# ── check-in at the door (the business's QR code) ─────────────────────────────

class CheckinIn(BaseModel):
    key: str


def _checkin_studio(db: Session, slug: str, key: str):
    """The business the code belongs to — with classes, whatever the owner chose about booking on BizFind."""
    from app.services import class_checkin
    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active.is_(True)))
    if not studio or not ms._module(db, studio.id, "classes") or not class_checkin.valid(db, studio.id, key):
        raise HTTPException(404, "הקוד לא תקף — סרקו שוב את הקוד שבכניסה")
    return studio


@router.post("/{slug}/checkin")
def checkin(slug: str, body: CheckinIn, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    """The scan: the client's classes starting now are marked as attended — or the ones they may walk into."""
    from app.services import class_checkin
    studio = _checkin_studio(db, slug, body.key)
    client = selfb.client_of(db, customer_id, studio.id)
    if client is None:
        raise HTTPException(403, "לא נמצאת כלקוח/ה של העסק — פנו לדלפק")
    result = class_checkin.check_in(db, studio.id, client)
    db.commit()
    return {"studio": studio.name, **result}


@router.post("/{slug}/checkin/{session_id}")
def checkin_walk_in(slug: str, session_id: uuid.UUID, body: CheckinIn, customer_id: str = Depends(_get_customer_id),
                    db: Session = Depends(get_db)):
    """One tap at the door: booked into a class starting now and marked as attended."""
    from app.services import class_checkin
    studio = _checkin_studio(db, slug, body.key)
    client = selfb.client_of(db, customer_id, studio.id)
    s = db.get(ClassSession, session_id)
    if client is None or not s or s.studio_id != studio.id:
        raise HTTPException(404, "השיעור לא נמצא")
    try:
        done = class_checkin.walk_in(db, studio.id, client, s)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e).split(" — ")[0])
    db.commit()
    return {"studio": studio.name, "checked_in": [done]}


def _my_booking(db: Session, studio, client, booking_id) -> ClassBooking:
    """The client's booking — or, for the holder of a family membership, one of the family's."""
    b = db.get(ClassBooking, booking_id)
    if client is None or not b or b.studio_id != studio.id or all(p.id != b.client_id for p in selfb.family_of(db, client)):
        raise HTTPException(404, "ההרשמה לא נמצאה")
    return b


@router.get("/{slug}/bookings/{booking_id}/swap-options")
def swap_options(slug: str, booking_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    """The classes of the next two weeks the client may move this booking to — each with why not."""
    studio, client = _open(db, slug, customer_id)
    return class_swap.options(db, _my_booking(db, studio, client, booking_id), for_client=True)


class SwapIn(BaseModel):
    session_id: uuid.UUID


@router.post("/{slug}/bookings/{booking_id}/swap")
def swap(slug: str, booking_id: uuid.UUID, body: SwapIn, customer_id: str = Depends(_get_customer_id),
         db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    b = _my_booking(db, studio, client, booking_id)
    target = db.get(ClassSession, body.session_id)
    if not target or target.studio_id != studio.id:
        raise HTTPException(404, "השיעור לא נמצא")
    try:
        class_swap.swap(db, b, target, origin="user", for_client=True)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e).split(" — ")[0])
    db.commit()
    return {"ok": True, "message": "ההרשמה הועברה! אישור נשלח אליך."}


class FreezeAskIn(BaseModel):
    from_on: date
    until_on: date                     # the return date
    note: Optional[str] = None


@router.post("/{slug}/memberships/{membership_id}/freeze-request")
def ask_freeze(slug: str, membership_id: uuid.UUID, body: FreezeAskIn, customer_id: str = Depends(_get_customer_id),
               db: Session = Depends(get_db)):
    """The client asks to freeze their membership — checked at once against its rules; approved by the owner
    (or by itself, the owner's choice)."""
    studio, client = _open(db, slug, customer_id)
    m = db.get(Membership, membership_id)
    if client is None or not m or m.studio_id != studio.id or m.client_id != client.id:
        raise HTTPException(404, "המנוי לא נמצא")
    try:
        req = requests.ask_freeze(db, m, body.from_on, body.until_on, body.note)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    db.commit()
    if req.status == "approved":
        return {"ok": True, "approved": True, "message": "המנוי הוקפא. אישור נשלח אליך."}
    return {"ok": True, "approved": False, "message": "הבקשה נשלחה לעסק. נעדכן אותך כשתהיה תשובה."}


@router.post("/{slug}/freeze-requests/{request_id}/withdraw")
def withdraw_freeze(slug: str, request_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    from app.models.memberships import MembershipRequest
    studio, client = _open(db, slug, customer_id)
    req = db.get(MembershipRequest, request_id)
    if client is None or not req or req.studio_id != studio.id or req.client_id != client.id:
        raise HTTPException(404, "הבקשה לא נמצאה")
    try:
        requests.withdraw(db, req)
    except ValueError as e:
        db.rollback()
        raise HTTPException(400, str(e))
    db.commit()
    return {"ok": True}


@router.post("/{slug}/bookings/{booking_id}/cancel")
def cancel(slug: str, booking_id: uuid.UUID, customer_id: str = Depends(_get_customer_id), db: Session = Depends(get_db)):
    studio, client = _open(db, slug, customer_id)
    b = _my_booking(db, studio, client, booking_id)
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
