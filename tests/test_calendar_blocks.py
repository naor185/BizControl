"""A time in the calendar locks it (the owner, 2026-10-15: "anything that isn't an appointment — a break, a meeting, a
task — no appointment on it"): the calendar of whom it's for, or everyone's when it's for the whole team. Clients
booking themselves aren't offered those times; the staff can't set or move an appointment onto them. A break or a
meeting always locks and has nothing to mark; a task with hours locks too, unless its switch says no; a reminder
without hours locks nothing. Local test database; nothing is sent."""
from datetime import date, datetime, time, timedelta, timezone

import pytz
from sqlalchemy import select

from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.user import User
from app.services.booking_availability import compute_available_slots
from app.services.team_tasks import sweep_task_followups
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _at(day: date, hh: int, mm: int = 0) -> str:
    return IL.localize(datetime.combine(day, time(hh, mm))).isoformat()


def _setup(client, db):
    owner = register_and_login(client, "lock-shop", "owner@lock-shop.com")
    me = client.get("/api/auth/me", headers=owner).json()
    w = client.post("/api/users/artists", headers=owner, json={"email": "dana@lock-shop.com", "password": "secret123",
                                                                 "display_name": "דנה", "role": "artist"})
    assert w.status_code == 201, w.text
    db.get(User, w.json()["id"]).phone = "0521230001"          # somewhere to tell her (WhatsApp)
    db.commit()
    c = client.post("/api/clients", headers=owner, json={"full_name": "רון כהן", "phone": "0527654321"}).json()
    studio = db.scalar(select(Studio).where(Studio.slug == "lock-shop"))
    return owner, me["id"], w.json()["id"], c["id"], studio


def _book(client, h, client_id, artist_id, day, hh, mm=0, minutes=60):
    start = IL.localize(datetime.combine(day, time(hh, mm)))
    return client.post("/api/appointments", headers=h, json={"client_id": client_id, "artist_id": artist_id, "title": "קעקוע",
                                                             "starts_at": start.isoformat(),
                                                             "ends_at": (start + timedelta(minutes=minutes)).isoformat()})


def test_a_break_locks_whom_its_for_and_is_nothing_to_mark(client, db_session):
    owner, owner_id, dana, client_id, studio = _setup(client, db_session)
    day = datetime.now(IL).date() + timedelta(days=1)
    assert client.post("/api/tasks", headers=owner, json={"title": "הפסקה", "kind": "break", "task_date": day.isoformat(),
                                                           "assignee_id": dana}).status_code == 400   # a break has hours
    t = client.post("/api/tasks", headers=owner, json={"title": "הפסקה", "kind": "break", "task_date": day.isoformat(),
                                                        "start_time": "13:00", "end_time": "14:00", "assignee_id": dana,
                                                        "blocks_booking": False})
    assert t.status_code == 201 and t.json()["blocks_booking"] is True               # a break always locks

    r = _book(client, owner, client_id, dana, day, 13, 30)
    assert r.status_code == 409
    assert "היומן של דנה נעול בשעות 13:00–14:00" in r.json()["detail"] and "הפסקה" in r.json()["detail"]
    assert _book(client, owner, client_id, dana, day, 12, 0).status_code == 201       # 12:00–13:00 — just before
    assert _book(client, owner, client_id, owner_id, day, 13, 0).status_code == 201   # the owner's calendar is free

    # a client booking themselves isn't offered it
    labels = [s[0] for s in compute_available_slots(db_session, studio.id, "Asia/Jerusalem", 9, 18, 60, day, dana)]
    assert "13:00" not in labels and "14:00" in labels

    # nothing to mark, nobody "given" a task, never late, no reminders
    [inst] = client.get("/api/tasks", headers=owner, params={"from_date": day.isoformat(), "to_date": day.isoformat()}).json()
    assert inst["locks"] is True and inst["kind"] == "break" and inst["overdue"] is False
    assert client.post(f"/api/tasks/{t.json()['id']}/done", headers=owner, json={"date": day.isoformat()}).status_code == 400
    after = IL.localize(datetime.combine(day + timedelta(days=1), time(10, 0))).astimezone(timezone.utc)
    assert sweep_task_followups(db_session, now=after) == 0
    assert db_session.scalars(select(MessageJob).where(MessageJob.reminder_type.in_(("task_assigned", "task_overdue")))).all() == []


def test_a_team_meeting_locks_everyone_a_reminder_without_hours_nothing(client, db_session):
    owner, owner_id, dana, client_id, studio = _setup(client, db_session)
    day = datetime.now(IL).date() + timedelta(days=2)
    client.post("/api/tasks", headers=owner, json={"title": "ישיבת צוות", "kind": "break", "task_date": day.isoformat(),
                                                    "start_time": "09:00", "end_time": "10:00"})
    client.post("/api/tasks", headers=owner, json={"title": "לשלם ארנונה", "task_date": day.isoformat()})
    for who in (owner_id, dana):
        r = _book(client, owner, client_id, who, day, 9, 30)
        assert r.status_code == 409 and "היומן של כל הצוות נעול" in r.json()["detail"]
    assert _book(client, owner, client_id, dana, day, 11, 0).status_code == 201       # the reminder locks nothing


def test_a_task_with_hours_locks_too_weekly_and_its_switch_takes_it_off(client, db_session):
    owner, owner_id, dana, client_id, studio = _setup(client, db_session)
    day = datetime.now(IL).date() + timedelta(days=3)
    booked = _book(client, owner, client_id, dana, day, 15, 0)                       # before the task was set
    assert booked.status_code == 201
    js_day = (day.weekday() + 1) % 7
    t = client.post("/api/tasks", headers=owner, json={"title": "לסדר את המחסן", "recurrence_type": "weekly",
                                                        "recurrence_days_of_week": str(js_day), "start_time": "15:00",
                                                        "end_time": "16:00", "assignee_id": dana})
    assert t.json()["kind"] == "task" and t.json()["blocks_booking"] is True
    assert _book(client, owner, client_id, dana, day + timedelta(days=7), 15, 0).status_code == 409
    assert db_session.scalars(select(MessageJob).where(MessageJob.reminder_type == "task_assigned")).all()   # a task: she hears

    appt = booked.json()["id"]
    # what's already there stays and can be edited; moving it onto another locked hour is refused
    assert client.patch(f"/api/appointments/{appt}", headers=owner, json={"notes": "להביא סקיצה"}).status_code == 200
    moved = client.patch(f"/api/appointments/{appt}", headers=owner, json={
        "starts_at": _at(day + timedelta(days=7), 15, 30), "ends_at": _at(day + timedelta(days=7), 16, 30)})
    assert moved.status_code == 409
    assert client.patch(f"/api/appointments/{appt}", headers=owner, json={
        "starts_at": _at(day, 17, 0), "ends_at": _at(day, 18, 0)}).status_code == 200

    # the switch takes the lock off
    assert client.put(f"/api/tasks/{t.json()['id']}", headers=owner, json={"blocks_booking": False}).status_code == 200
    assert _book(client, owner, client_id, dana, day + timedelta(days=7), 15, 0).status_code == 201
