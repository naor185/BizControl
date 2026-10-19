"""Reports and alerts — the workers center's stage 4 (the owner, 2026-10-19: "reports, lateness, overtime"). Each
published shift is checked against the clock: on time (a clock-in up to 3 hours before it, or still in from before),
late (a clock-in after the start plus the minutes the owner allows — default 10), not come (the shift ended with no
clock-in). A worker late to a shift: the owner's bell, and a push to the worker ("forgot to clock in?") — once per
shift, unless the owner turned it off. The report for a period, per worker: hours in the schedule and worked, late
arrivals and their minutes, shifts not come to, and the hours over the day's limit the owner set (default 9)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services import schedule as sch

LATE_AFTER = 10                         # minutes after the start that are still on time
OVERTIME_AFTER = 9.0                    # a day's hours over this are overtime (the owner's choice)
EARLY = timedelta(hours=3)              # a clock-in this long before a shift is for it (as nfc_clock.EARLY_WINDOW)
ALERT_FOR = timedelta(hours=2)          # a late alert is sent up to this long after the start


def late_after(settings) -> int:
    v = getattr(settings, "late_after_minutes", None)
    return LATE_AFTER if v is None else int(v)


def overtime_after(settings) -> float:
    v = getattr(settings, "overtime_after_hours", None)
    return OVERTIME_AFTER if v is None else float(v)


def alerts_on(settings) -> bool:
    v = getattr(settings, "late_alert", None)
    return True if v is None else bool(v)


def _hours(s) -> float:
    from app.repositories.staff_repository import paid_start
    return max((s.end_time - paid_start(s)).total_seconds(), 0) / 3600 if s.end_time else 0.0


def check_shifts(db: Session, studio_id, first: datetime, last: datetime, settings, now: datetime | None = None) -> list[dict]:
    """The published shifts starting in [first, last), each with how it went: "upcoming", "waiting" (started, still in
    the allowed minutes), "late_now" (started, no clock-in yet), "on_time", "late" (with minutes), "missed"."""
    from app.models.schedule import ScheduledShift
    from app.models.work_session import WorkSession
    now = now or datetime.now(timezone.utc)
    tz = sch.tz_of(settings)
    grace = timedelta(minutes=late_after(settings))
    shifts = db.scalars(select(ScheduledShift).where(ScheduledShift.studio_id == studio_id, ScheduledShift.starts_at >= first,
                                                     ScheduledShift.starts_at < last).order_by(ScheduledShift.starts_at)).all()
    weeks: dict = {}
    for s in shifts:
        w = sch.week_of(s.starts_at.astimezone(tz).date())
        if w not in weeks:
            weeks[w] = sch.is_published(db, studio_id, w) is not None
    shifts = [s for s in shifts if weeks[sch.week_of(s.starts_at.astimezone(tz).date())]]
    if not shifts:
        return []
    sessions = db.scalars(select(WorkSession).where(
        WorkSession.studio_id == studio_id, WorkSession.user_id.in_({s.user_id for s in shifts}),
        WorkSession.start_time < max(s.ends_at for s in shifts),
        (WorkSession.end_time.is_(None)) | (WorkSession.end_time > first - EARLY))).all()
    out = []
    for s in shifts:
        mine = [w for w in sessions if w.user_id == s.user_id]
        before = any(w.start_time < s.starts_at - EARLY and (w.end_time is None or w.end_time > s.starts_at) for w in mine)
        ins = sorted(w.start_time for w in mine if s.starts_at - EARLY <= w.start_time < s.ends_at)
        clock_in = ins[0] if ins else None
        late_min = 0
        if before or (clock_in is not None and clock_in <= s.starts_at + grace):
            status = "on_time"
        elif clock_in is not None:
            status, late_min = "late", int((clock_in - s.starts_at).total_seconds() // 60)
        elif now < s.starts_at:
            status = "upcoming"
        elif now < s.starts_at + grace:
            status = "waiting"
        elif now < s.ends_at:
            status, late_min = "late_now", int((now - s.starts_at).total_seconds() // 60)
        else:
            status = "missed"
        out.append({"shift": s, "status": status, "late_min": late_min, "clock_in": clock_in})
    return out


def sweep_late(db: Session, now: datetime | None = None) -> int:
    """A worker not clocked in to a published shift once the allowed minutes passed: the owner's bell and a push to the
    worker — once per shift, up to 2 hours after its start, where the owner hasn't turned it off. How many."""
    from app.models.device_token import DeviceToken
    from app.models.message_job import MessageJob
    from app.models.notification import Notification
    from app.models.schedule import ScheduledShift
    from app.models.studio_settings import StudioSettings
    from app.models.user import User
    from app.services import nfc_clock
    now = now or datetime.now(timezone.utc)
    studios = set(db.scalars(select(ScheduledShift.studio_id).where(
        ScheduledShift.starts_at <= now, ScheduledShift.starts_at > now - ALERT_FOR)).all())
    count = 0
    for studio_id in studios:
        settings = db.get(StudioSettings, studio_id)
        if settings is None or not alerts_on(settings) or not nfc_clock.included(db, studio_id):
            continue
        tz = sch.tz_of(settings)
        for c in check_shifts(db, studio_id, now - ALERT_FOR, now, settings, now):
            s = c["shift"]
            key = f"late:{s.id}"
            if c["status"] != "late_now" or db.scalar(select(Notification.id).where(Notification.studio_id == studio_id,
                                                                                     Notification.dedup_key == key)):
                continue
            worker = db.get(User, s.user_id)
            if worker is None or not worker.is_active or worker.role == "owner":
                continue
            at = s.starts_at.astimezone(tz).strftime("%H:%M")
            name = worker.display_name or worker.email
            db.add(Notification(studio_id=studio_id, type="staff_late", title=f"{name} עוד לא החתים/ה כניסה",
                                body=f"המשמרת התחילה ב-{at} ({c['late_min']} דקות)", action_url="/team", dedup_key=key))
            if db.scalar(select(DeviceToken.id).where(DeviceToken.user_id == worker.id, DeviceToken.is_active == True).limit(1)):  # noqa: E712
                db.add(MessageJob(studio_id=studio_id, recipient_user_id=worker.id, channel="push",
                                  subject="המשמרת שלך כבר התחילה", body=f"המשמרת התחילה ב-{at} — שכחת להחתים כניסה?",
                                  deep_link="/my-shifts", reminder_type="late_nudge", dedup_key=f"{key}:worker",
                                  scheduled_at=now, status="pending"))
            db.commit()
            count += 1
    return count


