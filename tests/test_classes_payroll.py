"""Classes extras 1 — pay for teaching group classes, the owner's choice for each staff member, on top of the
regular pay: a sum per class, per participant (with a minimum), both, or a percentage of the class's
single-entry payments. Counted: classes that took place (started, not cancelled) that this staff member taught
— a substitute is the one paid. Everyone's pay is for the owner and the managers only.
Frozen clock; local test database; nothing is sent."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models.user import User
from tests.test_classes_stage4 import _book, _booking, _business, _client, _sessions, clock  # noqa: F401

AFTER_TWO = datetime(2026, 10, 7, 9, 0, tzinfo=timezone.utc)       # Wed 7 Oct — Sun 4 and Tue 6 took place
OCTOBER = {"start_date": "2026-10-01T00:00:00", "end_date": "2026-10-31T23:59:59"}


def _teacher(client, h, email="noa@pilates.com", **pay):
    r = client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123", "display_name": "נועה",
                                                          "role": "artist", **pay})
    assert r.status_code == 201, r.text
    return r.json()


def _setup(client, db, **pay):
    """A pilates business; its classes taught by the new instructor; Sun 4 Oct: 3 booked (2 attended, 1 no-show),
    Tue 6 Oct: 1 booked, attendance not marked; Sun 11 Oct is still to come."""
    h, s, t = _business(client, db)
    teacher = _teacher(client, h, **pay)
    sessions = _sessions(db, t["id"])
    for x in sessions:
        x.instructor_id = teacher["id"]
    db.commit()
    first, second = sessions[0], sessions[1]
    people = [_client(db, s, n) for n in range(1, 5)]
    b = [_booking(_book(client, h, first, c, drop_in=True), c)["id"] for c in people[:3]]
    _book(client, h, second, people[3], drop_in=True)
    return h, s, teacher, sessions, b


def _row(client, h, user_id):
    r = client.get("/api/staff/payroll", headers=h, params=OCTOBER)
    assert r.status_code == 200, r.text
    return next(i for i in r.json()["items"] if i["user_id"] == user_id)


def _attendance(client, h, bookings):
    for bid, status in bookings:
        assert client.post(f"/api/classes/bookings/{bid}/attendance", headers=h, json={"status": status}).status_code == 200


def test_a_sum_per_class_counts_the_classes_that_took_place(client, db_session, clock):
    h, s, teacher, sessions, _ = _setup(client, db_session, class_pay_mode="per_class", class_pay_per_class=150)
    clock["now"] = AFTER_TWO
    row = _row(client, h, teacher["id"])
    assert row["class_count"] == 2 and float(row["class_pay"]) == 300.0        # Sun 4 and Tue 6, not the ones still to come
    assert float(row["total_pay"]) == 300.0
    clock["now"] = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)
    assert client.post(f"/api/classes/sessions/{sessions[1].id}/cancel", headers=h, json={}).status_code == 200
    clock["now"] = AFTER_TWO
    row = _row(client, h, teacher["id"])
    assert row["class_count"] == 1 and float(row["class_pay"]) == 150.0        # the cancelled Tuesday is not paid
    pdf = client.get("/api/staff/payroll/pdf", headers=h, params=OCTOBER)             # its own column in the PDF
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_per_participant_with_a_minimum_counts_attended_or_everyone_booked(client, db_session, clock):
    h, s, teacher, sessions, b = _setup(client, db_session, class_pay_mode="per_participant",
                                        class_pay_per_participant=20, class_pay_minimum=50)
    clock["now"] = AFTER_TWO
    _attendance(client, h, [(b[0], "attended"), (b[1], "attended"), (b[2], "no_show")])
    row = _row(client, h, teacher["id"])
    assert row["class_participants"] == 2 and float(row["class_pay"]) == 100.0      # max(50, 2×20) + max(50, 0)
    assert client.patch(f"/api/users/artists/{teacher['id']}", headers=h, json={"class_pay_counts": "booked"}).status_code == 200
    row = _row(client, h, teacher["id"])
    assert row["class_participants"] == 4 and float(row["class_pay"]) == 110.0      # 3×20 + max(50, 1×20)


def test_a_sum_plus_per_participant_and_a_substitute_is_the_one_paid(client, db_session, clock):
    h, s, teacher, sessions, b = _setup(client, db_session, class_pay_mode="both", class_pay_per_class=100,
                                        class_pay_per_participant=10, class_pay_counts="booked")
    sub = _teacher(client, h, email="dana@pilates.com", class_pay_mode="per_class", class_pay_per_class=120)
    r = client.patch(f"/api/classes/sessions/{sessions[1].id}", headers=h, json={"instructor_id": sub["id"]})
    assert r.status_code == 200, r.text
    clock["now"] = AFTER_TWO
    assert float(_row(client, h, teacher["id"])["class_pay"]) == 130.0              # Sunday: 100 + 3×10
    assert float(_row(client, h, sub["id"])["class_pay"]) == 120.0                  # Tuesday, as the substitute


def test_a_percentage_of_the_classs_single_entry_payments(client, db_session, clock):
    h, s, teacher, sessions, b = _setup(client, db_session, class_pay_mode="percent", class_pay_percent=50)
    for bid in b[:2]:
        client.post(f"/api/classes/bookings/{bid}/payments", headers=h, json={"amount_cents": 8000, "method": "cash", "send_receipt": False})
    clock["now"] = AFTER_TWO
    assert float(_row(client, h, teacher["id"])["class_pay"]) == 80.0               # 50% of ₪160


def test_the_owners_values_are_checked(client, db_session, clock):
    h, s, t = _business(client, db_session)
    teacher = _teacher(client, h)
    assert teacher["class_pay_mode"] == "none"                                        # nothing until the owner chooses
    for bad in ({"class_pay_mode": "per_hour"}, {"class_pay_percent": 150}, {"class_pay_per_class": -5}, {"class_pay_counts": "all"}):
        assert client.patch(f"/api/users/artists/{teacher['id']}", headers=h, json=bad).status_code == 422, bad


def test_only_the_owner_and_managers_see_pay(client, db_session, clock):
    h, s, t = _business(client, db_session)
    _teacher(client, h, class_pay_mode="per_class", class_pay_per_class=150, hourly_rate=60, pay_type="hourly")
    assert any(u["class_pay_mode"] == "per_class" for u in client.get("/api/users/artists", headers=h).json())
    me = db_session.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
    me.role = "staff"
    db_session.commit()
    assert client.get("/api/staff/payroll", headers=h, params=OCTOBER).status_code == 403
    listed = client.get("/api/users/artists", headers=h).json()
    assert listed and all(u["class_pay_mode"] == "none" and u["hourly_rate"] == 0 for u in listed)   # names, not pay
