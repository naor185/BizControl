"""Reports and alerts — the workers center's stage 4 (the owner, 2026-10-19): each published shift against the clock
(on time / late / not come), the report per worker with overtime over the owner's day limit, and the late alert —
once per shift, off when the owner turns it off."""
import uuid
from datetime import datetime, timedelta, timezone

import pytz
from sqlalchemy import select

from app.models.notification import Notification
from app.models.schedule import ScheduledShift, ScheduleWeek
from app.models.studio import Studio
from app.models.work_session import WorkSession
from app.services import schedule as sch
from app.services.attendance_report import sweep_late
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _business(client, db, slug):
    owner = register_and_login(client, slug, f"owner@{slug}.com")
    studio = db.scalar(select(Studio).where(Studio.slug == slug))
    studio.subscription_plan = "pro"
    db.commit()
    r = client.post("/api/users/artists", headers=owner, json={"email": f"dana@{slug}.com", "password": "secret123",
                                                               "role": "staff", "display_name": "דנה"})
    assert r.status_code == 201, r.text
    return owner, studio.id, uuid.UUID(r.json()["id"])


def _at(d, hh, mm=0):
    return IL.localize(datetime(d.year, d.month, d.day, hh, mm)).astimezone(timezone.utc)


def _shift(db, sid, uid, a, b):
    db.add(ScheduledShift(studio_id=sid, user_id=uid, starts_at=a, ends_at=b))
    week = sch.week_of(a.astimezone(IL).date())
    if not db.scalar(select(ScheduleWeek).where(ScheduleWeek.studio_id == sid, ScheduleWeek.week_start == week)):
        db.add(ScheduleWeek(studio_id=sid, week_start=week))
    db.commit()


def test_the_report_late_missed_and_overtime(client, db_session):
    owner, sid, did = _business(client, db_session, "rep-week")
    week = sch.week_of(datetime.now(IL).date()) - timedelta(days=7)            # last week, all past
    mon, tue, wed = (week + timedelta(days=i) for i in (1, 2, 3))
    for d in (mon, tue, wed):
        _shift(db_session, sid, did, _at(d, 8), _at(d, 14))
    db_session.add(WorkSession(studio_id=sid, user_id=did, start_time=_at(mon, 7, 30), end_time=_at(mon, 14)))   # early: on time
    db_session.add(WorkSession(studio_id=sid, user_id=did, start_time=_at(tue, 8, 25), end_time=_at(tue, 18, 30)))  # late 25, long
    db_session.commit()

    r = client.get("/api/schedule/report", headers=owner, params={"start": str(week), "end": str(week + timedelta(days=6))})
    assert r.status_code == 200, r.text
    rep = r.json()
    dana = next(w for w in rep["workers"] if w["user_id"] == str(did))
    assert dana["scheduled"] == 18 and dana["shifts"] == 3
    assert dana["late"] == 1 and dana["late_minutes"] == 25 and dana["missed"] == 1
    assert abs(dana["worked"] - (6.5 + 10 + 5 / 60)) < 0.02
    assert abs(dana["overtime"] - (1 + 5 / 60)) < 0.02                       # over 9 hours on Tuesday
    assert [e["status"] for e in rep["events"]] == ["missed", "late"] and rep["events"][1]["clock_in"] == "08:25"

    r = client.put("/api/schedule/alerts", headers=owner, json={"late_after_minutes": 30, "overtime_after_hours": 10})
    assert r.json() == {"late_after_minutes": 30, "late_alert": True, "overtime_after_hours": 10.0}
    dana = next(w for w in client.get("/api/schedule/report", headers=owner, params={"start": str(week), "end": str(week + timedelta(days=6))})
                .json()["workers"] if w["user_id"] == str(did))
    assert dana["late"] == 0 and abs(dana["overtime"] - 5 / 60) < 0.02       # 25 minutes is now on time

    worker = client.post("/api/auth/login-by-email", json={"email": "dana@rep-week.com", "password": "secret123"}).json()["access_token"]
    assert client.get("/api/schedule/report", headers={"Authorization": f"Bearer {worker}"},
                      params={"start": str(week), "end": str(week)}).status_code == 403


def test_a_late_alert_once_and_off_when_turned_off(client, db_session):
    owner, sid, did = _business(client, db_session, "rep-late")
    now = datetime.now(timezone.utc).replace(microsecond=0)
    _shift(db_session, sid, did, now - timedelta(minutes=15), now + timedelta(hours=4))

    assert sweep_late(db_session, now) == 1
    bell = db_session.scalar(select(Notification).where(Notification.studio_id == sid, Notification.type == "staff_late"))
    assert bell and "דנה" in bell.title
    assert sweep_late(db_session, now + timedelta(minutes=2)) == 0                 # once per shift

    if (now - timedelta(minutes=15)).astimezone(IL).date() == datetime.now(IL).date():
        missing = client.get("/api/staff/today", headers=owner).json()["missing"]
        assert missing[0]["kind"] == "shift" and missing[0]["late_min"] >= 15

    db_session.add(WorkSession(studio_id=sid, user_id=did, start_time=now - timedelta(minutes=5)))   # she came, late
    db_session.commit()
    client.put("/api/schedule/alerts", headers=owner, json={"late_alert": False})
    r = client.post("/api/users/artists", headers=owner, json={"email": "ron@rep-late.com", "password": "secret123",
                                                               "role": "staff", "display_name": "רון"})
    _shift(db_session, sid, uuid.UUID(r.json()["id"]), now - timedelta(minutes=20), now + timedelta(hours=2))
    assert sweep_late(db_session, now) == 0                                        # the owner turned it off
