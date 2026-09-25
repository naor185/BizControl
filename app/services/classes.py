"""
Group classes — the schedule made from class templates, clash checks, and changing or cancelling one
session (app/models/classes.py has the tables).

- The schedule: every active template gets its sessions weeks_ahead weeks ahead (the owner's setting,
  default 8), on its weekdays at its time in Israel time — a class at 18:00 stays at 18:00 when the
  clocks change. A nightly job keeps the window full; creating or changing a template fills it at once.
  One session per template and date (a unique key), so running it twice adds nothing.
- A template change reaches future sessions only. A session nobody is booked into simply follows the
  template; a session with bookings changes only when the owner says so (apply_to_booked) — and then
  every booked client gets a message. Otherwise it keeps its old details and the template no longer
  touches it (detached), like a session changed on its own.
- Clashes: a room cannot hold two classes at once (refused). An instructor in two classes, or in a class
  and one of their own appointments, is a warning the owner confirms.
- Every message goes through app/services/notifications.notify — never straight to the queue.
"""
from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass, fields, replace
from datetime import date, datetime, time, timedelta, timezone

import pytz
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession, ClassTemplate, Room
from app.services import notifications, policies

IL = pytz.timezone("Asia/Jerusalem")
BOOKED = "booked"          # still coming — the people a change or cancellation must reach
HOLDS_SPOT = ("booked", "attended", "no_show")     # the bookings that take one of the session's spots


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_il() -> date:
    return now_utc().astimezone(IL).date()


def js_weekday(d: date) -> int:
    """0 = Sunday … 6 = Saturday (the Israeli week, and JavaScript's getDay())."""
    return (d.weekday() + 1) % 7


def at_il(d: date, t: time) -> datetime:
    """The moment (UTC) of a date and time on the clock in Israel."""
    return IL.normalize(IL.localize(datetime.combine(d, t), is_dst=False)).astimezone(timezone.utc)


def il_date_time(moment: datetime) -> tuple[str, str]:
    local = moment.astimezone(IL)
    return f"{local.day}/{local.month}", local.strftime("%H:%M")


# ── what a template means ────────────────────────────────────────────────────

@dataclass(frozen=True)
class Spec:
    """The parts of a template the schedule depends on — for a saved template or a proposed change."""
    weekdays: tuple[int, ...]
    start_time: time
    duration_minutes: int
    starts_on: date
    ends_on: date | None
    sessions_count: int | None
    room_id: uuid.UUID | None
    instructor_id: uuid.UUID | None
    capacity: int

    @classmethod
    def of(cls, tpl: ClassTemplate) -> "Spec":
        return cls(**{f.name: (tuple(tpl.weekdays) if f.name == "weekdays" else getattr(tpl, f.name)) for f in fields(cls)})

    def changed(self, **values) -> "Spec":
        known = {f.name for f in fields(self)}
        values = {k: (tuple(v) if k == "weekdays" else v) for k, v in values.items() if k in known}
        return replace(self, **values)


def template_dates(spec: Spec, until: date) -> list[date]:
    """Every date the template runs on, from its first date to `until` — and to its end, for a course."""
    end = min(until, spec.ends_on) if spec.ends_on else until
    days, out, d = set(spec.weekdays), [], spec.starts_on
    while d <= end:
        if js_weekday(d) in days:
            out.append(d)
            if spec.sessions_count and len(out) >= spec.sessions_count:
                break
        d += timedelta(days=1)
    return out


def slot(spec: Spec, d: date) -> tuple[datetime, datetime]:
    start = at_il(d, spec.start_time)
    return start, start + timedelta(minutes=spec.duration_minutes)


def window_end(db: Session, studio_id) -> date:
    return today_il() + timedelta(weeks=policies.get_policy(db, studio_id, "weeks_ahead"))


def upcoming_slots(spec: Spec, until: date) -> dict[date, tuple[datetime, datetime]]:
    now = now_utc()
    out = {d: slot(spec, d) for d in template_dates(spec, until)}
    return {d: s for d, s in out.items() if s[0] > now}


# ── the schedule ─────────────────────────────────────────────────────────────

