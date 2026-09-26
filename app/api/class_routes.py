"""
Group classes: rooms, class templates (a class every week, or a short course) and the schedule — one
session changed or cancelled on its own (stage 2) — and bookings: booking a client in, cancelling,
attendance (stage 3, app/services/class_bookings.py). Behind the "classes" module; rooms also need
"rooms". Setting things up needs classes.configure; changing or cancelling one session needs
sessions.change; bookings need bookings.manage; attendance needs attendance.mark.
Every save can run first with dry_run: true — the screen shows clashes and how many booked clients a
change reaches before anything is saved. app/services/classes.py does the work.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.features import require_module
from app.core.permissions import may, require_action
from app.models.classes import ClassSession, ClassTemplate, Room
from app.models.service import Service
from app.models.user import User
from app.services import class_bookings as bookings
from app.services import classes as svc
from app.services import courses
from app.services import policies

router = APIRouter(prefix="/classes", tags=["Classes"], dependencies=[Depends(require_module("classes"))])
ROOMS = [Depends(require_module("rooms"))]
STAFF_ROLES = ("owner", "admin", "artist", "staff")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
SPEC_FIELDS = ("weekdays", "start_time", "duration_minutes", "starts_on", "ends_on", "sessions_count",
               "room_id", "instructor_id", "capacity")
COLUMNS = ("name", "service_id", "color", "course_price_cents") + SPEC_FIELDS


def _get(db: Session, model, studio_id, obj_id, missing: str):
    obj = db.get(model, obj_id)
    if not obj or obj.studio_id != studio_id:
        raise HTTPException(404, missing)
    return obj


def _staff_word(db: Session, studio_id) -> str:
    from app.services.business_types import studio_terms
    return studio_terms(db, studio_id)["staff"]


def _refuse_clashes(db: Session, studio_id, found: dict, confirmed: bool) -> None:
    """A busy room is refused; a busy instructor needs the owner's confirmation."""
    def listed(items):
        more = f" (ועוד {len(items) - 1})" if len(items) > 1 else ""
        return svc.clash_text(items[0]) + more
    if found["room"]:
        raise HTTPException(400, f"החדר תפוס באותה שעה: {listed(found['room'])}")
    if found["instructor"] and not confirmed:
        raise HTTPException(409, f"חפיפה ל{_staff_word(db, studio_id)}: {listed(found['instructor'])}")


# ── rooms ────────────────────────────────────────────────────────────────────

class RoomIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    capacity: int = Field(ge=1, le=500)


class RoomPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    capacity: Optional[int] = Field(None, ge=1, le=500)
    is_active: Optional[bool] = None


def _room_out(r: Room) -> dict:
    return {"id": str(r.id), "name": r.name, "capacity": r.capacity, "is_active": r.is_active}


