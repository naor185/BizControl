"""Classes extras 5 — check-in at the door with the business's QR code. A booked client who scans is marked as
attended; one who is not booked is offered the classes starting now that have a spot and that their
membership covers (the owner's choice) — one tap books and marks them; the code's key cannot be guessed and
can be replaced. Frozen clock; local test database; nothing is sent."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models.classes import ClassBooking
from tests.test_classes_bizfind import _customer
from tests.test_classes_stage4 import _book, _business, _client, _jobs, _sell, _sessions, _type, clock  # noqa: F401

SUNDAY_1745 = datetime(2026, 10, 4, 14, 45, tzinfo=timezone.utc)    # 15 minutes before Sunday's 18:00 class
SUNDAY_1600 = datetime(2026, 10, 4, 13, 0, tzinfo=timezone.utc)     # two hours before — not yet


def _setup(client, db, *, membership=True):
    h, s, t = _business(client, db, slug="pilates")
    first = _sessions(db, t["id"])[0]
    c = _client(db, s, 1)
    if membership:
        _sell(client, h, c, _type(client, h, name="חודשי", kind="unlimited", entries=None, duration_days=60))
    key = client.get("/api/classes/checkin-code", headers=h).json()["key"]
    return h, s, first, c, key, _customer(db, c.phone)


def _scan(client, me, key):
    return client.post("/api/marketplace/classes/pilates/checkin", headers=me, json={"key": key})


def test_the_code_is_secret_and_can_be_replaced(client, db_session, clock):
    h, s, first, c, key, me = _setup(client, db_session)
    assert len(key) >= 30 and client.get("/api/classes/checkin-code", headers=h).json()["key"] == key
    assert _scan(client, me, "guess").status_code == 404
    new = client.post("/api/classes/checkin-code/renew", headers=h).json()["key"]
    assert new != key
    assert _scan(client, me, key).status_code == 404                              # the old print stops working
    assert _scan(client, me, new).status_code == 200


def test_a_booked_client_who_scans_is_marked_as_attended(client, db_session, clock):
    h, s, first, c, key, me = _setup(client, db_session)
    assert _book(client, h, first, c).status_code == 200
    clock["now"] = SUNDAY_1745
    r = _scan(client, me, key).json()
    assert [x["session_id"] for x in r["checked_in"]] == [str(first.id)] and r["options"] == []
    db_session.expire_all()
    assert db_session.scalar(select(ClassBooking.status).where(ClassBooking.session_id == first.id)) == "attended"
    row = next(b for b in client.get(f"/api/classes/sessions/{first.id}", headers=h).json()["bookings"] if b["client_id"] == str(c.id))
    assert row["self_checkin"] is True
    again = _scan(client, me, key).json()
    assert again["checked_in"] == [] and [x["session_id"] for x in again["already"]] == [str(first.id)]


def test_a_client_who_is_not_booked_walks_in_with_one_tap(client, db_session, clock):
    h, s, first, c, key, me = _setup(client, db_session)
    clock["now"] = SUNDAY_1745
    r = _scan(client, me, key).json()
    assert r["checked_in"] == [] and [x["session_id"] for x in r["options"]] == [str(first.id)]
    done = client.post(f"/api/marketplace/classes/pilates/checkin/{first.id}", headers=me, json={"key": key})
    assert done.status_code == 200 and done.json()["checked_in"][0]["session_id"] == str(first.id)
    db_session.expire_all()
    assert db_session.scalar(select(ClassBooking.status).where(ClassBooking.session_id == first.id)) == "attended"
    assert _jobs(db_session, s, "class_booked") == []                             # at the door — no "you're booked" message


def test_no_walk_in_when_the_owner_says_so_or_without_a_membership(client, db_session, clock):
    h, s, first, c, key, me = _setup(client, db_session)
    client.patch("/api/classes/settings", headers=h, json={"values": {"checkin_walk_in": False}})
    clock["now"] = SUNDAY_1745
    assert _scan(client, me, key).json()["options"] == []
    r = client.post(f"/api/marketplace/classes/pilates/checkin/{first.id}", headers=me, json={"key": key})
    assert r.status_code == 400 and r.json()["detail"] == "הרשמה בכניסה"
    client.patch("/api/classes/settings", headers=h, json={"values": {"checkin_walk_in": True}})
    other = _client(db_session, s, 2)                                             # a client without a membership
    assert _scan(client, _customer(db_session, other.phone), key).json()["options"] == []


def test_only_in_the_owners_window_and_only_for_a_client(client, db_session, clock):
    h, s, first, c, key, me = _setup(client, db_session)
    _book(client, h, first, c)
    clock["now"] = SUNDAY_1600                                                    # 30 minutes before is the default
    assert _scan(client, me, key).json() == {"studio": "פילאטיס בלב", "checked_in": [], "already": [], "options": []}
    client.patch("/api/classes/settings", headers=h, json={"values": {"checkin_opens_minutes": 60}})
    clock["now"] = datetime(2026, 10, 4, 14, 5, tzinfo=timezone.utc)             # 55 minutes before
    assert len(_scan(client, me, key).json()["checked_in"]) == 1
    stranger = _customer(db_session, "0509999999")
    assert _scan(client, stranger, key).status_code == 403
