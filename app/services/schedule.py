"""The shift schedule — the workers center's stage 2 (the owner, 2026-10-19: "a shift schedule, the workers send
constraints"). The owner (or a manager allowed the team) plans the shifts of a week (Sunday to Saturday), copies the week
before, and publishes it: each worker with shifts hears of them (a push, or a WhatsApp without the app). Workers see a
week once it's published — their own shifts (app/my-shifts) — and send their constraints for a coming week until the
deadline the owner set (default: Thursday 20:00 before it). A clock-in up to 3 hours before the worker's own shift that
day counts from the shift's start (services/nfc_clock.paid_from)."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import pytz
from sqlalchemy import select
from sqlalchemy.orm import Session

DEFAULT_TEMPLATES = [{"name": "בוקר", "start": "08:00", "end": "14:00"}, {"name": "ערב", "start": "14:00", "end": "20:00"}]
KINDS = ("off", "morning", "evening")
DAY_WORDS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"]          # Sunday first


def tz_of(settings):
    return pytz.timezone(getattr(settings, "timezone", None) or "Asia/Jerusalem")


def week_of(d: date) -> date:
    """The Sunday that starts d's week."""
    return d - timedelta(days=(d.weekday() + 1) % 7)


def templates(settings) -> list[dict]:
    try:
        saved = json.loads(getattr(settings, "shift_templates", None) or "null")
    except ValueError:
        saved = None
    return saved if isinstance(saved, list) and saved else list(DEFAULT_TEMPLATES)


def deadline(settings, week_start: date) -> datetime:
    """Until when constraints for the week starting week_start are sent: the deadline day (0 = Sunday) at its hour, in
    the week before."""
    tz = tz_of(settings)
    day = getattr(settings, "constraints_deadline_day", None)
    day = 4 if day is None else int(day)                    # Thursday
    hh, mm = (int(x) for x in (getattr(settings, "constraints_deadline_hour", None) or "20:00").split(":")[:2])
    d = week_start - timedelta(days=7) + timedelta(days=day)
    return tz.localize(datetime(d.year, d.month, d.day, hh, mm))


def at_local(settings, d: date, hhmm: str) -> datetime:
    hh, mm = (int(x) for x in hhmm.split(":")[:2])
    return tz_of(settings).localize(datetime(d.year, d.month, d.day, hh, mm)).astimezone(timezone.utc)


def is_published(db: Session, studio_id, week_start: date):
    from app.models.schedule import ScheduleWeek
    return db.scalar(select(ScheduleWeek).where(ScheduleWeek.studio_id == studio_id, ScheduleWeek.week_start == week_start))


def shift_start_for(db: Session, studio_id, user_id, at: datetime, settings) -> datetime | None:
    """The start of the worker's published shift that a clock-in at `at` is early for (up to 3 hours before it)."""
    from app.models.schedule import ScheduledShift
    s = db.scalar(select(ScheduledShift).where(
        ScheduledShift.studio_id == studio_id, ScheduledShift.user_id == user_id,
        ScheduledShift.starts_at > at, ScheduledShift.starts_at <= at + timedelta(hours=3)).order_by(ScheduledShift.starts_at))
    if s is None:
        return None
    return s.starts_at if is_published(db, studio_id, week_of(s.starts_at.astimezone(tz_of(settings)).date())) else None


def has_shift_today(db: Session, studio_id, user_id, at: datetime, settings) -> bool:
    """A published shift of the worker's that started already today — the clock-in counts as it is (on time or late)."""
    from app.models.schedule import ScheduledShift
    local = at.astimezone(tz_of(settings))
    start = tz_of(settings).localize(datetime(local.year, local.month, local.day))
    s = db.scalar(select(ScheduledShift.id).where(
        ScheduledShift.studio_id == studio_id, ScheduledShift.user_id == user_id,
        ScheduledShift.starts_at >= start, ScheduledShift.starts_at <= at).limit(1))
    return s is not None and is_published(db, studio_id, week_of(local.date())) is not None


def publish(db: Session, studio_id, week_start: date, by) -> int:
    """The week is published — each worker with shifts in it hears of them. How many heard."""
    from app.models.schedule import ScheduledShift, ScheduleWeek
    from app.models.studio_settings import StudioSettings
    from app.models.user import User
    from app.services.team_tasks import _to_worker
    settings = db.get(StudioSettings, studio_id)
    tz = tz_of(settings)
    now = datetime.now(timezone.utc)
    week = is_published(db, studio_id, week_start)
    if week is None:
        week = ScheduleWeek(studio_id=studio_id, week_start=week_start, published_by=by)
        db.add(week)
    week.published_at, week.published_by = now, by
    db.commit()
    start = tz.localize(datetime(week_start.year, week_start.month, week_start.day))
    shifts = db.scalars(select(ScheduledShift).where(ScheduledShift.studio_id == studio_id, ScheduledShift.starts_at >= start,
                                                     ScheduledShift.starts_at < start + timedelta(days=7))
                        .order_by(ScheduledShift.starts_at)).all()
    by_worker: dict = {}
    for s in shifts:
        by_worker.setdefault(s.user_id, []).append(s)
    told = 0
    for uid, mine in by_worker.items():
        worker = db.get(User, uid)
        if worker is None or not worker.is_active or worker.role == "owner":
            continue
        lines = ", ".join(f"{DAY_WORDS[(s.starts_at.astimezone(tz).weekday() + 1) % 7]} "
                          f"{s.starts_at.astimezone(tz):%H:%M}–{s.ends_at.astimezone(tz):%H:%M}" for s in mine)
        if _to_worker(db, studio_id, worker, f"הסידור לשבוע {week_start:%d/%m}", f"המשמרות שלך: {lines}",
                      "schedule_published", f"schedule:{week_start}:{uid}:{now:%Y%m%d%H%M%S}", link="/my-shifts"):
            told += 1
    return told