@router.get("/rooms", dependencies=ROOMS)
def list_rooms(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    rows = db.scalars(select(Room).where(Room.studio_id == ctx.studio_id)
                      .order_by(Room.is_active.desc(), Room.name)).all()
    return [_room_out(r) for r in rows]


@router.post("/rooms", dependencies=ROOMS)
def create_room(body: RoomIn, ctx: AuthContext = Depends(require_action("classes.configure")),
                db: Session = Depends(get_db)):
    room = Room(studio_id=ctx.studio_id, name=body.name.strip(), capacity=body.capacity)
    db.add(room)
    db.commit()
    return _room_out(room)


@router.patch("/rooms/{room_id}", dependencies=ROOMS)
def update_room(room_id: uuid.UUID, body: RoomPatch, ctx: AuthContext = Depends(require_action("classes.configure")),
                db: Session = Depends(get_db)):
    room = _get(db, Room, ctx.studio_id, room_id, "החדר לא נמצא")
    using = db.scalars(select(ClassTemplate).where(ClassTemplate.studio_id == ctx.studio_id,
                                                   ClassTemplate.room_id == room.id, ClassTemplate.is_active.is_(True))).all()
    if body.is_active is False and using:
        raise HTTPException(400, f"החדר משמש שיעורים קבועים: {', '.join(t.name for t in using)}. החלף להם חדר קודם.")
    if body.capacity is not None and any(t.capacity > body.capacity for t in using):
        bigger = [t.name for t in using if t.capacity > body.capacity]
        raise HTTPException(400, f"יש שיעורים קבועים בחדר עם יותר מקומות: {', '.join(bigger)}")
    if body.name is not None:
        room.name = body.name.strip()
    if body.capacity is not None:
        room.capacity = body.capacity
    if body.is_active is not None:
        room.is_active = body.is_active
    db.commit()
    return _room_out(room)


# ── class templates ──────────────────────────────────────────────────────────

class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    service_id: Optional[uuid.UUID] = None
    color: Optional[str] = None
    room_id: Optional[uuid.UUID] = None
    instructor_id: Optional[uuid.UUID] = None
    capacity: Optional[int] = Field(None, ge=1, le=500)            # default: the room's spots
    weekdays: list[int]
    start_time: time
    duration_minutes: Optional[int] = Field(None, ge=5, le=600)    # default: the service's length
    starts_on: date
    ends_on: Optional[date] = None
    sessions_count: Optional[int] = Field(None, ge=1, le=200)
    course_price_cents: Optional[int] = Field(None, ge=0, le=10_000_000)   # a course: the price for all its sessions
    rules: Optional[dict[str, object]] = None                      # this class's own rules; null = the business's
    dry_run: bool = False
    confirm_clashes: bool = False


class TemplatePatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=160)
    service_id: Optional[uuid.UUID] = None
    color: Optional[str] = None
    room_id: Optional[uuid.UUID] = None
    instructor_id: Optional[uuid.UUID] = None
    capacity: Optional[int] = Field(None, ge=1, le=500)
    weekdays: Optional[list[int]] = None
    start_time: Optional[time] = None
    duration_minutes: Optional[int] = Field(None, ge=5, le=600)
    starts_on: Optional[date] = None
    ends_on: Optional[date] = None
    sessions_count: Optional[int] = Field(None, ge=1, le=200)
    course_price_cents: Optional[int] = Field(None, ge=0, le=10_000_000)
    rules: Optional[dict[str, object]] = None
    dry_run: bool = False
    confirm_clashes: bool = False
    apply_to_booked: bool = False      # booked sessions change too — and their clients get a message


def _check_room(db: Session, studio_id, room_id, capacity: int | None) -> Room | None:
    if room_id is None:
        return None
    from app.core.features import is_module_enabled
    from app.models.studio import Studio
    st = db.get(Studio, studio_id)
    if not is_module_enabled(db, studio_id, st.subscription_plan or "free", "rooms"):
        raise HTTPException(400, "חדרים לא פעילים בעסק")
    room = _get(db, Room, studio_id, room_id, "החדר לא נמצא")
    if not room.is_active:
        raise HTTPException(400, "החדר הוצא משימוש")
    if capacity is not None and capacity > room.capacity:
        raise HTTPException(400, f"בחדר {room.name} יש {room.capacity} מקומות")
    return room


def _check_instructor(db: Session, studio_id, user_id) -> None:
    if user_id is None:
        return
    u = db.get(User, user_id)
    if not u or u.studio_id != studio_id or not u.is_active or u.role not in STAFF_ROLES:
        raise HTTPException(400, f"{_staff_word(db, studio_id)}: לא נמצא/ה בצוות")


def _resolve(db: Session, studio_id, v: dict) -> dict:
    """Checks a template's values and fills the defaults (spots from the room, length and color from the
    service). Returns the values to store."""
    v = dict(v)
    v["name"] = (v.get("name") or "").strip()
    if not v["name"]:
        raise HTTPException(400, "חסר שם לשיעור")
    days = sorted(set(v.get("weekdays") or []))
    if not days or any(d not in range(7) for d in days):
        raise HTTPException(400, "בחר לפחות יום אחד בשבוע")
    v["weekdays"] = days
    service = _get(db, Service, studio_id, v["service_id"], "השירות לא נמצא") if v.get("service_id") else None
    if v.get("duration_minutes") is None:
        if not service:
            raise HTTPException(400, "כמה זמן נמשך השיעור?")
        v["duration_minutes"] = service.duration_minutes
    if v.get("color") and not HEX.match(v["color"]):
        raise HTTPException(400, "צבע לא תקין")
    v["color"] = v.get("color") or (service.color if service else None)
    room = _check_room(db, studio_id, v.get("room_id"), v.get("capacity"))
    if v.get("capacity") is None:
        if not room:
            raise HTTPException(400, "כמה מקומות יש בשיעור?")
        v["capacity"] = room.capacity
    _check_instructor(db, studio_id, v.get("instructor_id"))
    if v.get("ends_on") and v["ends_on"] < v["starts_on"]:
        raise HTTPException(400, "תאריך הסיום לפני תאריך ההתחלה")
    return {k: v.get(k) for k in COLUMNS}


