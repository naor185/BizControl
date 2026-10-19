"""Breaks in the attendance clock (the owner, 2026-10-19): a worker goes on a break and comes back — from the app, or at
the door (a clock-out that was a break; the scan on the way back ends it); the break isn't counted in the hours or the
pay, everywhere; the owner fixes a shift's break minutes by hand."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.work_session import WorkSession
from app.repositories.staff_repository import StaffRepository
from tests.conftest import register_and_login


def _setup(client, db, slug):
    owner = register_and_login(client, slug, f"owner@{slug}.com")
    studio = db.scalar(select(Studio).where(Studio.slug == slug))
    studio.subscription_plan = "pro"
    db.commit()
    r = client.post("/api/users/artists", headers=owner, json={"email": f"eli@{slug}.com", "password": "secret123", "role": "staff",
                                                               "display_name": "איילי", "pay_type": "hourly", "hourly_rate": 40})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": f"eli@{slug}.com", "password": "secret123"}).json()["access_token"]
    return owner, {"Authorization": f"Bearer {t}"}, uuid.UUID(r.json()["id"]), studio.id


def _session(db, uid) -> WorkSession:
    db.expire_all()
    return db.scalar(select(WorkSession).where(WorkSession.user_id == uid).order_by(WorkSession.start_time.desc()))


def test_a_break_from_the_app_is_not_paid(client, db_session):
    owner, eli, uid, sid = _setup(client, db_session, "brk-app")
    assert client.post("/api/staff/clock-in", headers=eli).status_code == 200
    now = datetime.now(timezone.utc)
    s = _session(db_session, uid)
    s.start_time, s.paid_from = now - timedelta(hours=4), None
    db_session.commit()

    assert client.post("/api/staff/break/start", headers=eli).json()["break_started_at"]
    s = _session(db_session, uid)
    s.break_started_at = now - timedelta(minutes=30)
    db_session.commit()
    assert client.post("/api/staff/break/end", headers=eli).json()["break_minutes"] == 30
    assert client.get("/api/staff/clock-status", headers=eli).json()["active_session"]["break_minutes"] == 30
    assert client.post("/api/staff/break/start", headers=owner).status_code == 403          # the owner doesn't clock

    out = client.post("/api/staff/clock-out", headers=eli).json()
    assert abs(float(out["session_pay"]) - 3.5 * 40) < 1                                     # 4 hours less 30 minutes

    shift = client.get("/api/staff/shifts", headers=owner, params={"user_id": str(uid), "start_date": (now - timedelta(days=1)).isoformat(),
                                                                   "end_date": (now + timedelta(days=1)).isoformat()}).json()[0]
    assert shift["break_minutes"] == 30 and abs(shift["hours"] - 3.5) < 0.02
    fixed = client.patch(f"/api/staff/shifts/{shift['id']}", headers=owner, json={"break_minutes": 60}).json()
    assert abs(fixed["hours"] - 3.0) < 0.02 and abs(fixed["pay"] - 120) < 1
    items = StaffRepository(db_session).get_user_payroll_summary(sid, now - timedelta(days=1), now + timedelta(days=1))
    assert abs(float(next(i for i in items if str(i["user_id"]) == str(uid))["total_hours"]) - 3.0) < 0.02


def test_at_the_door_a_clock_out_that_was_a_break_and_the_way_back(client, db_session):
    owner, eli, uid, sid = _setup(client, db_session, "brk-door")
    db_session.get(StudioSettings, sid).nfc_clock_code = "door-code-1"
    db_session.commit()
    tap = lambda: client.post("/api/nfc/tap", headers=eli, json={"code": "door-code-1"}).json()

    assert tap()["action"] == "in"
    s = _session(db_session, uid)
    s.start_time = datetime.now(timezone.utc) - timedelta(hours=3)
    db_session.commit()
    out = tap()
    assert out["action"] == "out"
    assert client.post("/api/nfc/to-break", headers=eli, json={"session_id": out["session_id"]}).json()["action"] == "break"
    s = _session(db_session, uid)
    assert s.end_time is None and s.break_started_at is not None                            # the shift goes on, on a break

    s.break_started_at = datetime.now(timezone.utc) - timedelta(minutes=20)
    db_session.commit()
    back = tap()
    assert back["action"] == "back"
    s = _session(db_session, uid)
    assert s.end_time is None and s.break_minutes == 20 and s.break_started_at is None

    seen = next(p for p in client.get("/api/nfc/presence", headers=owner).json() if p["user_id"] == str(uid))
    assert seen["break_minutes"] == 20 and seen["on_break_since"] is None and 155 <= seen["duration_minutes"] <= 161
    assert client.post("/api/staff/break/start", headers=eli).status_code == 200            # from the app, with the barcode too
    today = client.get("/api/staff/today", headers=owner).json()["working"]
    assert today[0]["on_break_since"] and today[0]["break_minutes"] == 20
