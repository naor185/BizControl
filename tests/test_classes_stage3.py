"""Classes & memberships, stage 3 — bookings. The plan's end-of-stage checks: book a client, mark
attendance, cancel; a full class takes nobody beyond its spots; a class with too few booked cancels
itself and tells the people booked. Also: a pilates or gym business has its classes from signup
(the owner's decision, 2026-09-25). The clock is frozen; local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.classes import ClassBooking, ClassSession
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.notification import Notification
from app.models.studio import Studio
from app.models.user import User
from app.services import class_bookings as cb
from app.services import classes as svc
from app.services.business_types import enable_field_modules
from tests.conftest import register_and_login

NOW = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)          # Thursday 10:00 in Israel
SUNDAY_18 = datetime(2026, 10, 4, 15, 0, tzinfo=timezone.utc)    # the first class: Sunday 18:00 in Israel


@pytest.fixture()
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(svc, "now_utc", lambda: state["now"])
    return state


def _business(client, db, slug="pilates", capacity=10, **tpl):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.name, s.business_type = "פילאטיס בלב", "pilates"
    db.add(StudioModule(studio_id=s.id, module_id="classes", is_enabled=True))
    db.commit()
    body = {"name": "פילאטיס מכשירים", "weekdays": [0, 2], "start_time": "18:00", "duration_minutes": 55,
            "starts_on": "2026-10-01", "capacity": capacity, **tpl}
    t = client.post("/api/classes/templates", headers=h, json=body).json()
    sessions = db.scalars(select(ClassSession).where(ClassSession.template_id == t["id"]).order_by(ClassSession.starts_at)).all()
    return h, s, sessions


def _client(db, studio, n):
    c = Client(studio_id=studio.id, full_name=f"מתאמנת {n}", phone=f"05300000{n:02d}", email=f"b{n}@x.com")
    db.add(c)
    db.commit()
    return c


def _book(client, h, session, c, **extra):
    return client.post(f"/api/classes/sessions/{session.id}/bookings", headers=h, json={"client_id": str(c.id), **extra})


def _jobs(db, studio, kind=None):
    db.expire_all()
    q = select(MessageJob).where(MessageJob.studio_id == studio.id)
    if kind:
        q = q.where(MessageJob.reminder_type == f"notify-{kind}")
    return db.scalars(q).all()


# ── booking ──────────────────────────────────────────────────────────────────

def test_booking_confirms_and_a_full_class_takes_nobody_beyond_its_spots(client, db_session, clock):
    h, s, sessions = _business(client, db_session, capacity=2)
    first = sessions[0]
    c1, c2, c3 = (_client(db_session, s, n) for n in (1, 2, 3))

    r = _book(client, h, first, c1)
    assert r.status_code == 200 and r.json()["booked"] == 1 and r.json()["bookings"][0]["full_name"] == "מתאמנת 1"
    wa = [j for j in _jobs(db_session, s, "class_booked") if j.channel == "whatsapp"]
    assert len(wa) == 1 and "נרשמת לפילאטיס מכשירים ב-4/10 בשעה 18:00" in wa[0].body
    again = _book(client, h, first, c1)
    assert again.status_code == 400 and "כבר ברשימה" in again.json()["detail"]
    assert _book(client, h, first, c2).json()["booked"] == 2
    full = _book(client, h, first, c3)
    assert full.status_code == 409 and full.json()["detail"] == "השיעור מלא"

    over = _book(client, h, first, c3, over_capacity=True)                 # the owner may, on record
    assert over.status_code == 200 and over.json()["booked"] == 3
    assert [b["over_capacity"] for b in over.json()["bookings"]] == [False, False, True]

    db_session.scalar(select(User).where(User.studio_id == s.id)).role = "staff"
    db_session.commit()
    c4 = _client(db_session, s, 4)
    assert _book(client, h, sessions[1], c4).status_code == 200          # the front desk books
    assert _book(client, h, first, c4, over_capacity=True).status_code == 403


def test_a_late_cancellation_is_kept_and_can_be_waived_or_taken_back(client, db_session, clock):
    h, s, sessions = _business(client, db_session)
    first, later = sessions[0], sessions[3]
    c1, c2, c3 = (_client(db_session, s, n) for n in (1, 2, 3))
    ids = {}
    for c, sess in ((c1, first), (c2, first), (c3, later)):
        ids[c.id] = next(b["id"] for b in _book(client, h, sess, c).json()["bookings"] if b["client_id"] == str(c.id))

    on_time = client.post(f"/api/classes/bookings/{ids[c3.id]}/cancel", headers=h, json={}).json()
    assert on_time["bookings"] == []                                       # days before: simply cancelled
    clock["now"] = SUNDAY_18 - timedelta(hours=2)                          # inside the 6-hour window
    late = client.post(f"/api/classes/bookings/{ids[c1.id]}/cancel", headers=h, json={}).json()
    assert {b["client_id"]: b["status"] for b in late["bookings"]}[str(c1.id)] == "late_canceled"
    waived = client.post(f"/api/classes/bookings/{ids[c2.id]}/cancel", headers=h, json={"waive_late": True}).json()
    assert str(c2.id) not in {b["client_id"] for b in waived["bookings"]}
    assert len([j for j in _jobs(db_session, s, "booking_cancelled") if j.channel == "whatsapp"]) == 3

    back = _book(client, h, first, c1).json()                              # the late cancellation taken back
    assert [(b["id"], b["status"]) for b in back["bookings"]] == [(ids[c1.id], "booked")]


# ── attendance ───────────────────────────────────────────────────────────────

def test_attendance_from_an_hour_before_and_only_in_the_instructors_own_classes(client, db_session, clock):
    h, s, sessions = _business(client, db_session)
    first = sessions[0]
    c1, c2 = _client(db_session, s, 1), _client(db_session, s, 2)
    booked = {b["client_id"]: b["id"] for b in _book(client, h, first, c1).json()["bookings"]}
    booked.update({b["client_id"]: b["id"] for b in _book(client, h, first, c2).json()["bookings"]})

    early = client.post(f"/api/classes/bookings/{booked[str(c1.id)]}/attendance", headers=h, json={"status": "attended"})
    assert early.status_code == 400
    clock["now"] = SUNDAY_18 - timedelta(minutes=30)
    r = client.post(f"/api/classes/bookings/{booked[str(c1.id)]}/attendance", headers=h, json={"status": "no_show"})
    assert {b["client_id"]: b["status"] for b in r.json()["bookings"]}[str(c1.id)] == "no_show"
    everyone = client.post(f"/api/classes/sessions/{first.id}/attendance", headers=h).json()
    assert sorted(b["status"] for b in everyone["bookings"]) == ["attended", "no_show"] and everyone["booked"] == 2

    owner = db_session.scalar(select(User).where(User.studio_id == s.id))
    owner.role = "artist"                                                  # the one giving the class
    db_session.commit()
    assert client.post(f"/api/classes/bookings/{booked[str(c2.id)]}/attendance", headers=h,
                       json={"status": "no_show"}).status_code == 403      # not their class
    db_session.get(ClassSession, first.id).instructor_id = owner.id
    db_session.commit()
    assert client.post(f"/api/classes/bookings/{booked[str(c2.id)]}/attendance", headers=h,
                       json={"status": "no_show"}).status_code == 200


# ── before the class ─────────────────────────────────────────────────────────

def test_the_reminder_goes_once_to_everyone_booked_and_follows_the_owners_hours(client, db_session, clock):
    h, s, sessions = _business(client, db_session)
    first, second = sessions[0], sessions[1]
    for n in (1, 2):
        _book(client, h, first, _client(db_session, s, n))
    _book(client, h, second, _client(db_session, s, 3))

    clock["now"] = SUNDAY_18 - timedelta(hours=3, minutes=30)
    assert cb.sweep_reminders(db_session) == 0                             # default: 3 hours before
    clock["now"] = SUNDAY_18 - timedelta(hours=2, minutes=50)
    assert cb.sweep_reminders(db_session) == 4                             # 2 clients × WhatsApp + e-mail
    assert cb.sweep_reminders(db_session) == 0
    assert "תזכורת: פילאטיס מכשירים ב-4/10 בשעה 18:00" in [j for j in _jobs(db_session, s, "class_reminder") if j.channel == "whatsapp"][0].body

    client.patch("/api/classes/settings", headers=h, json={"values": {"reminder_hours": 0}})
    clock["now"] = second.starts_at - timedelta(hours=1)
    assert cb.sweep_reminders(db_session) == 0                             # the owner turned reminders off


def test_too_few_booked_cancels_the_class_by_itself_or_alerts_the_staff(client, db_session, clock):
    h, s, sessions = _business(client, db_session)
    first, second = sessions[0], sessions[1]
    for n in (1, 2):
        _book(client, h, first, _client(db_session, s, n))
    _book(client, h, second, _client(db_session, s, 3))
    client.patch("/api/classes/settings", headers=h, json={"values": {"min_participants": 3, "auto_cancel_below_min": True}})

    clock["now"] = SUNDAY_18 - timedelta(hours=4)
    assert cb.sweep_min_participants(db_session) == 0                      # checked 3 hours before
    clock["now"] = SUNDAY_18 - timedelta(hours=2, minutes=55)
    assert cb.sweep_min_participants(db_session) == 1
    db_session.expire_all()
    assert db_session.get(ClassSession, first.id).status == "auto_canceled"
    sent = [j for j in _jobs(db_session, s, "class_auto_cancel") if j.channel == "whatsapp"]
    assert len(sent) == 2 and "כי לא היו מספיק נרשמים" in sent[0].body
    assert {b.status for b in db_session.scalars(select(ClassBooking).where(ClassBooking.session_id == first.id))} == {"canceled"}
    assert cb.sweep_reminders(db_session) == 0                             # a cancelled class gets no reminder

    client.patch("/api/classes/settings", headers=h, json={"values": {"auto_cancel_below_min": False}})
    client.patch("/api/classes/notifications/class_at_risk", headers=h, json={"channel": "bell", "enabled": True})
    clock["now"] = second.starts_at - timedelta(hours=2)
    assert cb.sweep_min_participants(db_session) == 0
    bell = db_session.scalars(select(Notification).where(Notification.studio_id == s.id)).all()
    assert len(bell) == 1 and "רשומים 1 מתוך מינימום 3" in bell[0].body
    assert db_session.get(ClassSession, second.id).status == "scheduled"


# ── whose ────────────────────────────────────────────────────────────────────

def test_bookings_belong_to_one_business(client, db_session, clock):
    h, s, sessions = _business(client, db_session)
    c1 = _client(db_session, s, 1)
    booking_id = _book(client, h, sessions[0], c1).json()["bookings"][0]["id"]
    h2, s2, _ = _business(client, db_session, slug="gym-b")
    stranger = _client(db_session, s2, 9)
    assert _book(client, h2, sessions[0], stranger).status_code == 404
    assert _book(client, h, sessions[0], stranger).status_code == 404       # not this business's client
    assert client.post(f"/api/classes/bookings/{booking_id}/cancel", headers=h2, json={}).status_code == 404
    assert client.post(f"/api/classes/bookings/{booking_id}/attendance", headers=h2, json={"status": "attended"}).status_code == 404


# ── classes from signup ──────────────────────────────────────────────────────

def test_a_pilates_business_has_its_classes_from_signup_and_a_tattoo_studio_does_not(client, db_session):
    from app.models.module import Module, Plan, PlanModule
    from tests.conftest import SENT
    if not db_session.get(Plan, "trial"):
        # as in production (checked 2026-09-25): plans sell every module except the four class modules
        db_session.add(Plan(id="trial", display_name="ניסיון", trial_days=14))
        db_session.flush()
        for mid in db_session.scalars(select(Module.id)).all():
            if mid not in ("classes", "rooms", "memberships", "class_waitlist"):
                db_session.add(PlanModule(plan="trial", module_id=mid))
        db_session.commit()
    r = client.post("/api/marketplace/auth/register", json={
        "business_name": "פילאטיס בים", "category": "pilates", "city": "חיפה", "owner_name": "רותם כהן",
        "email": "rotem@pilatesyam.com", "password": "secret123", "plan_key": "trial"})
    assert r.status_code in (200, 201), r.text
    pilates = db_session.scalar(select(Studio).where(Studio.name == "פילאטיס בים"))
    on = set(db_session.scalars(select(StudioModule.module_id).where(StudioModule.studio_id == pilates.id,
                                                                     StudioModule.is_enabled.is_(True))).all())
    assert on == {"classes", "rooms", "memberships", "class_waitlist"}     # plan modules stay with the plan
    assert [to for _, to in SENT][:1] == ["rotem@pilatesyam.com"]          # signup's own e-mails (to the fake sender)
    SENT.clear()

    h = register_and_login(client, slug="ink", email="owner@ink.com")
    ink = db_session.scalar(select(Studio).where(Studio.slug == "ink"))
    assert enable_field_modules(db_session, ink.id, "tattoo") == []
    db_session.add(StudioModule(studio_id=ink.id, module_id="rooms", is_enabled=False))   # the superadmin said no
    db_session.commit()
    assert client.get("/api/classes/templates", headers=h).status_code == 403
    assert client.patch("/api/studio/upload/business-type", headers=h, json={"business_type": "gym"}).status_code == 200
    assert client.get("/api/classes/templates", headers=h).status_code == 200  # the new field's classes
    db_session.expire_all()
    rooms = db_session.scalar(select(StudioModule).where(StudioModule.studio_id == ink.id, StudioModule.module_id == "rooms"))
    assert rooms.is_enabled is False                                       # left as the superadmin set it