def _save_rules(db: Session, studio_id, template_id, rules: dict | None, user_id) -> None:
    for key, value in (rules or {}).items():
        try:
            policies.set_policy(db, studio_id, key, value, scope_type=policies.TEMPLATE, scope_id=template_id,
                                user_id=user_id)
        except ValueError as e:
            raise HTTPException(400, str(e))


def _template_rules(db: Session, studio_id, template_id) -> dict:
    from app.models.policy_setting import PolicySetting as P
    rows = db.scalars(select(P).where(P.studio_id == studio_id, P.scope_type == policies.TEMPLATE,
                                      P.scope_id == template_id)).all()
    return {r.key: r.value for r in rows}


def _templates_out(db: Session, studio_id, tpls: list[ClassTemplate]) -> list[dict]:
    rooms = {r.id: r for r in db.scalars(select(Room).where(Room.studio_id == studio_id)).all()}
    users = {u.id: u for u in db.scalars(select(User).where(User.studio_id == studio_id)).all()}
    now = svc.now_utc()
    future = db.scalars(select(ClassSession).where(ClassSession.studio_id == studio_id,
                                                   ClassSession.template_id.in_([t.id for t in tpls]),
                                                   ClassSession.status == "scheduled", ClassSession.starts_at > now)).all() if tpls else []
    counts = svc.booked_counts(db, [s.id for s in future])
    out = []
    for t in tpls:
        mine = sorted((s for s in future if s.template_id == t.id), key=lambda s: s.starts_at)
        room, user = rooms.get(t.room_id), users.get(t.instructor_id)
        out.append({
            "id": str(t.id), "name": t.name, "service_id": str(t.service_id) if t.service_id else None,
            "color": t.color, "room_id": str(t.room_id) if t.room_id else None, "room_name": room.name if room else None,
            "instructor_id": str(t.instructor_id) if t.instructor_id else None,
            "instructor_name": (user.display_name or user.email) if user else None,
            "capacity": t.capacity, "weekdays": list(t.weekdays), "start_time": t.start_time.strftime("%H:%M"),
            "duration_minutes": t.duration_minutes, "starts_on": t.starts_on.isoformat(),
            "ends_on": t.ends_on.isoformat() if t.ends_on else None, "sessions_count": t.sessions_count,
            "is_course": courses.is_course(t), "course_price_cents": t.course_price_cents, "is_active": t.is_active,
            "next_session": mine[0].starts_at.isoformat() if mine else None,
            "future_sessions": len(mine), "future_booked_sessions": sum(1 for s in mine if counts.get(s.id)),
            "rules": _template_rules(db, studio_id, t.id),
        })
    return out


@router.get("/templates")
def list_templates(include_stopped: bool = False, ctx: AuthContext = Depends(require_studio_ctx),
                   db: Session = Depends(get_db)):
    q = select(ClassTemplate).where(ClassTemplate.studio_id == ctx.studio_id)
    if not include_stopped:
        q = q.where(ClassTemplate.is_active.is_(True))
    return _templates_out(db, ctx.studio_id, list(db.scalars(q.order_by(ClassTemplate.is_active.desc(), ClassTemplate.name)).all()))


@router.post("/templates")
def create_template(body: TemplateIn, ctx: AuthContext = Depends(require_action("classes.configure")),
                    db: Session = Depends(get_db)):
    values = _resolve(db, ctx.studio_id, body.model_dump(include=set(COLUMNS)))
    spec = svc.Spec(**{f: values[f] for f in SPEC_FIELDS})
    slots = list(svc.upcoming_slots(spec, svc.window_end(db, ctx.studio_id)).values())
    found = svc.clashes(db, ctx.studio_id, slots, room_id=spec.room_id, instructor_id=spec.instructor_id)
    if body.dry_run:
        return {"clashes": found, "sessions": len(slots), "booked": {"sessions": 0, "clients": 0}}
    _refuse_clashes(db, ctx.studio_id, found, body.confirm_clashes)
    tpl = ClassTemplate(studio_id=ctx.studio_id, created_by=ctx.user_id, **values)
    db.add(tpl)
    db.flush()
    _save_rules(db, ctx.studio_id, tpl.id, body.rules, ctx.user_id)
    svc.generate(db, tpl)
    db.commit()
    return _templates_out(db, ctx.studio_id, [tpl])[0]


