"""The attendance clock's barcode / NFC sticker (owner, 2026-10-13): only the superadmin turns it on and issues the code; a
worker scanning or touching it with their own phone is clocked in, then out; while it's on, the header button can't
clock. The businesses here are on pro — the plan has the clock (test_attendance_clock.py)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.studio import Studio
from app.models.user import User
from app.models.work_session import WorkSession
from tests.conftest import register_and_login


def _superadmin(client, db):
    h = register_and_login(client, "nfc-platform", "sa@nfc-platform.com")
    db.scalar(select(User).where(User.email == "sa@nfc-platform.com")).role = "superadmin"
    db.commit()
    return h


def _business(client, db, slug):
    h = register_and_login(client, slug, f"owner@{slug}.com")
    db.scalar(select(Studio).where(Studio.slug == slug)).subscription_plan = "pro"
    db.commit()
    return h


def _worker(client, h, email):
    r = client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123", "display_name": "דנה",
                                                           "role": "staff", "pay_type": "hourly", "hourly_rate": 60})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}


def _studio_id(client, h):
    return client.get("/api/auth/me", headers=h).json()["studio_id"]


def test_only_the_superadmin_turns_it_on_and_a_touch_clocks_in_then_out(client, db_session):
    sa = _superadmin(client, db_session)
    owner = _business(client, db_session, "nfc-shop")
    w = _worker(client, owner, "dana@nfc-shop.com")
    sid = _studio_id(client, owner)

    assert client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=owner, json={"on": True}).status_code == 403
    r = client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=sa, json={"on": True})
    assert r.status_code == 200 and r.json()["on"] is True
    link = r.json()["link"]
    code = link.rsplit("/", 1)[1]
    assert "/clock/" in link and client.get("/api/nfc/status", headers=owner).json()["on"] is True

    # the header button can't clock while the sticker is the way in
    assert client.post("/api/staff/clock-in", headers=w).status_code == 403
    assert client.get("/api/staff/clock-status", headers=w).json()["nfc"] is True

    first = client.post("/api/nfc/tap", headers=w, json={"code": code}).json()
    assert first["action"] == "in" and first["name"] == "דנה" and first["repeat"] is False
    again = client.post("/api/nfc/tap", headers=w, json={"code": code}).json()          # read twice: no toggle
    assert again["action"] == "in" and again["repeat"] is True

    s = db_session.get(WorkSession, first["session_id"])
    s.start_time = datetime.now(timezone.utc) - timedelta(hours=2)                     # two hours later…
    db_session.commit()
    out = client.post("/api/nfc/tap", headers=w, json={"code": code}).json()
    assert out["action"] == "out"
    db_session.expire_all()
    assert float(db_session.get(WorkSession, first["session_id"]).session_pay) == 120.0   # 2 h × ₪60

    assert client.post("/api/nfc/tap", headers=w, json={"code": "someone-elses"}).status_code == 404


def test_a_new_code_retires_the_old_sticker_and_a_mistake_is_undone(client, db_session):
    sa = _superadmin(client, db_session)
    owner = _business(client, db_session, "nfc-new")
    w = _worker(client, owner, "dana@nfc-new.com")
    sid = _studio_id(client, owner)
    old = client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=sa, json={"on": True}).json()["link"].rsplit("/", 1)[1]
    new = client.post(f"/api/admin/studios/{sid}/nfc-clock/new-code", headers=sa).json()["link"].rsplit("/", 1)[1]
    assert new != old
    assert client.post("/api/nfc/tap", headers=w, json={"code": old}).status_code == 404

    tap = client.post("/api/nfc/tap", headers=w, json={"code": new}).json()
    assert client.post("/api/nfc/undo", headers=w, json={"session_id": tap["session_id"]}).json() == {"undone": "in"}
    assert db_session.get(WorkSession, tap["session_id"]) is None

    client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=sa, json={"on": False})
    assert client.get("/api/nfc/status", headers=owner).json() == {"included": True, "on": False}
    assert client.post("/api/staff/clock-in", headers=w).status_code == 200            # off: the header button again


def test_a_worker_with_appointments_today_is_asked_to_clock_in(client, db_session):
    """Stage 3: with the clock on, a worker (not the owner) with an appointment today who hasn't clocked in is asked —
    on the screen, and by a push half an hour before, once a day."""
    import app.services.message_worker as mw
    from app.models.appointment import Appointment
    from app.models.client import Client
    from app.models.message_job import MessageJob

    sa = _superadmin(client, db_session)
    owner = _business(client, db_session, "nfc-ask")
    w = _worker(client, owner, "dana@nfc-ask.com")
    sid = _studio_id(client, owner)
    worker = db_session.scalar(select(User).where(User.email == "dana@nfc-ask.com"))
    c = Client(studio_id=worker.studio_id, full_name="לקוחה", phone="0521234567")
    db_session.add(c)
    db_session.flush()
    start = datetime.now(timezone.utc) + timedelta(minutes=20)
    db_session.add(Appointment(studio_id=worker.studio_id, client_id=c.id, artist_id=worker.id, title="טיפול",
                               starts_at=start, ends_at=start + timedelta(hours=1), status="scheduled"))
    db_session.commit()

    assert client.get("/api/staff/clock-status", headers=w).json()["clock_in_needed"] is False   # the clock is off
    mw.sweep_clock_in_nudges(db_session)
    assert db_session.scalars(select(MessageJob).where(MessageJob.reminder_type == "clock_in_nudge")).all() == []

    code = client.post(f"/api/admin/studios/{sid}/nfc-clock", headers=sa, json={"on": True}).json()["link"].rsplit("/", 1)[1]
    assert client.get("/api/staff/clock-status", headers=w).json()["clock_in_needed"] is True
    mw.sweep_clock_in_nudges(db_session)
    mw.sweep_clock_in_nudges(db_session)
    nudges = db_session.scalars(select(MessageJob).where(MessageJob.reminder_type == "clock_in_nudge")).all()
    assert len(nudges) == 1 and nudges[0].recipient_user_id == worker.id and nudges[0].channel == "push"

    client.post("/api/nfc/tap", headers=w, json={"code": code})
    assert client.get("/api/staff/clock-status", headers=w).json()["clock_in_needed"] is False   # clocked in