def report(db: Session, studio_id, start: date, end: date, now: datetime | None = None) -> dict:
    """The schedule against the clock from start to end (both days in): per worker and the late / not come shifts."""
    from app.models.studio_settings import StudioSettings
    from app.models.user import User
    from app.models.work_session import WorkSession
    from app.repositories.staff_repository import paid_start
    now = now or datetime.now(timezone.utc)
    settings = db.get(StudioSettings, studio_id)
    tz = sch.tz_of(settings)
    first = tz.localize(datetime(start.year, start.month, start.day))
    last = tz.localize(datetime(end.year, end.month, end.day)) + timedelta(days=1)
    limit = overtime_after(settings)
    rows: dict = {}

    def row(uid):
        return rows.setdefault(uid, {"scheduled": 0.0, "worked": 0.0, "shifts": 0, "late": 0, "late_minutes": 0,
                                     "missed": 0, "overtime": 0.0, "days": {}})
    events = []
    for c in check_shifts(db, studio_id, first, min(last, now), settings, now):
        s, r = c["shift"], row(c["shift"].user_id)
        r["scheduled"] += (s.ends_at - s.starts_at).total_seconds() / 3600
        r["shifts"] += 1
        if c["status"] in ("late", "missed"):
            r["late" if c["status"] == "late" else "missed"] += 1
            r["late_minutes"] += c["late_min"]
            events.append({"user_id": s.user_id, "status": c["status"], "late_min": c["late_min"], "at": s.starts_at,
                           "words": sch.DAY_WORDS[(s.starts_at.astimezone(tz).weekday() + 1) % 7] + " "
                                    + f"{s.starts_at.astimezone(tz):%d/%m %H:%M}–{s.ends_at.astimezone(tz):%H:%M}",
                           "clock_in": c["clock_in"].astimezone(tz).strftime("%H:%M") if c["clock_in"] else None})
    for c in check_shifts(db, studio_id, now, last, settings, now):          # still to come in the period: scheduled only
        s = c["shift"]
        row(s.user_id)["scheduled"] += (s.ends_at - s.starts_at).total_seconds() / 3600
        row(s.user_id)["shifts"] += 1
    for w in db.scalars(select(WorkSession).where(WorkSession.studio_id == studio_id, WorkSession.start_time >= first,
                                                  WorkSession.start_time < last, WorkSession.end_time.is_not(None))).all():
        r, h = row(w.user_id), _hours(w)
        r["worked"] += h
        d = paid_start(w).astimezone(tz).date()
        r["days"][d] = r["days"].get(d, 0.0) + h
    people = {u.id: u for u in db.scalars(select(User).where(User.studio_id == studio_id, User.id.in_(rows.keys()))).all()} if rows else {}
    name = lambda uid: (people[uid].display_name or people[uid].email) if uid in people else "—"
    workers = []
    for uid, r in rows.items():
        if uid in people and people[uid].role == "owner":
            continue
        r["overtime"] = sum(max(h - limit, 0) for h in r.pop("days").values())
        workers.append({"user_id": str(uid), "name": name(uid), **{k: round(v, 2) if isinstance(v, float) else v for k, v in r.items()}})
    workers.sort(key=lambda w: w["name"])
    events.sort(key=lambda e: e["at"], reverse=True)
    return {"start": start.isoformat(), "end": end.isoformat(),
            "settings": {"late_after_minutes": late_after(settings), "late_alert": alerts_on(settings),
                         "overtime_after_hours": limit},
            "workers": workers,
            "events": [{"user_id": str(e["user_id"]), "name": name(e["user_id"]), "status": e["status"], "late_min": e["late_min"],
                        "words": e["words"], "clock_in": e["clock_in"]} for e in events[:100]]}