@router.patch("/templates/{template_id}")
def update_template(template_id: uuid.UUID, body: TemplatePatch,
                    ctx: AuthContext = Depends(require_action("classes.configure")), db: Session = Depends(get_db)):
    tpl = _get(db, ClassTemplate, ctx.studio_id, template_id, "השיעור הקבוע לא נמצא")
    if not tpl.is_active:
        raise HTTPException(400, "השיעור הקבוע הופסק")
    sent = body.model_dump(exclude_unset=True, include=set(COLUMNS))
    values = _resolve(db, ctx.studio_id, {**{c: getattr(tpl, c) for c in COLUMNS}, **sent})
    new = svc.Spec(**{f: values[f] for f in SPEC_FIELDS})
    plan = svc.plan_change(db, tpl, new)
    found = {"room": [], "instructor": []}
    if set(sent) & set(SPEC_FIELDS):
        slots = list(svc.upcoming_slots(new, svc.window_end(db, ctx.studio_id)).values())
        found = svc.clashes(db, ctx.studio_id, slots, room_id=new.room_id, instructor_id=new.instructor_id,
                            skip_template=tpl.id)
    if body.dry_run:
        return {"clashes": found, "booked": plan.booked_summary()}
    _refuse_clashes(db, ctx.studio_id, found, body.confirm_clashes)
    for k, v in values.items():
        setattr(tpl, k, v)
    _save_rules(db, ctx.studio_id, tpl.id, body.rules, ctx.user_id)
    result = svc.apply_change(db, tpl, plan, apply_to_booked=body.apply_to_booked, user_id=ctx.user_id)
    db.commit()
    return {**_templates_out(db, ctx.studio_id, [tpl])[0], "result": result}


class StopIn(BaseModel):
    cancel_booked: bool = False


@router.post("/templates/{template_id}/stop")
def stop_template(template_id: uuid.UUID, body: StopIn, ctx: AuthContext = Depends(require_action("classes.configure")),
                  db: Session = Depends(get_db)):
    tpl = _get(db, ClassTemplate, ctx.studio_id, template_id, "השיעור הקבוע לא נמצא")
    if not tpl.is_active:
        raise HTTPException(400, "השיעור הקבוע כבר הופסק")
    result = svc.stop_template(db, tpl, cancel_booked=body.cancel_booked, user_id=ctx.user_id)
    db.commit()
    return result


# ── the schedule ─────────────────────────────────────────────────────────────

def _sessions_out(db: Session, studio_id, sessions: list[ClassSession], with_clients: bool = False) -> list[dict]:
    tpl_ids = {s.template_id for s in sessions if s.template_id}
    tpls = {t.id: t for t in db.scalars(select(ClassTemplate).where(ClassTemplate.id.in_(tpl_ids))).all()} if tpl_ids else {}
    rooms = {r.id: r for r in db.scalars(select(Room).where(Room.studio_id == studio_id)).all()}
    users = {u.id: u for u in db.scalars(select(User).where(User.studio_id == studio_id)).all()}
    counts = svc.booked_counts(db, [s.id for s in sessions])
    out = []
    for s in sessions:
        t, room, user = tpls.get(s.template_id), rooms.get(s.room_id), users.get(s.instructor_id)
        row = {
            "id": str(s.id), "template_id": str(s.template_id) if s.template_id else None,
            "name": t.name if t else "שיעור", "color": (t.color if t else None) or "#6366f1",
            "is_course": bool(t and courses.is_course(t)),
            "occurs_on": s.occurs_on.isoformat(), "starts_at": s.starts_at.isoformat(), "ends_at": s.ends_at.isoformat(),
            "room_id": str(s.room_id) if s.room_id else None, "room_name": room.name if room else None,
            "instructor_id": str(s.instructor_id) if s.instructor_id else None,
            "instructor_name": (user.display_name or user.email) if user else None,
            "capacity": s.capacity, "booked": counts.get(s.id, 0), "status": s.status, "detached": s.detached,
            "cancel_reason": s.cancel_reason,
        }
        if with_clients:
            # a course is registered for as a whole — a single session only when the owner allows it
            row["course_single_ok"] = not row["is_course"] or bool(courses.rule(db, t, "course_drop_in"))
            from app.services import class_waitlist as wl
            from app.services.penalties import class_price
            row["bookings"] = _bookings_out(db, s.id)
            row["waitlist_enabled"] = wl.enabled(db, s.studio_id)
            row["waitlist"] = [{"id": str(e.id), "client_id": str(e.client_id), "full_name": e.client_name,
                                "position": i, "status": e.status,
                                "offer_expires_at": e.offer_expires_at.isoformat() if e.offer_expires_at else None}
                               for i, e in enumerate(wl.queue(db, s.id), start=1)]
            row["spots_left"] = wl.spots_left(db, s)
            row["price_cents"] = class_price(db, s)            # the class's service price — for a single entry
        out.append(row)
    return out


