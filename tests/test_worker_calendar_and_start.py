"""The owner, 2026-10-19: a worker sets appointments in their own calendar (it failed — no performer on their screen and
the server allowed managers only) and only theirs; and a worker's fixed start hour — without a published shift, a
clock-in before it counts from it, not from half an hour before."""
import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytz
from sqlalchemy import select

from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _setup(client, db, slug, role="staff"):
    owner = register_and_login(client, slug, f"owner@{slug}.com")
    me = client.get("/api/auth/me", headers=owner).json()
    w = client.post("/api/users/artists", headers=owner, json={"email": f"eli@{slug}.com", "password": "secret123",
                                                                 "display_name": "איילי", "role": role, "pay_type": "hourly",
                                                                 "hourly_rate": 40, "work_start": "12:00"})
    assert w.status_code == 201, w.text
    t = client.post("/api/auth/login-by-email", json={"email": f"eli@{slug}.com", "password": "secret123"}).json()["access_token"]
    c = client.post("/api/clients", headers=owner, json={"full_name": "טהר", "phone": "0527654321"}).json()
    return owner, me["id"], {"Authorization": f"Bearer {t}"}, w.json()["id"], c["id"]


def _when(days, hh):
    start = IL.localize(datetime.combine(date.today() + timedelta(days=days), time(hh)))
    return start.isoformat(), (start + timedelta(hours=2)).isoformat()


def test_a_worker_sets_appointments_in_their_own_calendar_only(client, db_session):
    owner, owner_id, eli, eli_id, client_id = _setup(client, db_session, "wk-book")
    a, b = _when(4, 10)
    r = client.post("/api/appointments", headers=eli, json={"client_id": client_id, "artist_id": owner_id, "title": "ייעוץ",
                                                           "starts_at": a, "ends_at": b})
    assert r.status_code == 201, r.text
    assert r.json()["artist_id"] == eli_id                               # always in their own calendar

    a, b = _when(5, 10)
    theirs = client.post("/api/appointments", headers=owner, json={"client_id": client_id, "artist_id": owner_id, "title": "קעקוע",
                                                                  "starts_at": a, "ends_at": b}).json()
    assert client.patch(f"/api/appointments/{theirs['id']}", headers=eli, json={"notes": "x"}).status_code == 403
    assert client.delete(f"/api/appointments/{theirs['id']}", headers=eli).status_code == 403
    assert client.patch(f"/api/appointments/{r.json()['id']}", headers=eli, json={"notes": "הלקוח יביא תמונה"}).status_code == 200
    team = client.get("/api/users/artists", headers=owner).json()
    assert next(m for m in team if m["id"] == eli_id)["work_start"] == "12:00"


def test_a_fixed_start_hour_counts_an_early_clock_in_from_it(client, db_session):
    from app.services import nfc_clock
    _, _, _, eli_id, _ = _setup(client, db_session, "wk-start")
    db_session.scalar(select(Studio).where(Studio.slug == "wk-start")).subscription_plan = "pro"
    db_session.commit()
    worker = db_session.get(User, uuid.UUID(eli_id))
    assert worker.work_start == "12:00"
    day = date.today() + timedelta(days=3)
    at = lambda h, m=0: IL.localize(datetime(day.year, day.month, day.day, h, m)).astimezone(timezone.utc)

    assert nfc_clock.paid_from(db_session, worker.studio_id, at(11, 30), worker.id) == at(12)    # half an hour early
    assert nfc_clock.paid_from(db_session, worker.studio_id, at(12, 10), worker.id) is None       # after it — as clocked
    assert nfc_clock.paid_from(db_session, worker.studio_id, at(7, 30), worker.id) is None        # far earlier — as clocked
    worker.work_start = None
    db_session.commit()
    assert nfc_clock.paid_from(db_session, worker.studio_id, at(7, 30), worker.id) == at(8)       # none — the opening hour