def generate(db: Session, tpl: ClassTemplate) -> int:
    """Adds the template's missing sessions up to the business's window. Returns how many were added."""
    if not tpl.is_active:
        return 0
    spec = Spec.of(tpl)
    rows = [dict(id=uuid.uuid4(), studio_id=tpl.studio_id, template_id=tpl.id, occurs_on=d, starts_at=s, ends_at=e,
                 room_id=tpl.room_id, instructor_id=tpl.instructor_id, capacity=tpl.capacity,
                 status="scheduled", detached=False, source="system")
            for d, (s, e) in upcoming_slots(spec, window_end(db, tpl.studio_id)).items()]
    if not rows:
        return 0
    res = db.execute(insert(ClassSession).values(rows)
                     .on_conflict_do_nothing(index_elements=["template_id", "occurs_on"]))
    return res.rowcount or 0


def classes_on(db: Session, studio_id, cache: dict) -> bool:
    """Is the classes module on for this business — for the background jobs (cached per run)."""
    if studio_id not in cache:
        from app.core.features import is_module_enabled
        from app.models.studio import Studio
        st = db.get(Studio, studio_id)
        cache[studio_id] = bool(st) and is_module_enabled(db, st.id, st.subscription_plan or "free", "classes")
    return cache[studio_id]


def generate_all(db: Session) -> int:
    """The nightly job: every active template of every business whose classes module is on."""
    on: dict = {}
    added = 0
    for tpl in db.scalars(select(ClassTemplate).where(ClassTemplate.is_active.is_(True))).all():
        if classes_on(db, tpl.studio_id, on):
            added += generate(db, tpl)
            db.commit()
    return added


# ── clashes ──────────────────────────────────────────────────────────────────

def clashes(db: Session, studio_id, slots: list[tuple[datetime, datetime]], *, room_id=None, instructor_id=None,
            skip_template=None, skip_session=None) -> dict[str, list[dict]]:
    """What the proposed times collide with: {"room": [...], "instructor": [...]} — each item is the other
    class or appointment ({kind, name, starts_at})."""
    out: dict[str, list[dict]] = {"room": [], "instructor": []}
    if not slots or (room_id is None and instructor_id is None):
        return out
    lo, hi = min(s for s, _ in slots), max(e for _, e in slots)
    same = []
    if room_id:
        same.append(ClassSession.room_id == room_id)
    if instructor_id:
        same.append(ClassSession.instructor_id == instructor_id)
    q = (select(ClassSession, ClassTemplate.name)
         .outerjoin(ClassTemplate, ClassTemplate.id == ClassSession.template_id)
         .where(ClassSession.studio_id == studio_id, ClassSession.status == "scheduled",
                ClassSession.starts_at < hi, ClassSession.ends_at > lo, or_(*same)))
    if skip_template is not None:
        q = q.where(or_(ClassSession.template_id.is_(None), ClassSession.template_id != skip_template))
    if skip_session is not None:
        q = q.where(ClassSession.id != skip_session)
    others = [(s.starts_at, s.ends_at, s.room_id, s.instructor_id, name or "שיעור") for s, name in db.execute(q).all()]
    appts = []
    if instructor_id:
        from app.models.appointment import Appointment
        appts = db.execute(select(Appointment.starts_at, Appointment.ends_at, Appointment.title).where(
            Appointment.studio_id == studio_id, Appointment.artist_id == instructor_id,
            Appointment.status != "canceled", Appointment.starts_at < hi, Appointment.ends_at > lo)).all()
    seen = set()
    for start, end in slots:
        for o_start, o_end, o_room, o_instr, name in others:
            if o_start < end and o_end > start:
                for kind, hit in (("room", room_id and o_room == room_id), ("instructor", instructor_id and o_instr == instructor_id)):
                    if hit and (kind, o_start) not in seen:
                        seen.add((kind, o_start))
                        out[kind].append({"kind": "class", "name": name, "starts_at": o_start.isoformat()})
        for a_start, a_end, title in appts:
            if a_start < end and a_end > start and ("appt", a_start) not in seen:
                seen.add(("appt", a_start))
                out["instructor"].append({"kind": "appointment", "name": title or "תור", "starts_at": a_start.isoformat()})
    for items in out.values():
        items.sort(key=lambda i: i["starts_at"])
    return out


def clash_text(item: dict) -> str:
    d, t = il_date_time(datetime.fromisoformat(item["starts_at"]))
    return f"{item['name']} — {d} {t}"


# ── one session: who is booked, change, cancel ───────────────────────────────