def _bookings_out(db: Session, session_id) -> list[dict]:
    """Who is on the class list — booked, attended, no-show, and late cancellations (still shown) —
    with the membership that covers each and any fee a rule recorded."""
    from app.models.classes import ClassBooking
    from app.models.client import Client
    from app.models.memberships import Membership
    from app.services import memberships as ms
    from app.services import penalties
    rows = db.execute(select(ClassBooking, Client).join(Client, Client.id == ClassBooking.client_id).where(
        ClassBooking.session_id == session_id, ClassBooking.status != "canceled").order_by(ClassBooking.created_at)).all()
    mids = {b.membership_id for b, _ in rows if b.membership_id}
    members = {m.id: m for m in db.scalars(select(Membership).where(Membership.id.in_(mids))).all()} if mids else {}
    bals = ms.balance(db, [i for i, m in members.items() if m.rules.get("kind") == "punch"])
    fees = penalties.fee_of(db, [b.id for b, _ in rows])
    from app.services.class_payments import paid_for_bookings
    paid = paid_for_bookings(db, [b.id for b, _ in rows if b.drop_in])
    out = []
    for b, c in rows:
        fee = fees.get(b.id)
        out.append({"id": str(b.id), "client_id": str(c.id), "full_name": c.full_name, "phone": c.phone,
                    "status": b.status, "over_capacity": b.over_capacity, "drop_in": b.drop_in, "justified": b.justified,
                    "in_course": b.enrollment_id is not None,                 # booked by a registration for the whole course
                    "self_checkin": b.status == "attended" and b.marked_at is not None and b.marked_by is None,   # scanned at the door
                    "membership": ms.label(members.get(b.membership_id), bals.get(b.membership_id)),
                    "fee": {"id": str(fee.id), "amount_cents": fee.amount_cents, "status": fee.status} if fee else None,
                    "paid_cents": paid.get(b.id, 0)})
    return out


def _aware(moment: datetime) -> datetime:
    """A time without a zone is Israel time."""
    return moment if moment.tzinfo else svc.IL.localize(moment)


