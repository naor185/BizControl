"""
Shared slot-availability computation for both public booking engines —
BizControl's own instant-book page (app/api/booking_routes.py) and BizFind's
request-and-approve flow (app/api/public_routes.py). Extracted from the
former (already correct: timezone-aware, service-duration-aware) so the
latter, which had reimplemented a second, simpler version that ignored the
service entirely and read appointment hour/minute in whatever timezone the
DB driver handed back, can't silently disagree with it about what's
actually free.
"""
from __future__ import annotations

import uuid as _uuid
from datetime import date as _date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.appointment import Appointment


def compute_available_slots(
    db: Session,
    studio_id,
    tz_str: str,
    start_hour: int,
    end_hour: int,
    slot_duration_minutes: int,
    target_date: _date,
    artist_id: str | None = None,
) -> list[tuple[str, datetime, datetime]]:
    """Every open slot of `slot_duration_minutes` on `target_date`, within
    the studio's local [start_hour, end_hour) window, excluding anything
    overlapping an existing non-canceled appointment (optionally scoped to
    one artist). Returns (local "HH:MM" label, starts_at UTC, ends_at UTC)."""
    try:
        tz = ZoneInfo(tz_str)
    except Exception:
        import pytz
        tz = pytz.timezone(tz_str)

    slot_step = min(slot_duration_minutes, 30)  # step by 30min or less

    day_start = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    existing_q = select(Appointment).where(
        Appointment.studio_id == studio_id,
        Appointment.status.in_(["scheduled", "done"]),
        Appointment.starts_at >= day_start.astimezone(timezone.utc),
        Appointment.starts_at < day_end.astimezone(timezone.utc),
    )
    if artist_id:
        aid = artist_id if isinstance(artist_id, _uuid.UUID) else _uuid.UUID(str(artist_id))
        existing_q = existing_q.where(Appointment.artist_id == aid)
    existing = db.scalars(existing_q).all()

    busy: list[tuple[datetime, datetime]] = [
        (a.starts_at.replace(tzinfo=timezone.utc), a.ends_at.replace(tzinfo=timezone.utc))
        for a in existing
        if a.ends_at
    ]

    slots: list[tuple[str, datetime, datetime]] = []
    current = datetime(target_date.year, target_date.month, target_date.day,
                        start_hour, 0, 0, tzinfo=tz).astimezone(timezone.utc)
    end_time = datetime(target_date.year, target_date.month, target_date.day,
                         end_hour, 0, 0, tzinfo=tz).astimezone(timezone.utc)

    while current + timedelta(minutes=slot_duration_minutes) <= end_time:
        slot_end = current + timedelta(minutes=slot_duration_minutes)
        is_free = all(slot_end <= b_start or current >= b_end for b_start, b_end in busy)
        if is_free:
            local_time = current.astimezone(tz)
            slots.append((local_time.strftime("%H:%M"), current, slot_end))
        current += timedelta(minutes=slot_step)

    return slots
