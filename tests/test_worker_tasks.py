"""A task for a worker (the owner, 2026-10-15): the worker hears at once (a push, or WhatsApp without the app), marks it
done in the calendar, is reminded when its time passes and every morning after until it's marked, and the owner hears
when it's done. A worker sees the team's tasks and their own, can't set tasks, can't mark another's. Local test
database; nothing is sent."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytz
from sqlalchemy import select

from app.models.device_token import DeviceToken
from app.models.message_job import MessageJob
from app.models.notification import Notification
from app.models.user import User
from app.services.team_tasks import sweep_task_followups
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _worker(client, db, owner, email, phone):
    r = client.post("/api/users/artists", headers=owner, json={"email": email, "password": "secret123", "display_name": email.split("@")[0], "role": "artist"})
    assert r.status_code == 201, r.text
    user = db.scalar(select(User).where(User.email == email))
    user.phone = phone
    db.commit()
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return user, {"Authorization": f"Bearer {t}"}


def _jobs(db, kind):
    return db.scalars(select(MessageJob).where(MessageJob.reminder_type == kind)).all()


def _at(day: date, hhmm: str) -> datetime:
    return IL.localize(datetime.combine(day, datetime.strptime(hhmm, "%H:%M").time())).astimezone(timezone.utc)


def test_a_task_for_a_worker_from_given_to_done(client, db_session):
    owner = register_and_login(client, "tasks-shop", "owner@tasks-shop.com")
    dana, dana_h = _worker(client, db_session, owner, "dana@tasks-shop.com", "0521230001")
    ron, ron_h = _worker(client, db_session, owner, "ron@tasks-shop.com", "0521230002")
    db_session.add(DeviceToken(user_id=ron.id, studio_id=ron.studio_id, token="ron-phone", platform="ios"))
    db_session.commit()
    today = datetime.now(IL).date()

    # given — Dana has no app: WhatsApp; Ron has the app: a push
    t1 = client.post("/api/tasks", headers=owner, json={"title": "לסדר את המחסן", "task_date": (today + timedelta(days=1)).isoformat(),
                                                         "start_time": "10:00", "assignee_id": str(dana.id)})
    assert t1.status_code == 201, t1.text
    client.post("/api/tasks", headers=owner, json={"title": "להזמין דיו", "task_date": today.isoformat(), "assignee_id": str(ron.id)})
    client.post("/api/tasks", headers=owner, json={"title": "ניקיון כללי", "task_date": today.isoformat()})     # the whole team
    [to_dana, to_ron] = sorted(_jobs(db_session, "task_assigned"), key=lambda j: j.channel == "push")
    assert to_dana.channel == "whatsapp" and to_dana.to_phone == "0521230001" and "משימה חדשה: לסדר את המחסן — מחר 10:00" == to_dana.body
    assert to_ron.channel == "push" and to_ron.recipient_user_id == ron.id

    # a worker sees the team's and their own, sets none, marks none of another's
    week = {"from_date": (today - timedelta(days=1)).isoformat(), "to_date": (today + timedelta(days=7)).isoformat()}
    seen = {t["title"] for t in client.get("/api/tasks", headers=dana_h, params=week).json()}
    assert seen == {"לסדר את המחסן", "ניקיון כללי"}
    assert client.post("/api/tasks", headers=dana_h, json={"title": "x", "task_date": today.isoformat()}).status_code == 403
    assert client.put(f"/api/tasks/{t1.json()['id']}", headers=dana_h, json={"title": "y"}).status_code == 403
    ron_task = next(t for t in client.get("/api/tasks", headers=owner, params=week).json() if t["title"] == "להזמין דיו")
    assert ron_task["assignee_name"] == "ron" and ron_task["done"] is False
    assert client.post(f"/api/tasks/{ron_task['id']}/done", headers=dana_h, json={"date": today.isoformat()}).status_code == 403

    # done — the owner hears; the calendar shows it done
    assert client.post(f"/api/tasks/{ron_task['id']}/done", headers=ron_h, json={"date": today.isoformat()}).status_code == 204
    [n] = db_session.scalars(select(Notification).where(Notification.type == "task_done")).all()
    assert n.body == "ron: להזמין דיו"
    assert [x["type"] for x in client.get("/api/notifications", headers=owner).json()] == ["task_done"]
    assert client.get("/api/notifications", headers=ron_h).json() == []            # the bell is the business's
    assert client.get("/api/notifications/unread-count", headers=ron_h).json() == {"count": 0}
    assert _jobs(db_session, "task_done")                          # a push to the owner
    assert next(t for t in client.get("/api/tasks", headers=owner, params=week).json() if t["title"] == "להזמין דיו")["done"]
    assert client.delete(f"/api/tasks/{ron_task['id']}/done", headers=ron_h, params={"date": today.isoformat()}).status_code == 204
    assert not next(t for t in client.get("/api/tasks", headers=owner, params=week).json() if t["title"] == "להזמין דיו")["done"]


def test_reminded_when_its_time_passes_and_every_morning_until_done(client, db_session):
    owner = register_and_login(client, "tasks-late", "owner@tasks-late.com")
    dana, dana_h = _worker(client, db_session, owner, "dana@tasks-late.com", "0521230011")
    today = datetime.now(IL).date()
    timed = client.post("/api/tasks", headers=owner, json={"title": "לנקות עמדה", "task_date": today.isoformat(),
                                                            "start_time": "08:00", "end_time": "08:30", "assignee_id": str(dana.id)}).json()
    untimed = client.post("/api/tasks", headers=owner, json={"title": "לספור מלאי", "task_date": (today - timedelta(days=1)).isoformat(),
                                                              "assignee_id": str(dana.id)}).json()

    before = _at(today, "07:00")                                     # nothing is late yet but yesterday's — not before 9:00
    assert sweep_task_followups(db_session, before) == 0
    late = _at(today, "09:30")
    assert sweep_task_followups(db_session, late) == 2               # today's passed its time; yesterday's — the morning
    assert sweep_task_followups(db_session, late + timedelta(minutes=10)) == 0          # once
    bodies = {j.body for j in _jobs(db_session, "task_overdue")}
    assert any("לנקות עמדה" in b and "עדיין לא סומנה כבוצעה" in b for b in bodies)

    # the next morning: both again, unless marked
    client.post(f"/api/tasks/{untimed['id']}/done", headers=dana_h, json={"date": (today - timedelta(days=1)).isoformat()})
    assert sweep_task_followups(db_session, _at(today + timedelta(days=1), "09:05")) == 1
    week = {"from_date": (today - timedelta(days=1)).isoformat(), "to_date": today.isoformat()}
    state = {t["title"]: (t["done"], t["overdue"]) for t in client.get("/api/tasks", headers=dana_h, params=week).json()}
    assert state["לספור מלאי"] == (True, False)


def test_a_recurring_task_is_done_one_occurrence_at_a_time(client, db_session):
    owner = register_and_login(client, "tasks-week", "owner@tasks-week.com")
    dana, dana_h = _worker(client, db_session, owner, "dana@tasks-week.com", "0521230021")
    today = datetime.now(IL).date()
    js_days = ",".join(str((d.weekday() + 1) % 7) for d in (today - timedelta(days=1), today))
    t = client.post("/api/tasks", headers=owner, json={"title": "להוציא זבל", "recurrence_type": "weekly",
                                                        "recurrence_days_of_week": js_days, "assignee_id": str(dana.id)}).json()
    assert "כל שבוע" in _jobs(db_session, "task_assigned")[0].body
    client.post(f"/api/tasks/{t['id']}/done", headers=dana_h, json={"date": today.isoformat()})
    week = {"from_date": (today - timedelta(days=1)).isoformat(), "to_date": today.isoformat()}
    done = {x["date"]: x["done"] for x in client.get("/api/tasks", headers=dana_h, params=week).json()}
    assert done == {(today - timedelta(days=1)).isoformat(): False, today.isoformat(): True}
    assert client.post("/api/tasks", headers=owner, json={"title": "x", "task_date": today.isoformat(),
                                                           "assignee_id": str(uuid.uuid4())}).status_code == 400
