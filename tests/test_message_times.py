"""Ready times for the messages (owner, 2026-10-12): the morning reminder's hour, a reminder ~2 hours before, the club
invite "at once"."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

import app.services.message_worker as mw
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from tests.conftest import register_and_login


def _setup(client, db, slug, starts_in):
    register_and_login(client, slug, f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    owner = db.scalar(select(User).where(User.email == f"owner@{slug}.com"))
    c = Client(studio_id=s.id, full_name="דנה", phone="0521234567")
    db.add(c)
    db.flush()
    start = datetime.now(timezone.utc) + starts_in
    a = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="תספורת", starts_at=start,
                    ends_at=start + timedelta(hours=1), status="scheduled")
    db.add(a)
    db.commit()
    return s, a


def _types(db, appointment_id):
    return [j.reminder_type for j in db.scalars(select(MessageJob).where(MessageJob.appointment_id == appointment_id)).all()]


def test_the_two_hours_reminder_is_off_until_turned_on(client, db_session):
    s, a = _setup(client, db_session, "two-hours", timedelta(hours=2))
    mw.sweep_2hour_reminders(db_session)
    assert "2hours" not in _types(db_session, a.id)                         # off by default — nothing new goes out

    db_session.get(StudioSettings, s.id).reminder_2_hours_enabled = True
    db_session.commit()
    mw.sweep_2hour_reminders(db_session)
    mw.sweep_2hour_reminders(db_session)
    assert _types(db_session, a.id).count("2hours") == 1                    # on: once


def test_the_morning_reminder_goes_at_the_hour_the_business_chose(client, db_session):
    s, a = _setup(client, db_session, "morning-hour", timedelta(minutes=5))
    db_session.get(StudioSettings, s.id).same_day_reminder_hour = 9
    db_session.commit()
    mw.sweep_same_day_reminders(db_session, hour=8)
    assert "same_day" not in _types(db_session, a.id)
    mw.sweep_same_day_reminders(db_session, hour=9)
    assert "same_day" in _types(db_session, a.id)


def test_the_hour_is_saved_within_the_morning(client):
    h = register_and_login(client, "hour-save", "owner@hour-save.com")
    assert client.patch("/api/studio/automation", headers=h, json={"same_day_reminder_hour": 10}).status_code == 200
    assert client.get("/api/studio/automation", headers=h).json()["same_day_reminder_hour"] == 10
    assert client.patch("/api/studio/automation", headers=h, json={"same_day_reminder_hour": 23}).status_code == 422
