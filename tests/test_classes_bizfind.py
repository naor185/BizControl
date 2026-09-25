"""Classes on BizFind — a client books and cancels group classes themselves. The owner's condition
(2026-09-25): only a client of the business (the BizFind customer's phone matches a client there) with a
membership that covers the class. Frozen clock; local test database; nothing is sent."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.api.marketplace_customer_routes import _make_token
from app.models.classes import ClassSession
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.studio import Studio
from app.services import classes as svc
from tests.conftest import register_and_login

NOW = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)          # Thursday 1 Oct, 10:00 in Israel
SUNDAY_18 = datetime(2026, 10, 4, 15, 0, tzinfo=timezone.utc)


@pytest.fixture()
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(svc, "now_utc", lambda: state["now"])
    return state


def _business(client, db, slug="pilates", capacity=10):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.name = "פילאטיס בלב"
    from app.models.studio_settings import StudioSettings
    db.get(StudioSettings, s.id).marketplace_visible = True                  # a business shown on BizFind
    for m in ("classes", "memberships"):
        db.add(StudioModule(studio_id=s.id, module_id=m, is_enabled=True))
    db.commit()
    t = client.post("/api/classes/templates", headers=h, json={
        "name": "פילאטיס מכשירים", "weekdays": [0, 2], "start_time": "18:00", "duration_minutes": 55,
        "starts_on": "2026-10-01", "capacity": capacity}).json()
    card = client.post("/api/classes/membership-types", headers=h, json={"name": "כרטיסייה 10", "kind": "punch", "entries": 10,
                                                                          "duration_days": 90}).json()
    return h, s, t, card


def _customer(db, phone):
    cid = str(uuid.uuid4())
    db.execute(text("INSERT INTO marketplace_customers (id, phone, first_name) VALUES (:id, :p, 'יעל')"), {"id": cid, "p": phone})
    db.commit()
    return {"Authorization": f"Bearer {_make_token(cid)}"}


def _client(db, studio, phone, name="יעל כהן"):
    c = Client(studio_id=studio.id, full_name=name, phone=phone, email="yael@x.com")
    db.add(c)
    db.commit()
    return c


def _sessions(db, template_id):
    db.expire_all()
    return db.scalars(select(ClassSession).where(ClassSession.template_id == template_id).order_by(ClassSession.starts_at)).all()


def _first(schedule):
    return schedule["sessions"][0]


def test_a_client_with_a_membership_books_and_cancels_on_bizfind(client, db_session, clock):
    h, s, t, card = _business(client, db_session)
    c = _client(db_session, s, "0501111111")
    client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": card["id"]})
    me = _customer(db_session, "0501111111")
    assert client.get("/api/marketplace/pilates").json()["has_classes"] is True

    week = client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=me).json()
    assert week["is_client"] is True and week["memberships"][0]["entries_left"] == 10
    first = _first(week)
    assert (first["name"], first["spots_left"], first["can_book"]) == ("פילאטיס מכשירים", 10, True)
    assert "full_name" not in str(week) and "יעל" not in str(week["sessions"])    # nobody's names, not even mine

    r = client.post(f"/api/marketplace/classes/pilates/sessions/{first['id']}/book", headers=me)
    assert r.status_code == 200 and r.json()["message"] == "נרשמת! אישור נשלח אליך."
    again = client.post(f"/api/marketplace/classes/pilates/sessions/{first['id']}/book", headers=me)
    assert again.status_code == 400 and again.json()["detail"] == "כבר נרשמת לשיעור הזה"
    db_session.expire_all()
    assert [j.to_phone for j in db_session.scalars(select(MessageJob).where(MessageJob.reminder_type == "notify-class_booked",
                                                                            MessageJob.channel == "whatsapp"))] == ["0501111111"]
    mine = client.get("/api/marketplace/classes/pilates/mine", headers=me).json()
    assert mine["memberships"][0]["entries_left"] == 9 and len(mine["upcoming"]) == 1
    assert mine["upcoming"][0]["late_if_cancel_now"] is False

    on_time = client.post(f"/api/marketplace/classes/pilates/bookings/{mine['upcoming'][0]['id']}/cancel", headers=me).json()
    assert on_time == {"status": "canceled", "late": False}
    assert client.get("/api/marketplace/classes/pilates/mine", headers=me).json()["memberships"][0]["entries_left"] == 10

    client.post(f"/api/marketplace/classes/pilates/sessions/{first['id']}/book", headers=me)
    clock["now"] = SUNDAY_18 - timedelta(hours=2)                           # inside the free-cancel window
    booking = client.get("/api/marketplace/classes/pilates/mine", headers=me).json()["upcoming"][0]
    assert booking["late_if_cancel_now"] is True
    late = client.post(f"/api/marketplace/classes/pilates/bookings/{booking['id']}/cancel", headers=me).json()
    assert late == {"status": "late_canceled", "late": True}
    assert client.get("/api/marketplace/classes/pilates/mine", headers=me).json()["memberships"][0]["entries_left"] == 9


def test_only_a_client_with_a_covering_membership_books_and_inside_the_window(client, db_session, clock):
    h, s, t, card = _business(client, db_session, capacity=1)
    stranger = _customer(db_session, "0509999999")
    week = client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=stranger).json()
    assert week["is_client"] is False and _first(week)["why_not"] == "ההרשמה לשיעורים פתוחה ללקוחות העסק עם מנוי"
    assert client.post(f"/api/marketplace/classes/pilates/sessions/{_first(week)['id']}/book", headers=stranger).status_code == 403

    _client(db_session, s, "0502222222", "רוני")
    no_card = _customer(db_session, "0502222222")
    first = _first(client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=no_card).json())
    assert first["why_not"] == "אין מנוי"
    refused = client.post(f"/api/marketplace/classes/pilates/sessions/{first['id']}/book", headers=no_card)
    assert refused.status_code == 400 and refused.json()["detail"] == "אין מנוי"

    a, b = _client(db_session, s, "0503333333", "מיכל"), _client(db_session, s, "0504444444", "שירה")
    for c in (a, b):
        client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": card["id"]})
    first_id = _first(client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=no_card).json())["id"]
    michal, shira = _customer(db_session, "0503333333"), _customer(db_session, "0504444444")
    assert client.post(f"/api/marketplace/classes/pilates/sessions/{first_id}/book", headers=michal).status_code == 200
    full = _first(client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=shira).json())
    assert (full["spots_left"], full["why_not"]) == (0, "השיעור מלא")

    far = client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-25", headers=shira).json()
    assert _first(far)["why_not"].startswith("ההרשמה נפתחת ב-11/10")            # 14 days before 25/10
    clock["now"] = SUNDAY_18 - timedelta(minutes=10)
    closing = _first(client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=shira).json())
    assert closing["why_not"] == "ההרשמה לשיעור הזה נסגרה"


def test_the_owner_can_close_it_and_a_client_touches_only_their_own(client, db_session, clock):
    h, s, t, card = _business(client, db_session)
    c = _client(db_session, s, "0501111111")
    client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": card["id"]})
    me = _customer(db_session, "0501111111")
    assert client.get("/api/marketplace/classes/pilates/schedule", headers={}).status_code == 401

    other = _client(db_session, s, "0505555555", "אחרת")
    client.post("/api/classes/memberships", headers=h, json={"client_id": str(other.id), "type_id": card["id"]})
    theirs = _customer(db_session, "0505555555")
    first = _first(client.get("/api/marketplace/classes/pilates/schedule?week=2026-10-04", headers=theirs).json())
    client.post(f"/api/marketplace/classes/pilates/sessions/{first['id']}/book", headers=theirs)
    their_booking = client.get("/api/marketplace/classes/pilates/mine", headers=theirs).json()["upcoming"][0]["id"]
    assert client.post(f"/api/marketplace/classes/pilates/bookings/{their_booking}/cancel", headers=me).status_code == 404

    client.patch("/api/classes/settings", headers=h, json={"values": {"client_booking": False}})
    assert client.get("/api/marketplace/pilates").json()["has_classes"] is False
    assert client.get("/api/marketplace/classes/pilates/schedule", headers=me).status_code == 404
