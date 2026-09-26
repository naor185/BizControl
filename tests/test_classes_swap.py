"""Classes extras 2 — moving a booking to another class in one step (a class swap), by the staff or by the
client on BizFind. The entry moves with it (the card never pays twice, never loses one), a swap is never a
late cancellation, a single entry's payment moves too, the freed spot goes to the waitlist, and a refusal
changes nothing. The client's own swaps follow the owner's rule (class_swap).
Frozen clock; local test database; nothing is sent."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models.classes import ClassBooking
from app.models.payment import Payment
from tests import test_classes_bizfind as bf
from tests import test_classes_stage6 as s6
from tests.test_classes_stage4 import _balance, _book, _booking, _business, _client, _jobs, _sell, _sessions, _type, clock  # noqa: F401

SUNDAY_13 = datetime(2026, 10, 4, 10, 0, tzinfo=timezone.utc)      # 13:00 in Israel — inside Sunday 18:00's late window


def _swap(client, h, booking_id, session):
    return client.post(f"/api/classes/bookings/{booking_id}/swap", headers=h, json={"session_id": str(session.id)})


def _active(db, session, c):
    db.expire_all()
    return db.scalar(select(ClassBooking).where(ClassBooking.session_id == session.id, ClassBooking.client_id == c.id,
                                                ClassBooking.status == "booked"))


def test_the_staff_move_a_booking_with_its_entry_even_late_and_without_a_fee(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first, second = _sessions(db_session, t["id"])[:2]
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    old = _booking(_book(client, h, first, c), c)["id"]
    client.put("/api/classes/penalty-rules", headers=h, json={"rules": [{"event": "late_cancel", "action": "fixed", "amount_cents": 5000}]})
    options = client.get(f"/api/classes/bookings/{old}/swap-options", headers=h).json()
    assert options["allowed"] and next(o for o in options["sessions"] if o["id"] == str(second.id))["can_swap"]

    clock["now"] = SUNDAY_13                                        # late for a cancellation — not for a swap
    r = _swap(client, h, old, second)
    assert r.status_code == 200, r.text
    assert _active(db_session, first, c) is None
    new = _active(db_session, second, c)
    assert new is not None and str(new.swapped_from_booking_id) == old
    assert db_session.get(ClassBooking, old).cancel_reason == "swapped"
    assert _balance(client, h, card["id"]) == {"total": 10, "reserved": 1, "consumed": 0, "available": 9}   # one entry, moved
    assert client.get("/api/classes/fees", headers=h).json() == []                                           # no fee
    assert len(_jobs(db_session, s, "class_swapped")) == 1 and len(_jobs(db_session, s, "class_booked")) == 1
    assert "הועברה" in _jobs(db_session, s, "class_swapped")[0].body


def test_the_cards_last_entry_can_pay_for_the_new_class(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first, second = _sessions(db_session, t["id"])[:2]
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h, entries=1))
    old = _booking(_book(client, h, first, c), c)["id"]
    assert _balance(client, h, card["id"])["available"] == 0
    assert next(o for o in client.get(f"/api/classes/bookings/{old}/swap-options", headers=h).json()["sessions"]
                if o["id"] == str(second.id))["can_swap"]
    assert _swap(client, h, old, second).status_code == 200
    assert _balance(client, h, card["id"])["available"] == 0 and _active(db_session, second, c) is not None


def test_a_refused_swap_changes_nothing(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first, second = _sessions(db_session, t["id"])[:2]
    c, other = _client(db_session, s, 1), _client(db_session, s, 2)
    card = _sell(client, h, c, _type(client, h))
    _sell(client, h, other, _type(client, h, name="כרטיסייה 5", entries=5))
    old = _booking(_book(client, h, first, c), c)["id"]
    assert client.patch(f"/api/classes/sessions/{second.id}", headers=h, json={"capacity": 1}).status_code == 200
    _book(client, h, second, other)                                  # the second class is now full
    r = _swap(client, h, old, second)
    assert r.status_code == 400 and r.json()["detail"] == "השיעור מלא"
    assert _active(db_session, first, c) is not None                 # still in the first class
    assert _balance(client, h, card["id"])["available"] == 9
    assert _jobs(db_session, s, "class_swapped") == []


def test_a_single_entry_moves_with_its_payment(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first, second = _sessions(db_session, t["id"])[:2]
    walk_in = _client(db_session, s, 1)
    old = _booking(_book(client, h, first, walk_in, drop_in=True), walk_in)["id"]
    client.post(f"/api/classes/bookings/{old}/payments", headers=h, json={"amount_cents": 8000, "method": "cash", "send_receipt": False})
    assert _swap(client, h, old, second).status_code == 200
    new = _active(db_session, second, walk_in)
    assert new.drop_in and db_session.scalar(select(Payment.class_booking_id).where(Payment.client_id == walk_in.id)) == new.id
    session = client.get(f"/api/classes/sessions/{second.id}", headers=h).json()
    assert _booking(session, walk_in)["paid_cents"] == 8000


def test_the_freed_spot_goes_to_the_first_in_the_waitlist(client, db_session, clock):
    h, s, first, people = s6._business(client, db_session)          # a class of one spot
    (c1, _), (c2, _) = people[0], people[1]
    second = _sessions(db_session, first.template_id)[1]
    old = _booking(s6._book(client, h, first, c1), c1)["id"]
    assert s6._wait(client, h, first, c2).status_code == 200
    assert _swap(client, h, old, second).status_code == 200
    assert _active(db_session, first, c2) is not None                # moved up by itself (the owner's "auto")


def test_a_client_swaps_on_bizfind_by_the_owners_rule(client, db_session, clock):
    h, s, t, card = bf._business(client, db_session)
    c = bf._client(db_session, s, "0501111111")
    client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": card["id"]})
    me = bf._customer(db_session, "0501111111")
    first, second, third = bf._sessions(db_session, t["id"])[:3]
    assert client.post(f"/api/marketplace/classes/pilates/sessions/{first.id}/book", headers=me).status_code == 200
    mine = client.get("/api/marketplace/classes/pilates/mine", headers=me).json()["upcoming"][0]
    assert mine["can_swap"] is True
    options = client.get(f"/api/marketplace/classes/pilates/bookings/{mine['id']}/swap-options", headers=me).json()
    assert next(o for o in options["sessions"] if o["id"] == str(second.id))["can_swap"]

    clock["now"] = SUNDAY_13                                        # by default: only while cancelling is free
    r = client.post(f"/api/marketplace/classes/pilates/bookings/{mine['id']}/swap", headers=me, json={"session_id": str(second.id)})
    assert r.status_code == 400 and r.json()["detail"] == "כבר מאוחר להחליף את השיעור הזה"
    assert client.get("/api/marketplace/classes/pilates/mine", headers=me).json()["upcoming"][0]["can_swap"] is False

    client.patch("/api/classes/settings", headers=h, json={"values": {"class_swap": "until_start"}})
    r = client.post(f"/api/marketplace/classes/pilates/bookings/{mine['id']}/swap", headers=me, json={"session_id": str(second.id)})
    assert r.status_code == 200 and r.json()["message"].startswith("ההרשמה הועברה")
    moved = client.get("/api/marketplace/classes/pilates/mine", headers=me).json()["upcoming"][0]
    assert moved["session_id"] == str(second.id)

    client.patch("/api/classes/settings", headers=h, json={"values": {"class_swap": "off"}})
    r = client.post(f"/api/marketplace/classes/pilates/bookings/{moved['id']}/swap", headers=me, json={"session_id": str(third.id)})
    assert r.status_code == 400 and r.json()["detail"] == "החלפת שיעור אפשרית רק דרך העסק"
    other = bf._client(db_session, s, "0502222222", name="רון")
    other_booking = _booking(_book(client, h, third, other, drop_in=True), other)["id"]
    r = client.post(f"/api/marketplace/classes/pilates/bookings/{other_booking}/swap", headers=me, json={"session_id": str(first.id)})
    assert r.status_code == 404                                      # someone else's booking