@router.get("/sessions")
def list_sessions(start: Optional[datetime] = Query(None), end: Optional[datetime] = Query(None),
                  room_id: Optional[uuid.UUID] = None, template_id: Optional[uuid.UUID] = None,
                  ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    start = _aware(start) if start else svc.now_utc()
    end = _aware(end) if end else start + timedelta(days=7)
    if end - start > timedelta(days=200):      # the calendar's month view asks for ~126 days (with padding)
        raise HTTPException(400, "טווח ארוך מדי (עד 200 יום)")
    q = select(ClassSession).where(ClassSession.studio_id == ctx.studio_id,
                                   ClassSession.starts_at < end, ClassSession.ends_at > start)
    if room_id:
        q = q.where(ClassSession.room_id == room_id)
    if template_id:
        q = q.where(ClassSession.template_id == template_id)
    return _sessions_out(db, ctx.studio_id, list(db.scalars(q.order_by(ClassSession.starts_at)).all()))


@router.get("/sessions/{session_id}")
def get_session(session_id: uuid.UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    s = _get(db, ClassSession, ctx.studio_id, session_id, "השיעור לא נמצא")
    return _sessions_out(db, ctx.studio_id, [s], with_clients=True)[0]


class SessionPatch(BaseModel):
    day: Optional[date] = None             # the new date (Israel), with start_time the new start
    start_time: Optional[time] = None
    duration_minutes: Optional[int] = Field(None, ge=5, le=600)
    room_id: Optional[uuid.UUID] = None
    instructor_id: Optional[uuid.UUID] = None
    capacity: Optional[int] = Field(None, ge=1, le=500)
    dry_run: bool = False
    confirm_clashes: bool = False


def _open_session(db: Session, ctx: AuthContext, session_id) -> ClassSession:
    s = _get(db, ClassSession, ctx.studio_id, session_id, "השיעור לא נמצא")
    if s.status != "scheduled":
        raise HTTPException(400, "השיעור בוטל")
    if s.starts_at <= svc.now_utc():
        raise HTTPException(400, "השיעור כבר התחיל")
    return s


@router.patch("/sessions/{session_id}")
def update_session(session_id: uuid.UUID, body: SessionPatch, ctx: AuthContext = Depends(require_action("sessions.change")),
                   db: Session = Depends(get_db)):
    s = _open_session(db, ctx, session_id)
    sent = body.model_dump(exclude_unset=True, exclude={"dry_run", "confirm_clashes"})
    local = s.starts_at.astimezone(svc.IL)
    day, at = sent.get("day") or local.date(), sent.get("start_time") or local.time().replace(second=0, microsecond=0)
    length = timedelta(minutes=sent["duration_minutes"]) if sent.get("duration_minutes") else s.ends_at - s.starts_at
    starts = svc.at_il(day, at)
    if starts <= svc.now_utc():
        raise HTTPException(400, "המועד החדש כבר עבר")
    room_id = sent.get("room_id", s.room_id)
    instructor_id = sent.get("instructor_id", s.instructor_id)
    capacity = sent.get("capacity", s.capacity)
    if room_id and ("room_id" in sent or "capacity" in sent):
        _check_room(db, ctx.studio_id, room_id, capacity)
    if "instructor_id" in sent:
        _check_instructor(db, ctx.studio_id, instructor_id)
    booked = len(svc.booked_clients(db, s.id))
    if capacity < booked:
        raise HTTPException(400, f"רשומים כבר {booked} — אי אפשר פחות מקומות מזה")
    found = svc.clashes(db, ctx.studio_id, [(starts, starts + length)], room_id=room_id, instructor_id=instructor_id,
                        skip_session=s.id)
    if body.dry_run:
        return {"clashes": found, "booked": {"sessions": 1 if booked else 0, "clients": booked}}
    _refuse_clashes(db, ctx.studio_id, found, body.confirm_clashes)
    messages = svc.change_session(db, s, starts_at=starts, ends_at=starts + length,
                                  room_id=room_id, instructor_id=instructor_id, capacity=capacity)
    db.commit()
    return {**_sessions_out(db, ctx.studio_id, [s])[0], "messages": messages}


class CancelIn(BaseModel):
    reason: Optional[str] = Field(None, max_length=300)
    dry_run: bool = False


@router.post("/sessions/{session_id}/cancel")
def cancel_session(session_id: uuid.UUID, body: CancelIn, ctx: AuthContext = Depends(require_action("sessions.change")),
                   db: Session = Depends(get_db)):
    s = _open_session(db, ctx, session_id)
    if body.dry_run:
        return {"booked": {"sessions": 1, "clients": len(svc.booked_clients(db, s.id))}}
    messages = svc.cancel_session(db, s, user_id=ctx.user_id, reason=(body.reason or "").strip() or None)
    db.commit()
    return {**_sessions_out(db, ctx.studio_id, [s])[0], "messages": messages}


# ── bookings (stage 3) ───────────────────────────────────────────────────────

class BookIn(BaseModel):
    client_id: uuid.UUID
    over_capacity: bool = False        # beyond the spots — owner or manager only, kept on record
    drop_in: bool = False              # a paid single entry instead of a membership


@router.get("/sessions/{session_id}/eligibility")
def booking_eligibility(session_id: uuid.UUID, client_id: uuid.UUID, ctx: AuthContext = Depends(require_studio_ctx),
                        db: Session = Depends(get_db)):
    """What covers this client for this class — shown before booking."""
    from app.models.client import Client
    s = _get(db, ClassSession, ctx.studio_id, session_id, "השיעור לא נמצא")
    client = _get(db, Client, ctx.studio_id, client_id, "הלקוח לא נמצא")
    return bookings.eligibility(db, s, client)


def _booking_error(db: Session, e: Exception):
    from app.services.class_swap import SwapError
    from app.services.class_waitlist import WaitlistError
    from app.services.memberships import MembershipError
    db.rollback()
    if not isinstance(e, (bookings.BookingError, MembershipError, WaitlistError, SwapError)):
        raise e
    raise HTTPException(409 if isinstance(e, bookings.FullError) else 400, str(e))


@router.post("/sessions/{session_id}/bookings")
def book_client(session_id: uuid.UUID, body: BookIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
                db: Session = Depends(get_db)):
    from app.models.client import Client
    s = _get(db, ClassSession, ctx.studio_id, session_id, "השיעור לא נמצא")
    client = _get(db, Client, ctx.studio_id, body.client_id, "הלקוח לא נמצא")
    if body.over_capacity and not may(ctx.role, "limits.override"):
        raise HTTPException(403, "רישום מעל מספר המקומות — רק לבעלים או למנהל")
    try:
        bookings.book(db, s, client, user_id=ctx.user_id, over_capacity_ok=body.over_capacity, drop_in=body.drop_in)
    except ValueError as e:              # BookingError / MembershipError — a message for the staff
        _booking_error(db, e)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [s], with_clients=True)[0]


class BookingCancelIn(BaseModel):
    waive_late: bool = False           # not counted as a late cancellation (e.g. a justified reason)


@router.post("/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: uuid.UUID, body: BookingCancelIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
                   db: Session = Depends(get_db)):
    from app.models.classes import ClassBooking
    b = _get(db, ClassBooking, ctx.studio_id, booking_id, "ההרשמה לא נמצאה")
    try:
        bookings.cancel(db, b, user_id=ctx.user_id, waive_late=body.waive_late)
    except ValueError as e:              # BookingError / MembershipError — a message for the staff
        _booking_error(db, e)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [db.get(ClassSession, b.session_id)], with_clients=True)[0]


