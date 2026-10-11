"""The owner's busy times in Google Calendar block online booking (owner, 2026-10-10) — the slots offered and the
booking itself; only the owner's (or no one in particular); an event marked "free" and a whole free day don't.
Google is faked — nothing is called."""
from datetime import date, datetime, timezone

from sqlalchemy import select

import app.services.google_busy as gb
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services.booking_availability import compute_available_slots
from tests.conftest import register_and_login

DAY = date(2026, 11, 3)                                       # winter — Israel is UTC+2


def test_a_busy_google_event_blocks_the_owners_online_booking(client, db_session, monkeypatch):
    h = register_and_login(client, slug="g-shop", email="owner@g-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "g-shop"))
    owner = db_session.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
    artist = client.post("/api/users/artists", headers=h, json={"email": "dor@g-shop.com", "password": "secret123",
                                                                "display_name": "דור", "role": "artist"}).json()
    events = [
        {"id": "dentist", "start": {"dateTime": "2026-11-03T14:00:00+02:00"}, "end": {"dateTime": "2026-11-03T15:00:00+02:00"}},
        {"id": "birthday", "transparency": "transparent",
         "start": {"dateTime": "2026-11-03T10:00:00+02:00"}, "end": {"dateTime": "2026-11-03T11:00:00+02:00"}},
    ]
    monkeypatch.setattr(gb, "get_google_calendar_service", lambda *a: object())
    monkeypatch.setattr(gb, "list_google_events", lambda service, start, end: events)
    gb._cache.clear()

    def labels(artist_id=None, day=DAY):
        return [label for label, *_ in compute_available_slots(db_session, s.id, "Asia/Jerusalem", 9, 21, 60, day, artist_id)]

    assert "14:00" in labels()                                                     # not connected yet — nothing blocked
    settings = db_session.scalar(select(StudioSettings).where(StudioSettings.studio_id == s.id))
    settings.google_calendar_client_id, settings.google_calendar_client_secret = "cid", "secret"
    settings.google_calendar_refresh_token = "refresh"
    db_session.commit()
    gb._cache.clear()

    for who in (None, str(owner.id)):
        free = labels(who)
        assert "14:00" not in free and "13:30" not in free and "14:30" not in free and "15:00" in free
        assert "10:00" in free                                                     # "free" in Google
    assert "14:00" in labels(artist["id"])                                         # another staff member's day
    busy = (datetime(2026, 11, 3, 12, 30, tzinfo=timezone.utc), datetime(2026, 11, 3, 13, 30, tzinfo=timezone.utc))
    assert gb.conflicts(db_session, s.id, None, *busy) and not gb.conflicts(db_session, s.id, artist["id"], *busy)

    # a whole day marked busy (a vacation) closes the day; a whole free day doesn't
    events[:] = [{"id": "vacation", "start": {"date": "2026-11-04"}, "end": {"date": "2026-11-05"}},
                 {"id": "holiday", "transparency": "transparent", "start": {"date": "2026-11-05"}, "end": {"date": "2026-11-06"}}]
    gb._cache.clear()
    assert labels(day=date(2026, 11, 4)) == [] and "09:00" in labels(day=date(2026, 11, 5))
