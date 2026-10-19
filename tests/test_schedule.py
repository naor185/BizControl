"""The shift schedule — the workers center's stage 2 (the owner, 2026-10-19): the owner plans and publishes a week; a
worker sees only a published week and only their own shifts, hears of them, and sends constraints until the deadline;
an early clock-in counts from the worker's own shift."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytz
from sqlalchemy import select

from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _business(client, db, slug):
    owner = register_and_login(client, slug, f"owner@{slug}.com")
    db.scalar(select(Studio).where(Studio.slug == slug)).subscription_plan = "pro"
    db.commit()
    return owner


def _member(client, db, owner, email, phone=None):
    r = client.post("/api/users/artists", headers=owner, json={"email": email, "password": "secret123", "role": "staff",
                                                               "display_name": email.split("@")[0]})
    assert r.status_code == 201, r.text
    if phone:
        db.get(User, uuid.UUID(r.json()["id"])).phone = phone
        db.commit()
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}, r.json()["id"]


def _sunday(weeks_ahead: int) -> date:
    today = datetime.now(IL).date()
    return today - timedelta(days=(today.weekday() + 1) % 7) + timedelta(days=7 * weeks_ahead)


def test_plan_publish_and_what_a_worker_sees(client, db_session):
    owner = _business(client, db_session, "sch-plan")
    dana, did = _member(client, db_session, owner, "dana@sch-plan.com", phone="0521234567")
    _, rid = _member(client, db_session, owner, "ron@sch-plan.com")
    week = _sunday(3)

    r = client.post("/api/schedule/shifts", headers=owner, json={"user_id": did, "date": str(week), "start": "08:00", "end": "14:00"})
    assert r.status_code == 201 and r.json()["start"] == "08:00"
    clash = client.post("/api/schedule/shifts", headers=owner, json={"user_id": did, "date": str(week), "start": "13:00", "end": "16:00"})
    assert clash.status_code == 400                                         # overlaps her morning
    client.post("/api/schedule/shifts", headers=owner, json={"user_id": rid, "date": str(week + timedelta(days=1)), "start": "14:00", "end": "20:00"})
    assert client.post("/api/schedule/shifts", headers=dana, json={"user_id": did, "date": str(week), "start": "15:00", "end": "16:00"}).status_code == 403

    assert client.get("/api/schedule/week", headers=dana, params={"start": str(week)}).json()["shifts"] == []   # a draft
    full = client.get("/api/schedule/week", headers=owner, params={"start": str(week)}).json()
    assert len(full["shifts"]) == 2 and full["published_at"] is None and len(full["workers"]) >= 2

    assert client.post("/api/schedule/week/publish", headers=owner, json={"start": str(week)}).json()["told"] == 1   # Dana (Ron: no phone, no app)
    mine = client.get("/api/schedule/week", headers=dana, params={"start": str(week)}).json()
    assert [s["user_id"] for s in mine["shifts"]] == [did]                  # only her own
    job = db_session.scalar(select(MessageJob).where(MessageJob.reminder_type == "schedule_published"))
    assert job is not None and "08:00–14:00" in job.body

    copied = client.post("/api/schedule/week/copy", headers=owner, json={"start": str(week + timedelta(days=7))}).json()
    assert copied["copied"] == 2


def test_constraints_until_the_deadline(client, db_session):
    owner = _business(client, db_session, "sch-cons")
    dana, did = _member(client, db_session, owner, "dana@sch-cons.com")
    later = _sunday(3)
    r = client.put("/api/schedule/constraints", headers=dana, json={"date": str(later + timedelta(days=2)), "kind": "off", "note": "מבחן"})
    assert r.status_code == 200 and r.json()["kind"] == "off"
    seen = client.get("/api/schedule/week", headers=owner, params={"start": str(later)}).json()["constraints"]
    assert seen == [{"user_id": did, "date": str(later + timedelta(days=2)), "kind": "off", "note": "מבחן"}]
    assert client.put("/api/schedule/constraints", headers=dana, json={"date": str(later + timedelta(days=2)), "kind": ""}).json()["kind"] == ""
    past = client.put("/api/schedule/constraints", headers=dana, json={"date": str(_sunday(0)), "kind": "off"})
    assert past.status_code == 400                                          # this week's deadline is gone
    assert client.put("/api/schedule/constraints", headers=dana, json={"date": str(later), "kind": "maybe"}).status_code == 400


def test_an_early_clock_in_counts_from_the_workers_own_shift(client, db_session):
    from app.services import nfc_clock
    owner = _business(client, db_session, "sch-early")
    _, did = _member(client, db_session, owner, "dana@sch-early.com")
    week = _sunday(2)
    day = week + timedelta(days=1)
    client.post("/api/schedule/shifts", headers=owner, json={"user_id": did, "date": str(day), "start": "10:00", "end": "16:00"})
    worker = db_session.get(User, uuid.UUID(did))
    at = lambda h, m=0: IL.localize(datetime(day.year, day.month, day.day, h, m)).astimezone(timezone.utc)

    assert nfc_clock.paid_from(db_session, worker.studio_id, at(9, 20), worker.id) is None   # a draft — the opening rule (9:20 > 8:00)
    client.post("/api/schedule/week/publish", headers=owner, json={"start": str(week)})
    assert nfc_clock.paid_from(db_session, worker.studio_id, at(9, 20), worker.id) == at(10)  # early for her 10:00
    assert nfc_clock.paid_from(db_session, worker.studio_id, at(10, 15), worker.id) is None   # late — as clocked