class SwapIn(BaseModel):
    session_id: uuid.UUID              # the class to move into


@router.get("/bookings/{booking_id}/swap-options")
def swap_options(booking_id: uuid.UUID, ctx: AuthContext = Depends(require_action("bookings.manage")),
                 db: Session = Depends(get_db)):
    """The classes of the next two weeks this booking could move to (app/services/class_swap.py)."""
    from app.models.classes import ClassBooking
    from app.services import class_swap
    return class_swap.options(db, _get(db, ClassBooking, ctx.studio_id, booking_id, "ההרשמה לא נמצאה"), for_client=False)


@router.post("/bookings/{booking_id}/swap")
def swap_booking(booking_id: uuid.UUID, body: SwapIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
                 db: Session = Depends(get_db)):
    """Moves the booking to another class in one step — the entry and a single entry's payment move with it."""
    from app.models.classes import ClassBooking
    from app.services import class_swap
    b = _get(db, ClassBooking, ctx.studio_id, booking_id, "ההרשמה לא נמצאה")
    target = _get(db, ClassSession, ctx.studio_id, body.session_id, "השיעור לא נמצא")
    try:
        class_swap.swap(db, b, target, user_id=ctx.user_id)
    except ValueError as e:              # SwapError / BookingError / MembershipError — a message for the staff
        _booking_error(db, e)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [db.get(ClassSession, b.session_id)], with_clients=True)[0]


class AttendanceIn(BaseModel):
    status: str                        # attended | no_show | booked (undo)


def _may_mark(ctx: AuthContext, s: ClassSession) -> None:
    """The one giving the service marks attendance in their own classes only."""
    if ctx.role == "artist" and s.instructor_id != ctx.user_id:
        raise HTTPException(403, "אפשר לסמן נוכחות רק בשיעורים שלך")


