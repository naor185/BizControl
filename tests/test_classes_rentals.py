"""Classes extras 7 — renting a room out, every rule the owner's: by the hour or a fixed price a booking, the
shortest rental, a regular renter's weekly series (at a discount), a package of hours, and the late-cancel
charge (all / half / nothing, waived by the owner). A rental and a class never take the same room at the same
time. Payments are recorded with a receipt; the month renter by renter. Frozen clock; local test database;
nothing is sent."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models.classes import RoomRental
from app.models.module import StudioModule
from tests.test_classes_stage4 import _business, _client, _jobs, clock  # noqa: F401

FRIDAY_0900 = datetime(2026, 10, 2, 6, 0, tzinfo=timezone.utc)      # an hour before Friday's 10:00 rental


def _room(client, db, h, s, **rules):
    db.add(StudioModule(studio_id=s.id, module_id="rooms", is_enabled=True))
    db.commit()
    room = client.post("/api/classes/rooms", headers=h, json={"name": "הסטודיו הגדול", "capacity": 12}).json()
    r = client.patch(f"/api/classes/rooms/{room['id']}", headers=h, json={
        "rental_enabled": True, "rental_pricing": "hourly", "rental_hour_cents": 8000, "rental_min_minutes": 60, **rules})
    assert r.status_code == 200, r.text
    return r.json()


def _rent(client, h, room, c, day="2026-10-02", at="10:00", minutes=90):
    return client.post("/api/classes/rentals", headers=h, json={"room_id": room["id"], "client_id": str(c.id), "day": day,
                                                               "start_time": at, "duration_minutes": minutes})


def test_the_price_is_the_owners_and_the_renter_is_told(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    room = _room(client, db_session, h, s)
    renter = _client(db_session, s, 1)
    r = _rent(client, h, room, renter)
    assert r.status_code == 200 and r.json()["price_cents"] == 12000            # 1.5 hours at ₪80
    assert "₪120" in _jobs(db_session, s, "room_rental_booked")[0].body
    short = _rent(client, h, room, renter, day="2026-10-03", minutes=30)
    assert short.status_code == 400 and short.json()["detail"] == "השכרה לפחות 60 דקות"
    client.patch(f"/api/classes/rooms/{room['id']}", headers=h, json={"rental_pricing": "per_booking", "rental_booking_cents": 15000})
    assert _rent(client, h, room, renter, day="2026-10-03").json()["price_cents"] == 15000


def test_a_rental_and_a_class_never_take_the_room_at_the_same_time(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    room = _room(client, db_session, h, s)
    renter, other = _client(db_session, s, 1), _client(db_session, s, 2)
    client.post("/api/classes/templates", headers=h, json={"name": "יוגה", "weekdays": [0], "start_time": "18:00", "duration_minutes": 60,
                                                          "starts_on": "2026-10-01", "capacity": 10, "room_id": room["id"]})
    r = _rent(client, h, room, renter, day="2026-10-04", at="17:30", minutes=60)
    assert r.status_code == 409 and "החדר תפוס" in r.json()["detail"]
    assert _rent(client, h, room, renter, day="2026-10-06", at="10:00", minutes=120).status_code == 200
    assert _rent(client, h, room, other, day="2026-10-06", at="11:00", minutes=60).status_code == 409   # another rental
    once = client.post("/api/classes/templates", headers=h, json={"name": "סדנה", "weekdays": [2], "start_time": "10:30", "duration_minutes": 60,
                                                                 "starts_on": "2026-10-06", "sessions_count": 1, "capacity": 8, "room_id": room["id"]})
    assert once.status_code == 400 and "השכרה" in once.json()["detail"]                             # a class sees the rental too


def test_cancelling_by_the_owners_rule(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    room = _room(client, db_session, h, s, rental_free_cancel_hours=24, rental_late_fee="half")
    renter = _client(db_session, s, 1)
    early = _rent(client, h, room, renter, day="2026-10-05").json()
    assert client.post(f"/api/classes/rentals/{early['id']}/cancel", headers=h, json={}).json()["status"] == "canceled"
    late = _rent(client, h, room, renter).json()                                # Friday 10:00
    clock["now"] = FRIDAY_0900
    done = client.post(f"/api/classes/rentals/{late['id']}/cancel", headers=h, json={}).json()
    assert (done["status"], done["fee_cents"], done["charge_cents"]) == ("late_canceled", 6000, 6000)   # half of ₪120
    assert "₪60" in _jobs(db_session, s, "room_rental_canceled")[-1].body
    waived = _rent(client, h, room, renter, day="2026-10-02", at="12:00").json()
    assert client.post(f"/api/classes/rentals/{waived['id']}/cancel", headers=h, json={"waive": True}).json()["fee_cents"] == 0


def test_a_regular_renter_every_week_at_the_owners_discount(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    room = _room(client, db_session, h, s, rental_series_discount_percent=10)
    renter, other = _client(db_session, s, 1), _client(db_session, s, 2)
    _rent(client, h, room, other, day="2026-10-13", at="10:00", minutes=60)       # one Tuesday is taken
    series = dict(room_id=room["id"], client_id=str(renter.id), weekday=2, start_time="10:00", duration_minutes=120, starts_on="2026-10-01")
    preview = client.post("/api/classes/rental-series", headers=h, json={**series, "dry_run": True}).json()
    assert preview["taken"] == ["2026-10-13"]
    made = client.post("/api/classes/rental-series", headers=h, json=series).json()
    assert made["skipped"] == ["2026-10-13"] and made["made"] >= 7
    rows = db_session.scalars(select(RoomRental).where(RoomRental.client_id == renter.id)).all()
    assert {r.price_cents for r in rows} == {14400}                             # 2 hours at ₪80, 10% off
    stopped = client.post(f"/api/classes/rental-series/{made['id']}/stop", headers=h, json={"cancel_coming": True}).json()
    assert stopped["canceled"] == len(rows)
    db_session.expire_all()
    assert {r.fee_cents for r in db_session.scalars(select(RoomRental).where(RoomRental.client_id == renter.id)).all()} == {0}


def test_a_package_of_hours_payments_and_the_month(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    room = _room(client, db_session, h, s, rental_package_hours=10, rental_package_cents=70000)
    renter, casual = _client(db_session, s, 1), _client(db_session, s, 2)
    pkg = client.post("/api/classes/rental-packages", headers=h, json={"room_id": room["id"], "client_id": str(renter.id)}).json()
    assert pkg["minutes_left"] == 600
    r = _rent(client, h, room, renter, minutes=120).json()
    assert r["from_package"] and r["price_cents"] == 0
    assert client.get(f"/api/classes/rental-packages?client_id={renter.id}", headers=h).json()[0]["minutes_left"] == 480
    client.post(f"/api/classes/rental-packages/{pkg['id']}/payments", headers=h, json={"amount_cents": 70000, "method": "bit", "send_receipt": False})
    c = _rent(client, h, room, casual, day="2026-10-03").json()
    paid = client.post(f"/api/classes/rentals/{c['id']}/payments", headers=h, json={"amount_cents": 5000, "method": "cash", "send_receipt": False}).json()
    assert paid["paid_cents"] == 5000
    month = {x["full_name"]: x for x in client.get("/api/classes/rentals/summary?month=2026-10-01", headers=h).json()}
    assert (month[renter.full_name]["charged"], month[renter.full_name]["paid"], month[renter.full_name]["due"]) == (70000, 70000, 0)
    assert month[renter.full_name]["package_minutes_left"] == 480
    assert (month[casual.full_name]["charged"], month[casual.full_name]["due"]) == (12000, 7000)


def test_only_a_room_the_owner_rents_out(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    room = _room(client, db_session, h, s, rental_enabled=False)
    r = _rent(client, h, room, _client(db_session, s, 1))
    assert r.status_code == 400 and r.json()["detail"] == "החדר הזה לא מושכר"