def booked_clients(db: Session, session_id) -> list:
    from app.models.client import Client
    return list(db.scalars(select(Client).join(ClassBooking, ClassBooking.client_id == Client.id).where(
        ClassBooking.session_id == session_id, ClassBooking.status == BOOKED)).all())


def booked_counts(db: Session, session_ids) -> dict:
    if not session_ids:
        return {}
    rows = db.execute(select(ClassBooking.session_id, func.count()).where(
        ClassBooking.session_id.in_(list(session_ids)), ClassBooking.status.in_(HOLDS_SPOT)).group_by(ClassBooking.session_id)).all()
    return dict(rows)


def session_name(db: Session, s: ClassSession) -> str:
    tpl = db.get(ClassTemplate, s.template_id) if s.template_id else None
    return tpl.name if tpl else "שיעור"


def _context(db: Session, s: ClassSession) -> dict:
    d, t = il_date_time(s.starts_at)
    return {"class_name": session_name(db, s), "class_date": d, "class_time": t}


def cancel_session(db: Session, s: ClassSession, *, user_id=None, reason: str | None = None,
                   origin: str = "user", note: str = "השיעור בוטל.", automatic: bool = False) -> int:
    """Cancels one session: its bookings end and every booked client gets a message (always on) —
    "class_changed", or "class_auto_cancel" when the minimum-participants check cancels it
    (automatic). Returns how many messages were queued."""
    if s.status != "scheduled":
        raise ValueError("השיעור כבר בוטל")
    from app.services import memberships as ms
    ctx, clients = _context(db, s), booked_clients(db, s.id)
    now = now_utc()
    s.status = "auto_canceled" if automatic else "canceled"
    s.canceled_at, s.canceled_by, s.cancel_reason = now, user_id, (reason or None)
    text_ = f"{note} {reason}".strip() if reason else note
    notes = {}                  # each client hears what happened to their own entry
    for b in db.scalars(select(ClassBooking).where(ClassBooking.session_id == s.id, ClassBooking.status == BOOKED)).all():
        b.status, b.canceled_at, b.cancel_reason = "canceled", now, "session_canceled"
        ms.settle(db, b, "return", reason="השיעור בוטל", user_id=user_id)
        entry = ms.entry_note(db, b)
        notes[b.client_id] = {"entry_note": entry, "change_note": f"{text_} {entry}".strip()}
    db.flush()
    return notifications.notify(db, s.studio_id, "class_auto_cancel" if automatic else "class_changed", origin=origin,
                                about=f"session:{s.id}:canceled", context={**ctx, "change_note": text_, "entry_note": ""},
                                clients=clients, per_client=notes)


def change_session(db: Session, s: ClassSession, *, starts_at: datetime | None = None, ends_at: datetime | None = None,
                   room_id=..., instructor_id=..., capacity: int | None = None, origin: str = "user",
                   detach: bool = True) -> int:
    """Changes one session's time, room, instructor or spots. Booked clients hear about what concerns
    them (time, room, instructor). `...` = unchanged. Returns how many messages were queued."""
    if s.status != "scheduled":
        raise ValueError("אפשר לשנות רק שיעור שלא בוטל")
    from app.models.user import User
    from app.services.business_types import studio_terms
    ctx = _context(db, s)                      # the details the clients know
    lines = []
    if starts_at is not None and starts_at != s.starts_at:
        length = (ends_at - starts_at) if ends_at is not None else (s.ends_at - s.starts_at)
        s.starts_at, s.ends_at = starts_at, starts_at + length
        d, t = il_date_time(starts_at)
        lines.append(f"מועד חדש: {d} בשעה {t}")
    elif ends_at is not None and ends_at != s.ends_at:
        s.ends_at = ends_at
        lines.append(f"שעת סיום חדשה: {il_date_time(ends_at)[1]}")
    if room_id is not ... and room_id != s.room_id:
        s.room_id = room_id
        room = db.get(Room, room_id) if room_id else None
        if room:
            lines.append(f"חדר: {room.name}")
    if instructor_id is not ... and instructor_id != s.instructor_id:
        s.instructor_id = instructor_id
        user = db.get(User, instructor_id) if instructor_id else None
        if user:
            lines.append(f"{studio_terms(db, s.studio_id)['staff']}: {user.display_name or user.email}")
    if capacity is not None and capacity != s.capacity:
        s.capacity = capacity
    if detach:
        s.detached = True
    db.flush()
    if not lines:
        return 0
    note = "\n".join(lines)
    return notifications.notify(db, s.studio_id, "class_changed", origin=origin,
                                about=f"session:{s.id}:change:{hashlib.sha1(note.encode()).hexdigest()[:10]}",
                                context={**ctx, "change_note": note}, clients=booked_clients(db, s.id))


