"""Classes & memberships, stage 6 — the waitlist of a full class. The plan's end-of-stage check: a full
class with people waiting; a cancellation moves the first up and tells them. Frozen clock; local test
database; nothing is sent."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.api.marketplace_customer_routes import _make_token
from app.models.classes import ClassBooking, ClassSession
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.wait_list import WaitListEntry
from app.services import class_waitlist as wl
from app.services import classes as svc
from tests.conftest import register_and_login

NOW = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)          # Thursday 1 Oct, 10:00 in Israel
SUNDAY_18 = datetime(2026, 10, 4, 15, 0, tzinfo=timezone.utc)


@pytest.fixture()
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(svc, "now_utc", lambda: state["now"])
    return state


def _business(client, db, modules=("classes", "memberships", "class_waitlist")):
    h = register_and_login(client, slug="pilates", email="owner@pilates.com")
    s = db.scalar(select(Studio).where(Studio.slug == "pilates"))
    s.name = "פילאטיס בלב"
    db.get(StudioSettings, s.id).marketplace_visible = True
    for m in modules:
        db.add(StudioModule(studio_id=s.id, module_id=m, is_enabled=True))
    db.commit()
    t = client.post("/api/classes/templates", headers=h, json={
        "name": "פילאטיס מכשירים", "weekdays": [0, 2], "start_time": "18:00", "duration_minutes": 55,
        "starts_on": "2026-10-01", "capacity": 1}).json()
    kind = client.post("/api/classes/membership-types", headers=h, json={"name": "חודשי", "kind": "unlimited", "duration_days": 60}).json()
    people = []
    for n in range(1, 5):
        c = Client(studio_id=s.id, full_name=f"מתאמנת {n}", phone=f"05000000{n:02d}")
        db.add(c)
        db.commit()
        m = client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": kind["id"]}).json()
        people.append((c, m))
    first = db.scalars(select(ClassSession).where(ClassSession.template_id == t["id"]).order_by(ClassSession.starts_at)).first()
    return h, s, first, people


def _book(client, h, session, c):
    return client.post(f"/api/classes/sessions/{session.id}/bookings", headers=h, json={"client_id": str(c.id)})


def _wait(client, h, session, c):
    return client.post(f"/api/classes/sessions/{session.id}/waitlist", headers=h, json={"client_id": str(c.id)})


def _session(client, h, session):
    return client.get(f"/api/classes/sessions/{session.id}", headers=h).json()


def _booking_of(client, h, session, c):
    return next(b for b in _session(client, h, session)["bookings"] if b["client_id"] == str(c.id))


def _messages(db, kind, phone=None):
    db.expire_all()
    q = select(MessageJob).where(MessageJob.reminder_type == f"notify-{kind}", MessageJob.channel == "whatsapp")
    if phone:
        q = q.where(MessageJob.to_phone == phone)
    return [j.body for j in db.scalars(q).all()]


def test_a_cancellation_books_the_first_in_line_who_may_still_cancel_free(client, db_session, clock):
    h, s, first, people = _business(client, db_session)
    (c1, _), (c2, _), (c3, _), _ = people
    _book(client, h, first, c1)
    assert _book(client, h, first, c2).json()["detail"] == "השיעור מלא"
    assert [w["full_name"] for w in _wait(client, h, first, c2).json()["waitlist"]] == ["מתאמנת 2"]
    line = _wait(client, h, first, c3).json()["waitlist"]
    assert [(w["full_name"], w["position"]) for w in line] == [("מתאמנת 2", 1), ("מתאמנת 3", 2)]
    assert _wait(client, h, first, c1).json()["detail"] == "כבר ברשימה של השיעור"

    client.post(f"/api/classes/bookings/{_booking_of(client, h, first, c1)['id']}/cancel", headers=h, json={})
    after = _session(client, h, first)
    assert [b["full_name"] for b in after["bookings"]] == ["מתאמנת 2"]
    assert [(w["full_name"], w["position"]) for w in after["waitlist"]] == [("מתאמנת 3", 1)]
    assert "נרשמת אוטומטית" in _messages(db_session, "waitlist_promoted", c2.phone)[0]
    assert _messages(db_session, "class_booked", c2.phone) == []              # one message, not two

    clock["now"] = SUNDAY_18 - timedelta(hours=1)                              # inside the free-cancel window
    cancelled = client.post(f"/api/classes/bookings/{_booking_of(client, h, first, c2)['id']}/cancel", headers=h, json={})
    assert str(c2.id) not in {b["client_id"] for b in cancelled.json()["bookings"]}   # not a late cancellation
    assert [b["full_name"] for b in _session(client, h, first)["bookings"]] == ["מתאמנת 3"]


def test_in_approval_mode_the_spot_is_held_then_passes_on_and_is_taken_on_bizfind(client, db_session, clock):
    h, s, first, people = _business(client, db_session)
    (c1, _), (c2, _), (c3, _), (c4, _) = people
    client.patch("/api/classes/settings", headers=h, json={"values": {"waitlist_mode": "approval"}})
    _book(client, h, first, c1)
    _wait(client, h, first, c2)
    _wait(client, h, first, c3)
    client.post(f"/api/classes/bookings/{_booking_of(client, h, first, c1)['id']}/cancel", headers=h, json={})
    line = _session(client, h, first)["waitlist"]
    assert [(w["full_name"], w["status"]) for w in line] == [("מתאמנת 2", "notified"), ("מתאמנת 3", "waiting")]
    assert "המקום שמור לך עד 10:30" in _messages(db_session, "waitlist_promoted", c2.phone)[0]
    assert _book(client, h, first, c4).json()["detail"] == "השיעור מלא"      # held for the one offered

    clock["now"] = NOW + timedelta(minutes=31)
    assert wl.sweep(db_session) == 1
    assert "הזמן לאישור המקום" in _messages(db_session, "waitlist_expiring", c2.phone)[0]
    line = _session(client, h, first)["waitlist"]
    assert [(w["full_name"], w["status"]) for w in line] == [("מתאמנת 3", "notified")]

    cid = str(uuid.uuid4())
    db_session.execute(text("INSERT INTO marketplace_customers (id, phone, first_name) VALUES (:id, :p, 'x')"), {"id": cid, "p": c3.phone})
    db_session.commit()
    me = {"Authorization": f"Bearer {_make_token(cid)}"}
    offer = client.get("/api/marketplace/classes/pilates/mine", headers=me).json()["waitlist"][0]
    assert offer["status"] == "notified"
    taken = client.post(f"/api/marketplace/classes/pilates/waitlist/{offer['id']}/confirm", headers=me)
    assert taken.status_code == 200 and taken.json()["message"] == "נרשמת! אישור נשלח אליך."
    assert [b["full_name"] for b in _session(client, h, first)["bookings"]] == ["מתאמנת 3"]


def test_a_frozen_waiter_is_skipped_and_keeps_their_place(client, db_session, clock):
    h, s, first, people = _business(client, db_session)
    (c1, _), (c2, m2), (c3, _), _ = people
    _book(client, h, first, c1)
    _wait(client, h, first, c2)
    _wait(client, h, first, c3)
    client.post(f"/api/classes/memberships/{m2['id']}/freeze", headers=h, json={"from_on": "2026-10-02", "until_on": "2026-10-12"})
    client.post(f"/api/classes/bookings/{_booking_of(client, h, first, c1)['id']}/cancel", headers=h, json={})
    after = _session(client, h, first)
    assert [b["full_name"] for b in after["bookings"]] == ["מתאמנת 3"]
    assert [(w["full_name"], w["status"]) for w in after["waitlist"]] == [("מתאמנת 2", "waiting")]


def test_nothing_moves_in_the_last_half_hour_and_the_line_clears_when_the_class_starts(client, db_session, clock):
    h, s, first, people = _business(client, db_session)
    (c1, _), (c2, _), _, _ = people
    _book(client, h, first, c1)
    _wait(client, h, first, c2)
    clock["now"] = SUNDAY_18 - timedelta(minutes=20)
    client.post(f"/api/classes/bookings/{_booking_of(client, h, first, c1)['id']}/cancel", headers=h, json={})
    assert all(b["status"] != "booked" for b in _session(client, h, first)["bookings"])          # nobody moved up
    assert [w["status"] for w in _session(client, h, first)["waitlist"]] == ["waiting"]
    assert _messages(db_session, "waitlist_promoted") == []
    clock["now"] = SUNDAY_18 + timedelta(minutes=1)
    wl.sweep(db_session)
    assert _session(client, h, first)["waitlist"] == []


def test_more_spots_move_the_line_up_and_a_cancelled_class_clears_it(client, db_session, clock):
    h, s, first, people = _business(client, db_session)
    (c1, _), (c2, _), (c3, _), _ = people
    _book(client, h, first, c1)
    _wait(client, h, first, c2)
    _wait(client, h, first, c3)
    client.patch(f"/api/classes/sessions/{first.id}", headers=h, json={"capacity": 2})
    assert [b["full_name"] for b in _session(client, h, first)["bookings"]] == ["מתאמנת 1", "מתאמנת 2"]
    client.post(f"/api/classes/sessions/{first.id}/cancel", headers=h, json={})
    db_session.expire_all()
    left = db_session.scalars(select(WaitListEntry).where(WaitListEntry.session_id == first.id)).all()
    assert [e.status for e in left if e.client_id == c3.id] == ["canceled"]


def test_the_limit_the_module_and_the_staff_moving_someone(client, db_session, clock):
    h, s, first, people = _business(client, db_session)
    (c1, _), (c2, _), (c3, _), (c4, _) = people
    assert _wait(client, h, first, c2).json()["detail"] == "יש מקום פנוי — אפשר להירשם"
    _book(client, h, first, c1)
    _wait(client, h, first, c2)
    _wait(client, h, first, c3)
    line = _wait(client, h, first, c4).json()["waitlist"]
    moved = client.post(f"/api/classes/waitlist/{line[2]['id']}/move", headers=h, json={"position": 1}).json()["waitlist"]
    assert [w["full_name"] for w in moved] == ["מתאמנת 4", "מתאמנת 2", "מתאמנת 3"]
    client.patch("/api/classes/settings", headers=h, json={"values": {"waitlist_max": 3}})
    left = client.post(f"/api/classes/waitlist/{moved[1]['id']}/leave", headers=h).json()["waitlist"]
    assert [w["position"] for w in left] == [1, 2]
    client.patch("/api/classes/settings", headers=h, json={"values": {"waitlist_max": 2}})
    assert _wait(client, h, first, people[1][0]).json()["detail"] == "רשימת ההמתנה מלאה"

    db_session.scalar(select(StudioModule).where(StudioModule.studio_id == s.id, StudioModule.module_id == "class_waitlist")).is_enabled = False
    db_session.commit()
    assert _session(client, h, first)["waitlist_enabled"] is False


def test_bizfind_offers_the_waitlist_only_to_someone_who_could_book(client, db_session, clock):
    h, s, first, people = _business(client, db_session)
    (c1, _), (c2, _), _, _ = people
    _book(client, h, first, c1)
    stranger = Client(studio_id=s.id, full_name="בלי מנוי", phone="0509999999")
    db_session.add(stranger)
    db_session.commit()
    headers = {}
    for c in (c2, stranger):
        cid = str(uuid.uuid4())
        db_session.execute(text("INSERT INTO marketplace_customers (id, phone, first_name) VALUES (:id, :p, 'x')"), {"id": cid, "p": c.phone})
        headers[c.id] = {"Authorization": f"Bearer {_make_token(cid)}"}
    db_session.commit()
    week = client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=headers[c2.id]).json()
    item = week["sessions"][0]
    assert (item["why_not"], item["waitlist"]["can_join"]) == ("השיעור מלא", True)
    other = client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=headers[stranger.id]).json()["sessions"][0]
    assert other["waitlist"]["can_join"] is False
    assert client.post(f"/api/marketplace/classes/pilates/sessions/{first.id}/waitlist", headers=headers[stranger.id]).json()["detail"] == "אין מנוי"

    joined = client.post(f"/api/marketplace/classes/pilates/sessions/{first.id}/waitlist", headers=headers[c2.id]).json()
    assert joined["message"].startswith("נכנסת לרשימת ההמתנה")
    mine = client.get("/api/marketplace/classes/pilates/mine", headers=headers[c2.id]).json()["waitlist"]
    assert [(w["status"], w["position"]) for w in mine] == [("waiting", 1)]
    client.post(f"/api/marketplace/classes/pilates/waitlist/{mine[0]['id']}/leave", headers=headers[c2.id])
    assert client.get("/api/marketplace/classes/pilates/mine", headers=headers[c2.id]).json()["waitlist"] == []


def test_the_appointment_waitlist_never_sees_class_waiters(client, db_session, clock):
    from app.api.wait_list_routes import notify_wait_list_on_cancellation
    h, s, first, people = _business(client, db_session, modules=("classes", "memberships", "class_waitlist", "wait_list"))
    (c1, _), (c2, _), _, _ = people
    _book(client, h, first, c1)
    _wait(client, h, first, c2)
    assert client.get("/api/wait-list", headers=h).json() == []
    assert notify_wait_list_on_cancellation(db_session, s.id) == 0
    db_session.expire_all()
    assert db_session.scalar(select(WaitListEntry.status).where(WaitListEntry.session_id == first.id)) == "waiting"
    assert db_session.scalar(select(ClassBooking.id).where(ClassBooking.client_id == c2.id)) is None
