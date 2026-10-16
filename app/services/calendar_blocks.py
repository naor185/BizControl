"""A task with hours locks the calendar (the owner, 2026-10-15: "anything that isn't an appointment — a break, a meeting,
a task — no appointment can be booked over it"): the calendar of the person it's for, or — a task for the whole team —
everyone's. Clients booking themselves (BizControl's page, BizFind) aren't offered those times, and the staff can't set
or move an appointment onto them. The task's switch (tasks.blocks_booking) takes the lock off; a task without hours
(a reminder for the day) locks nothing."""
from __future__ import annotations

import uuid as _uuid
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.task import Task

DEFAULT_TZ = "Asia/Jerusalem"


def _hm(value: str | None) -> time | None:
    try:
        h, m = (int(x) for x in (value or "").split(":")[:2])
        return time(h, m)
    except (ValueError, TypeError):
        return None


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def studio_tz(db: Session, studio_id) -> str:
    from app.models.studio_settings import StudioSettings
    settings = db.get(StudioSettings, studio_id)
    return (getattr(settings, "timezone", None) or DEFAULT_TZ) if settings else DEFAULT_TZ


def blocks(db: Session, studio_id, start: datetime, end: datetime, artist_id=None,
           tz_name: str | None = None) -> list[tuple[datetime, datetime, Task]]:
    """The locked times that touch start–end — (from, to, task), in UTC. With artist_id: that person's (their tasks and
    the whole team's); without: any."""
    q = select(Task).where(Task.studio_id == studio_id, Task.blocks_booking.is_(True),
                           Task.start_time.isnot(None), Task.end_time.isnot(None))
    if artist_id:
        aid = artist_id if isinstance(artist_id, _uuid.UUID) else _uuid.UUID(str(artist_id))
        q = q.where(or_(Task.assignee_id.is_(None), Task.assignee_id == aid))
    tasks = db.scalars(q).all()
    if not tasks:
        return []

    from app.api.task_routes import _expand_tasks      # the one place a task's repeats are worked out
    tz = ZoneInfo(tz_name or studio_tz(db, studio_id))
    start, end = _utc(start), _utc(end)
    by_id = {str(t.id): t for t in tasks}
    out: list[tuple[datetime, datetime, Task]] = []
    for inst in _expand_tasks(tasks, start.astimezone(tz).date(), end.astimezone(tz).date()):
        a, b = _hm(inst.start_time), _hm(inst.end_time)
        if not a or not b or b <= a:
            continue
        day = date.fromisoformat(inst.date)
        s = datetime.combine(day, a, tzinfo=tz).astimezone(timezone.utc)
        e = datetime.combine(day, b, tzinfo=tz).astimezone(timezone.utc)
        if s < end and e > start:
            out.append((s, e, by_id[inst.id]))
    return out


def busy_times(db: Session, studio_id, start: datetime, end: datetime, artist_id=None,
               tz_name: str | None = None) -> list[tuple[datetime, datetime]]:
    """The locked times as (from, to) in UTC — for the free slots (services/booking_availability)."""
    return [(s, e) for s, e, _ in blocks(db, studio_id, start, end, artist_id, tz_name)]


def conflict(db: Session, studio_id, artist_id, starts: datetime, ends: datetime) -> tuple[datetime, datetime, Task] | None:
    """The lock an appointment for starts–ends would fall on, if any."""
    starts, ends = _utc(starts), _utc(ends)
    return next(((s, e, t) for s, e, t in blocks(db, studio_id, starts, ends, artist_id) if starts < e and ends > s), None)


def explain(db: Session, studio_id, hit: tuple[datetime, datetime, Task]) -> str:
    """In the staff's words: whose calendar, when, and what locks it."""
    from app.models.user import User
    s, e, task = hit
    tz = ZoneInfo(studio_tz(db, studio_id))
    who = db.get(User, task.assignee_id) if task.assignee_id else None
    whose = f"של {who.display_name or who.email}" if who else "של כל הצוות"
    hours = f"{s.astimezone(tz):%H:%M}–{e.astimezone(tz):%H:%M}"
    return f"היומן {whose} נעול בשעות {hours}: \"{task.title}\". אפשר לבטל את הנעילה במשימה."