# ── a template change reaching the schedule ──────────────────────────────────

@dataclass
class Plan:
    """What a template change does to future sessions."""
    update_free: list          # (session, start, end) — nobody booked: just follows the template
    remove_free: list          # sessions — nobody booked, their date left the template
    update_booked: list        # (session, start, end, clients)
    remove_booked: list        # (session, clients)

    def booked_summary(self) -> dict:
        sessions = len(self.update_booked) + len(self.remove_booked)
        clients = {c.id for *_, cs in self.update_booked for c in cs} | {c.id for _, cs in self.remove_booked for c in cs}
        return {"sessions": sessions, "clients": len(clients)}


def plan_change(db: Session, tpl: ClassTemplate, new: Spec) -> Plan:
    future = db.scalars(select(ClassSession).where(
        ClassSession.template_id == tpl.id, ClassSession.status == "scheduled",
        ClassSession.detached.is_(False), ClassSession.starts_at > now_utc())).all()
    last = max([s.occurs_on for s in future] + [window_end(db, tpl.studio_id)])
    wanted = set(template_dates(new, last))
    plan = Plan([], [], [], [])
    for s in future:
        clients = booked_clients(db, s.id)
        if s.occurs_on not in wanted:
            (plan.remove_booked.append((s, clients)) if clients else plan.remove_free.append(s))
            continue
        start, end = slot(new, s.occurs_on)
        if (start == s.starts_at and end == s.ends_at and s.room_id == new.room_id
                and s.instructor_id == new.instructor_id and s.capacity == new.capacity):
            continue
        (plan.update_booked.append((s, start, end, clients)) if clients else plan.update_free.append((s, start, end)))
    return plan


def apply_change(db: Session, tpl: ClassTemplate, plan: Plan, *, apply_to_booked: bool, user_id=None) -> dict:
    """Carries out plan_change() on the saved template. Booked sessions change (with a message) only when
    apply_to_booked; otherwise they keep their details and leave the template (detached)."""
    for s, start, end in plan.update_free:
        s.starts_at, s.ends_at, s.room_id, s.instructor_id, s.capacity = start, end, tpl.room_id, tpl.instructor_id, tpl.capacity
    for s in plan.remove_free:
        db.delete(s)
    messages = 0
    for s, start, end, _ in plan.update_booked:
        if apply_to_booked:
            messages += change_session(db, s, starts_at=start, ends_at=end, room_id=tpl.room_id,
                                       instructor_id=tpl.instructor_id, capacity=tpl.capacity, detach=False)
        else:
            s.detached = True
    for s, _ in plan.remove_booked:
        if apply_to_booked:
            messages += cancel_session(db, s, user_id=user_id, note="השיעור הוסר מהלוח.")
        else:
            s.detached = True
    db.flush()
    added = generate(db, tpl)
    return {"updated": len(plan.update_free) + (len(plan.update_booked) if apply_to_booked else 0),
            "removed": len(plan.remove_free) + (len(plan.remove_booked) if apply_to_booked else 0),
            "kept": 0 if apply_to_booked else len(plan.update_booked) + len(plan.remove_booked),
            "added": added, "messages": messages}


def stop_template(db: Session, tpl: ClassTemplate, *, cancel_booked: bool, user_id=None) -> dict:
    """Stops a template: no new sessions; future sessions nobody booked are removed; booked ones are
    cancelled with a message (cancel_booked) or stay on the schedule."""
    tpl.is_active = False
    removed = canceled = kept = messages = 0
    for s in db.scalars(select(ClassSession).where(ClassSession.template_id == tpl.id, ClassSession.status == "scheduled",
                                                   ClassSession.starts_at > now_utc())).all():
        if not booked_clients(db, s.id):
            db.delete(s)
            removed += 1
        elif cancel_booked:
            messages += cancel_session(db, s, user_id=user_id, note="השיעור הוסר מהלוח.")
            canceled += 1
        else:
            kept += 1
    db.flush()
    return {"removed": removed, "canceled": canceled, "kept": kept, "messages": messages}