@router.post("/bookings/{booking_id}/attendance")
def mark_attendance(booking_id: uuid.UUID, body: AttendanceIn, ctx: AuthContext = Depends(require_action("attendance.mark")),
                    db: Session = Depends(get_db)):
    from app.models.classes import ClassBooking
    b = _get(db, ClassBooking, ctx.studio_id, booking_id, "ההרשמה לא נמצאה")
    s = db.get(ClassSession, b.session_id)
    _may_mark(ctx, s)
    try:
        bookings.mark(db, b, body.status, user_id=ctx.user_id)
    except ValueError as e:              # BookingError / MembershipError — a message for the staff
        _booking_error(db, e)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [s], with_clients=True)[0]


class WaitIn(BaseModel):
    client_id: uuid.UUID


@router.post("/sessions/{session_id}/waitlist")
def join_waitlist(session_id: uuid.UUID, body: WaitIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
                  db: Session = Depends(get_db)):
    from app.models.client import Client
    from app.services import class_waitlist as wl
    s = _get(db, ClassSession, ctx.studio_id, session_id, "השיעור לא נמצא")
    client = _get(db, Client, ctx.studio_id, body.client_id, "הלקוח לא נמצא")
    try:
        wl.join(db, s, client)
    except ValueError as e:
        _booking_error(db, e)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [s], with_clients=True)[0]


def _entry(db: Session, ctx: AuthContext, entry_id):
    from app.models.wait_list import WaitListEntry
    e = db.get(WaitListEntry, entry_id)
    if not e or e.studio_id != ctx.studio_id or e.session_id is None:
        raise HTTPException(404, "לא נמצא ברשימת ההמתנה")
    return e


@router.post("/waitlist/{entry_id}/leave")
def leave_waitlist(entry_id: uuid.UUID, ctx: AuthContext = Depends(require_action("bookings.manage")),
                   db: Session = Depends(get_db)):
    from app.services import class_waitlist as wl
    e = _entry(db, ctx, entry_id)
    try:
        wl.leave(db, e)
    except ValueError as err:
        _booking_error(db, err)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [db.get(ClassSession, e.session_id)], with_clients=True)[0]


class MoveIn(BaseModel):
    position: int = Field(ge=1, le=500)


@router.post("/waitlist/{entry_id}/move")
def move_in_waitlist(entry_id: uuid.UUID, body: MoveIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
                     db: Session = Depends(get_db)):
    from app.services import class_waitlist as wl
    e = _entry(db, ctx, entry_id)
    wl.move(db, e, body.position)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [db.get(ClassSession, e.session_id)], with_clients=True)[0]


class ConfirmIn(BaseModel):
    drop_in: bool = False


@router.post("/waitlist/{entry_id}/confirm")
def confirm_waitlist(entry_id: uuid.UUID, body: ConfirmIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
                     db: Session = Depends(get_db)):
    """The staff take an offered spot for the client (a single entry if nothing covers the class)."""
    from app.services import class_waitlist as wl
    e = _entry(db, ctx, entry_id)
    try:
        wl.confirm(db, e, drop_in=body.drop_in, user_id=ctx.user_id)
    except ValueError as err:
        _booking_error(db, err)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [db.get(ClassSession, e.session_id)], with_clients=True)[0]


@router.post("/bookings/{booking_id}/justify")
def justify_booking(booking_id: uuid.UUID, ctx: AuthContext = Depends(require_action("bookings.manage")),
                    db: Session = Depends(get_db)):
    """A late cancellation or a no-show accepted as justified: not counted, no fee, the entry goes back."""
    from app.models.classes import ClassBooking
    b = _get(db, ClassBooking, ctx.studio_id, booking_id, "ההרשמה לא נמצאה")
    try:
        bookings.justify(db, b, user_id=ctx.user_id)
    except ValueError as e:              # BookingError / MembershipError — a message for the staff
        _booking_error(db, e)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [db.get(ClassSession, b.session_id)], with_clients=True)[0]


@router.post("/sessions/{session_id}/attendance")
def mark_all(session_id: uuid.UUID, ctx: AuthContext = Depends(require_action("attendance.mark")),
             db: Session = Depends(get_db)):
    s = _get(db, ClassSession, ctx.studio_id, session_id, "השיעור לא נמצא")
    _may_mark(ctx, s)
    try:
        bookings.mark_all_attended(db, s, user_id=ctx.user_id)
    except ValueError as e:              # BookingError / MembershipError — a message for the staff
        _booking_error(db, e)
    db.commit()
    return _sessions_out(db, ctx.studio_id, [s], with_clients=True)[0]
