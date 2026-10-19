"""Workers' requests — the workers center's stage 3 (the owner, 2026-10-19): a shift swap — the colleague agrees, the
owner approves, the schedule changes; time off — the owner approves, the worker's calendar is locked those days."""
import uuid
from datetime import date, datetime, timedelta

import pytz
from sqlalchemy import select

from app.models.message_job import MessageJob
from app.models.notification import Notification
from app.models.schedule import ScheduledShift
from app.models.studio import Studio
from app.models.task import Task
from app.models.user import User
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _business(client, db, slug):
    owner = register_and_login(client, slug, f"owner@{slug}.com")
    db.scalar(select(Studio).where(Studio.slug == slug)).subscription_plan = "pro"
    db.commit()
    return owner


def _member(client, db, owner, email):
    r = client.post("/api/users/artists", headers=owner, json={"email": email, "password": "secret123", "role": "staff",
                                                               "display_name": email.split("@")[0]})
    assert r.status_code == 201, r.text
    db.get(User, uuid.UUID(r.json()["id"])).phone = "0521234567"
    db.commit()
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}, r.json()["id"]


def _week(n=2) -> date:
    today = datetime.now(IL).date()
    return today - timedelta(days=(today.weekday() + 1) % 7) + timedelta(days=7 * n)


def test_a_swap_the_colleague_agrees_and_the_owner_approves(client, db_session):
    owner = _business(client, db_session, "req-swap")
    dana, did = _member(client, db_session, owner, "dana@req-swap.com")
    ron, rid = _member(client, db_session, owner, "ron@req-swap.com")
    week = _week()
    mon, tue = week + timedelta(days=1), week + timedelta(days=2)
    s1 = client.post("/api/schedule/shifts", headers=owner, json={"user_id": did, "date": str(mon), "start": "08:00", "end": "14:00"}).json()
    s2 = client.post("/api/schedule/shifts", headers=owner, json={"user_id": rid, "date": str(tue), "start": "14:00", "end": "20:00"}).json()

    r = client.post("/api/requests/swap", headers=dana, json={"shift_id": s1["id"], "target_user_id": rid})
    assert r.status_code == 400 and "פורסם" in r.json()["detail"]          # a draft week can't be swapped
    client.post("/api/schedule/week/publish", headers=owner, json={"start": str(week)})

    others = client.get("/api/requests/colleagues", headers=dana, params={"shift_id": s1["id"]}).json()
    ron_row = next(o for o in others if o["id"] == rid)
    assert [s["id"] for s in ron_row["shifts"]] == [s2["id"]]               # his shifts that week, to trade
    req = client.post("/api/requests/swap", headers=dana, json={"shift_id": s1["id"], "target_user_id": rid,
                                                                 "target_shift_id": s2["id"], "note": "חתונה"}).json()
    assert req["status"] == "waiting_colleague"
    assert db_session.scalar(select(MessageJob).where(MessageJob.reminder_type == "swap_request", MessageJob.recipient_user_id == uuid.UUID(rid)))
    assert client.post(f"/api/requests/{req['id']}/decide", headers=owner, json={"approve": True}).status_code == 400   # Ron first

    assert client.get("/api/requests", headers=ron).json()["to_me"][0]["id"] == req["id"]
    assert client.post(f"/api/requests/{req['id']}/answer", headers=ron, json={"accept": True}).json()["status"] == "waiting_owner"
    assert db_session.scalar(select(Notification).where(Notification.type == "staff_request"))
    assert client.post(f"/api/requests/{req['id']}/decide", headers=dana, json={"approve": True}).status_code == 403

    done = client.post(f"/api/requests/{req['id']}/decide", headers=owner, json={"approve": True}).json()
    assert done["status"] == "approved"
    db_session.expire_all()
    assert str(db_session.get(ScheduledShift, uuid.UUID(s1["id"])).user_id) == rid       # traded
    assert str(db_session.get(ScheduledShift, uuid.UUID(s2["id"])).user_id) == did
    assert db_session.scalars(select(MessageJob).where(MessageJob.reminder_type == "request_decided")).all()


def test_time_off_locks_the_calendar_and_a_decline_or_cancel(client, db_session):
    owner = _business(client, db_session, "req-off")
    dana, did = _member(client, db_session, owner, "dana@req-off.com")
    ron, rid = _member(client, db_session, owner, "ron@req-off.com")
    week = _week()
    d1, d3 = week + timedelta(days=3), week + timedelta(days=5)
    client.post("/api/schedule/shifts", headers=owner, json={"user_id": did, "date": str(d1), "start": "08:00", "end": "14:00"})

    req = client.post("/api/requests/time-off", headers=dana, json={"kind": "vacation", "date_from": str(d1), "date_to": str(d3)}).json()
    assert req["status"] == "waiting_owner" and len(req["shifts_during"]) == 1        # her shift on those days, shown
    waiting = client.get("/api/requests", headers=owner).json()["waiting"]
    assert [w["id"] for w in waiting] == [req["id"]]
    assert client.post(f"/api/requests/{req['id']}/decide", headers=owner, json={"approve": True}).json()["status"] == "approved"
    locks = db_session.scalars(select(Task).where(Task.assignee_id == uuid.UUID(did), Task.kind == "break")).all()
    assert sorted(t.task_date for t in locks) == [d1, d1 + timedelta(days=1), d3]

    bad = client.post("/api/requests/time-off", headers=dana, json={"kind": "vacation", "date_from": str(d3), "date_to": str(d1)})
    assert bad.status_code == 400
    sick = client.post("/api/requests/time-off", headers=dana, json={"kind": "sick", "date_from": str(d1), "date_to": str(d1)}).json()
    assert client.post(f"/api/requests/{sick['id']}/cancel", headers=dana).json()["status"] == "canceled"

    s = client.post("/api/schedule/shifts", headers=owner, json={"user_id": did, "date": str(week + timedelta(days=6)), "start": "08:00", "end": "12:00"}).json()
    client.post("/api/schedule/week/publish", headers=owner, json={"start": str(week)})
    swap = client.post("/api/requests/swap", headers=dana, json={"shift_id": s["id"], "target_user_id": rid}).json()
    assert client.post(f"/api/requests/{swap['id']}/answer", headers=ron, json={"accept": False}).json()["status"] == "declined"
    assert db_session.scalar(select(MessageJob).where(MessageJob.reminder_type == "swap_answer"))
