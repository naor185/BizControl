"""
Times the business owner is busy in their Google Calendar (owner, 2026-10-10): a private event there — a dentist at
14:00 — blocks that time in online booking (BizControl's booking page and BizFind), in the slots offered and again
when a booking is sent. The connection is the business's (studio_settings.google_calendar_*), made by its owner,
so it blocks the owner's appointments — and any time when no one in particular is asked for — never another staff
member's. Not blocking: an event marked "free" in Google (birthdays, holidays — transparency 'transparent') and the
business's own appointments already sent to Google (they're busy in their own right). Fetched at most every
CACHE_SECONDS per business and range; Google not answering → nothing is blocked.
"""
from __future__ import annotations

import time as _time
import uuid as _uuid
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.utils.google_calendar import get_google_calendar_service, list_google_events

CACHE_SECONDS = 120
_cache: dict[tuple, tuple[float, list]] = {}


def _owner_or_anyone(db: Session, studio_id, artist_id) -> bool:
    if not artist_id:
        return True
    from app.models.user import User
    try:
        user = db.get(User, artist_id if isinstance(artist_id, _uuid.UUID) else _uuid.UUID(str(artist_id)))
    except ValueError:
        return False
    return user is not None and user.studio_id == studio_id and user.role == "owner"


def _events(settings, start: datetime, end: datetime) -> list:
    key = (str(settings.studio_id), start.isoformat(), end.isoformat())
    hit = _cache.get(key)
    if hit and _time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    try:
        service = get_google_calendar_service(settings.google_calendar_client_id, settings.google_calendar_client_secret,
                                              settings.google_calendar_refresh_token)
        events = list_google_events(service, start, end)
    except Exception:
        events = []
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = (_time.monotonic(), events)
    return events


def busy_times(db: Session, studio_id, start: datetime, end: datetime, artist_id=None) -> list[tuple[datetime, datetime]]:
    """The owner's busy times in Google between start and end — (start, end) in UTC."""
    from dateutil.parser import isoparse
    from app.models.appointment import Appointment
    from app.models.studio_settings import StudioSettings

    if not _owner_or_anyone(db, studio_id, artist_id):
        return []
    settings = db.scalar(select(StudioSettings).where(StudioSettings.studio_id == studio_id))
    if not (settings and settings.google_calendar_refresh_token and settings.google_calendar_client_id
            and settings.google_calendar_client_secret):
        return []
    events = _events(settings, start, end)
    if not events:
        return []
    ours = set(db.scalars(select(Appointment.google_event_id).where(
        Appointment.studio_id == studio_id, Appointment.google_event_id.isnot(None))).all())
    tz = ZoneInfo(settings.timezone or "Asia/Jerusalem")
    out = []
    for e in events:
        if e.get("transparency") == "transparent" or e.get("status") == "cancelled" or e.get("id") in ours:
            continue
        s, f = e.get("start") or {}, e.get("end") or {}
        if s.get("dateTime") and f.get("dateTime"):
            a, b = isoparse(s["dateTime"]), isoparse(f["dateTime"])
            a = a if a.tzinfo else a.replace(tzinfo=timezone.utc)
            b = b if b.tzinfo else b.replace(tzinfo=timezone.utc)
        elif s.get("date") and f.get("date"):                       # a whole day marked busy — the business's days
            a = datetime.combine(date.fromisoformat(s["date"]), time(0), tzinfo=tz)
            b = datetime.combine(date.fromisoformat(f["date"]), time(0), tzinfo=tz)
        else:
            continue
        out.append((a.astimezone(timezone.utc), b.astimezone(timezone.utc)))
    return out


def conflicts(db: Session, studio_id, artist_id, starts: datetime, ends: datetime) -> bool:
    """A booking for starts–ends falls on a time the owner is busy in Google."""
    starts = starts if starts.tzinfo else starts.replace(tzinfo=timezone.utc)
    ends = ends if ends.tzinfo else ends.replace(tzinfo=timezone.utc)
    return any(starts < b and ends > a for a, b in busy_times(db, studio_id, starts, ends, artist_id))
