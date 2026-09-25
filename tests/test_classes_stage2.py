"""Classes & memberships, stage 2 — rooms, class templates and the schedule. The plan's end-of-stage
checks: set up a weekly class and a short course, see 8 weeks, cancel one class — and the people booked
into it get a message. The clock is frozen on 1 October 2026, so the schedule crosses the move to winter
time (25 October). Local test database; nothing is sent."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.classes import ClassBooking, ClassSession, ClassTemplate
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.studio import Studio
from app.models.user import User
from app.services import classes as svc
from tests.conftest import register_and_login

NOW = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)          # 10:00 in Israel


@pytest.fixture()
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(svc, "now_utc", lambda: state["now"])
    return state


def _business(client, db, slug="pilates", modules=("classes", "rooms")):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.name, s.business_type = "פילאטיס בלב", "pilates"
    for m in modules:
        db.add(StudioModule(studio_id=s.id, module_id=m, is_enabled=True))
    db.commit()
    return h, s


def _room(client, h, name="סטודיו א", capacity=12):
    r = client.post("/api/classes/rooms", headers=h, json={"name": name, "capacity": capacity})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _template(client, h, **over):
    body = {"name": "פילאטיס מכשירים", "weekdays": [0, 2], "start_time": "18:00", "duration_minutes": 55,
            "starts_on": "2026-10-01", **over}
    r = client.post("/api/classes/templates", headers=h, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _sessions(db, template_id):
    db.expire_all()
    return db.scalars(select(ClassSession).where(ClassSession.template_id == template_id)
                      .order_by(ClassSession.starts_at)).all()


def _book(db, studio, session, n):
    c = Client(studio_id=studio.id, full_name=f"מתאמנת {n}", phone=f"05200000{n:02d}", email=f"m{n}@x.com")
    db.add(c)
    db.flush()
    db.add(ClassBooking(studio_id=studio.id, session_id=session.id, client_id=c.id))
    db.commit()
    return c


def _jobs(db, studio):
    db.expire_all()
    return db.scalars(select(MessageJob).where(MessageJob.studio_id == studio.id)).all()


def _local(moment):
    return moment.astimezone(svc.IL)


# ── the schedule ─────────────────────────────────────────────────────────────

def test_a_weekly_class_fills_eight_weeks_and_keeps_its_hour_when_the_clocks_change(client, db_session, clock):
    h, s = _business(client, db_session)
    room = _room(client, h)
    tpl = _template(client, h, room_id=room)
    assert tpl["capacity"] == 12 and tpl["is_course"] is False and tpl["future_sessions"] == 16

    sessions = _sessions(db_session, tpl["id"])
    assert [x.occurs_on.isoformat() for x in sessions[:3]] == ["2026-10-04", "2026-10-06", "2026-10-11"]
    assert sessions[-1].occurs_on == date(2026, 11, 24)                    # 8 weeks from 1 October
    assert {_local(x.starts_at).strftime("%H:%M") for x in sessions} == {"18:00"}
    utc_hours = {x.occurs_on: x.starts_at.astimezone(timezone.utc).hour for x in sessions}
    assert utc_hours[date(2026, 10, 20)] == 15 and utc_hours[date(2026, 10, 25)] == 16     # summer → winter time
    assert all(x.capacity == 12 and str(x.room_id) == room for x in sessions)

    template = db_session.get(ClassTemplate, sessions[0].template_id)
    assert svc.generate(db_session, template) == 0                         # running it again adds nothing


def test_a_short_course_ends_after_its_sessions_or_its_end_date(client, db_session, clock):
    h, _ = _business(client, db_session)
    five = _template(client, h, name="פילאטיס מתחילים", weekdays=[2], capacity=8, sessions_count=5)
    assert five["is_course"] is True
    assert [x.occurs_on.isoformat() for x in _sessions(db_session, five["id"])] == [
        "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03"]
    until = _template(client, h, name="סדנת נשימה", weekdays=[1], start_time="09:00", capacity=8, ends_on="2026-10-19")
    assert [x.occurs_on.isoformat() for x in _sessions(db_session, until["id"])] == ["2026-10-05", "2026-10-12", "2026-10-19"]


def test_the_nightly_job_keeps_the_window_the_owner_chose(client, db_session, clock):
    h, s = _business(client, db_session)
    assert client.patch("/api/classes/settings", headers=h, json={"values": {"weeks_ahead": 2}}).status_code == 200
    tpl = _template(client, h, weekdays=[0], capacity=10)
    assert [x.occurs_on.isoformat() for x in _sessions(db_session, tpl["id"])] == ["2026-10-04", "2026-10-11"]
    clock["now"] = NOW + timedelta(days=7)
    assert svc.generate_all(db_session) == 1
    assert _sessions(db_session, tpl["id"])[-1].occurs_on == date(2026, 10, 18)

    db_session.scalar(select(StudioModule).where(StudioModule.studio_id == s.id, StudioModule.module_id == "classes")).is_enabled = False
    db_session.commit()
    clock["now"] = NOW + timedelta(days=14)
    assert svc.generate_all(db_session) == 0                               # module off: nothing is added


# ── clashes ──────────────────────────────────────────────────────────────────

def test_a_busy_room_is_refused_and_a_busy_instructor_needs_confirmation(client, db_session, clock):
    h, s = _business(client, db_session)
    room = _room(client, h)
    _template(client, h, room_id=room, weekdays=[0])
    body = {"name": "יוגה", "weekdays": [0], "start_time": "18:30", "duration_minutes": 60,
            "starts_on": "2026-10-01", "room_id": room, "capacity": 10}
    check = client.post("/api/classes/templates", headers=h, json={**body, "dry_run": True}).json()
    assert len(check["clashes"]["room"]) == 8 and check["clashes"]["room"][0]["name"] == "פילאטיס מכשירים"
    refused = client.post("/api/classes/templates", headers=h, json=body)
    assert refused.status_code == 400 and "החדר תפוס" in refused.json()["detail"]

    owner = db_session.scalar(select(User).where(User.studio_id == s.id))
    c = Client(studio_id=s.id, full_name="לקוחה", phone="0501234567")
    db_session.add(c)
    db_session.flush()
    db_session.add(Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="אימון אישי",
                               starts_at=datetime(2026, 10, 5, 6, 0, tzinfo=timezone.utc),
                               ends_at=datetime(2026, 10, 5, 7, 0, tzinfo=timezone.utc)))
    db_session.commit()
    morning = {"name": "בוקר", "weekdays": [1], "start_time": "09:30", "duration_minutes": 45, "starts_on": "2026-10-01",
               "capacity": 6, "instructor_id": str(owner.id)}
    asked = client.post("/api/classes/templates", headers=h, json=morning)
    assert asked.status_code == 409 and "אימון אישי" in asked.json()["detail"]
    assert client.post("/api/classes/templates", headers=h, json={**morning, "confirm_clashes": True}).status_code == 200


# ── one class: cancel, change ────────────────────────────────────────────────

def test_cancelling_one_class_tells_everyone_booked_into_it_and_nobody_else(client, db_session, clock):
    h, s = _business(client, db_session)
    tpl = _template(client, h, capacity=10)
    tuesday, sunday = _sessions(db_session, tpl["id"])[1], _sessions(db_session, tpl["id"])[0]
    _book(db_session, s, tuesday, 1)
    _book(db_session, s, tuesday, 2)
    _book(db_session, s, sunday, 3)

    check = client.post(f"/api/classes/sessions/{tuesday.id}/cancel", headers=h, json={"dry_run": True}).json()
    assert check["booked"]["clients"] == 2 and _jobs(db_session, s) == []
    r = client.post(f"/api/classes/sessions/{tuesday.id}/cancel", headers=h, json={"reason": "המדריכה חולה"})
    assert r.status_code == 200 and r.json()["status"] == "canceled" and r.json()["messages"] == 4

    jobs = _jobs(db_session, s)
    assert sorted(j.to_phone for j in jobs if j.channel == "whatsapp") == ["0520000001", "0520000002"]
    wa = next(j for j in jobs if j.channel == "whatsapp")
    assert "פילאטיס מכשירים ב-6/10 בשעה 18:00" in wa.body and "השיעור בוטל. המדריכה חולה" in wa.body
    assert {j.reminder_type for j in jobs} == {"notify-class_changed"}
    assert {b.status for b in db_session.scalars(select(ClassBooking).where(ClassBooking.session_id == tuesday.id))} == {"canceled"}
    db_session.refresh(sunday)
    assert sunday.status == "scheduled"
    again = client.post(f"/api/classes/sessions/{tuesday.id}/cancel", headers=h, json={})
    assert again.status_code == 400 and len(_jobs(db_session, s)) == 4


def test_changing_one_class_tells_the_booked_what_changed_and_the_template_leaves_it_alone(client, db_session, clock):
    h, s = _business(client, db_session)
    a, b = _room(client, h, "סטודיו א", 12), _room(client, h, "סטודיו ב", 12)
    tpl = _template(client, h, room_id=a)
    tuesday = _sessions(db_session, tpl["id"])[1]
    _book(db_session, s, tuesday, 1)

    r = client.patch(f"/api/classes/sessions/{tuesday.id}", headers=h, json={"start_time": "19:00", "room_id": b})
    assert r.status_code == 200 and r.json()["messages"] == 2 and r.json()["detached"] is True
    wa = next(j for j in _jobs(db_session, s) if j.channel == "whatsapp")
    assert "ב-6/10 בשעה 18:00" in wa.body and "מועד חדש: 6/10 בשעה 19:00" in wa.body and "חדר: סטודיו ב" in wa.body

    client.patch(f"/api/classes/templates/{tpl['id']}", headers=h, json={"start_time": "17:00"})
    by_date = {x.occurs_on: x for x in _sessions(db_session, tpl["id"])}
    assert _local(by_date[date(2026, 10, 6)].starts_at).strftime("%H:%M") == "19:00"      # changed on its own: kept
    assert _local(by_date[date(2026, 10, 13)].starts_at).strftime("%H:%M") == "17:00"


def test_a_template_change_moves_free_classes_and_asks_before_touching_booked_ones(client, db_session, clock):
    h, s = _business(client, db_session)
    tpl = _template(client, h, capacity=10)
    booked = _sessions(db_session, tpl["id"])[1]
    _book(db_session, s, booked, 1)

    check = client.patch(f"/api/classes/templates/{tpl['id']}", headers=h, json={"start_time": "19:00", "dry_run": True}).json()
    assert check["booked"] == {"sessions": 1, "clients": 1}
    kept = client.patch(f"/api/classes/templates/{tpl['id']}", headers=h, json={"start_time": "19:00"}).json()
    assert kept["result"]["kept"] == 1 and _jobs(db_session, s) == []
    by_date = {x.occurs_on: x for x in _sessions(db_session, tpl["id"])}
    assert _local(by_date[date(2026, 10, 6)].starts_at).strftime("%H:%M") == "18:00" and by_date[date(2026, 10, 6)].detached
    assert _local(by_date[date(2026, 10, 4)].starts_at).strftime("%H:%M") == "19:00"

    other = _template(client, h, name="יוגה", weekdays=[3], start_time="08:00", capacity=10)
    wednesday = _sessions(db_session, other["id"])[0]
    _book(db_session, s, wednesday, 2)
    moved = client.patch(f"/api/classes/templates/{other['id']}", headers=h,
                         json={"start_time": "08:30", "apply_to_booked": True}).json()
    assert moved["result"]["messages"] == 2
    assert _local(_sessions(db_session, other["id"])[0].starts_at).strftime("%H:%M") == "08:30"

    fewer = client.patch(f"/api/classes/templates/{tpl['id']}", headers=h, json={"weekdays": [0]}).json()
    assert fewer["result"]["removed"] == 7                     # the free Tuesdays go; the booked one stays
    assert {x.occurs_on.weekday() for x in _sessions(db_session, tpl["id"])} == {6, 1}


def test_stopping_a_class_removes_free_sessions_and_keeps_or_cancels_booked_ones(client, db_session, clock):
    h, s = _business(client, db_session)
    tpl = _template(client, h, capacity=10)
    booked = _sessions(db_session, tpl["id"])[0]
    _book(db_session, s, booked, 1)
    r = client.post(f"/api/classes/templates/{tpl['id']}/stop", headers=h, json={}).json()
    assert r == {"removed": 15, "canceled": 0, "kept": 1, "messages": 0}
    assert [x.id for x in _sessions(db_session, tpl["id"])] == [booked.id]
    clock["now"] = NOW + timedelta(days=7)
    assert svc.generate_all(db_session) == 0
    assert client.get("/api/classes/templates", headers=h).json() == []


# ── who may, and whose ───────────────────────────────────────────────────────

def test_staff_cannot_set_up_classes_and_businesses_do_not_see_each_other(client, db_session, clock):
    h, s = _business(client, db_session)
    tpl = _template(client, h, capacity=10)
    session_id = _sessions(db_session, tpl["id"])[0].id

    h2, _ = _business(client, db_session, slug="gym-other")
    assert client.get(f"/api/classes/sessions/{session_id}", headers=h2).status_code == 404
    assert client.post(f"/api/classes/sessions/{session_id}/cancel", headers=h2, json={}).status_code == 404
    assert client.get("/api/classes/sessions?start=2026-10-01T00:00:00&end=2026-10-31T00:00:00", headers=h2).json() == []

    db_session.scalar(select(User).where(User.studio_id == s.id)).role = "staff"
    db_session.commit()
    assert client.get("/api/classes/sessions?start=2026-10-01T00:00:00&end=2026-10-08T00:00:00", headers=h).status_code == 200
    assert client.post(f"/api/classes/sessions/{session_id}/cancel", headers=h, json={}).status_code == 403
    assert client.post("/api/classes/templates", headers=h, json={"name": "x", "weekdays": [1], "start_time": "10:00",
                       "duration_minutes": 30, "starts_on": "2026-10-01", "capacity": 5}).status_code == 403


def test_classes_and_rooms_are_behind_their_modules(client, db_session, clock):
    h, _ = _business(client, db_session, slug="tattoo", modules=())
    assert client.get("/api/classes/templates", headers=h).status_code == 403
    h2, _ = _business(client, db_session, slug="yoga", modules=("classes",))
    assert client.get("/api/classes/rooms", headers=h2).status_code == 403
    tpl = _template(client, h2, capacity=10)                                  # a class without rooms works
    assert tpl["room_id"] is None
    import uuid
    bad = client.post("/api/classes/templates", headers=h2, json={
        "name": "x", "weekdays": [1], "start_time": "10:00", "duration_minutes": 30, "starts_on": "2026-10-01",
        "capacity": 5, "room_id": str(uuid.uuid4())})
    assert bad.status_code == 400 and "חדרים לא פעילים" in bad.json()["detail"]
