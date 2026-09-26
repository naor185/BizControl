"""Classes extras 4 (part 1) — a course: one registration and one price for all its sessions. Enrolling books
every coming session at once (all or nothing); a single session only when the owner allows it; joining late
at the owner's rule; a payment and a refund recorded on the registration; cancelling it cancels the coming
sessions and works out the refund by the owner's rule; a course session has no late-cancel / no-show fee.
Frozen clock; local test database; nothing is sent."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models.classes import ClassBooking
from app.models.memberships import ClassFee
from app.models.module import StudioModule
from app.models.payment import Payment
from tests.test_classes_stage4 import _balance, _book, _business, _client, _jobs, _sell, _sessions, _type, clock  # noqa: F401

MONDAY_5 = datetime(2026, 10, 5, 7, 0, tzinfo=timezone.utc)        # after the first session (Sunday 4 Oct 18:00)
SUNDAY_4_13 = datetime(2026, 10, 4, 10, 0, tzinfo=timezone.utc)     # 13:00 — inside the first session's late window


def _course(client, h, **extra):
    """Four Sundays at 18:00 (4, 11, 18, 25 Oct), three spots, ₪400 for all of it."""
    r = client.post("/api/classes/templates", headers=h, json={
        "name": "קורס פילאטיס למתחילים", "weekdays": [0], "start_time": "18:00", "duration_minutes": 60,
        "starts_on": "2026-10-01", "sessions_count": 4, "capacity": 3, "course_price_cents": 40000, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _enroll(client, h, t, c, **extra):
    return client.post(f"/api/classes/courses/{t['id']}/enrollments", headers=h, json={"client_id": str(c.id), **extra})


def _mine(r, c):
    return next(e for e in r.json()["enrollments"] if e["client_id"] == str(c.id))


def _set(client, h, **values):
    assert client.patch("/api/classes/settings", headers=h, json={"values": values}).status_code == 200


def _pay(client, h, e, cents, method="cash"):
    return client.post(f"/api/classes/enrollments/{e['id']}/payments", headers=h,
                       json={"amount_cents": cents, "method": method, "send_receipt": False})


def test_enrolling_books_every_session_at_one_price(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    t = _course(client, h)
    assert t["is_course"] and t["course_price_cents"] == 40000
    c = _client(db_session, s, 1)
    r = _enroll(client, h, t, c)
    assert r.status_code == 200, r.text
    e = _mine(r, c)
    assert (e["status"], e["price_cents"], e["sessions_total"]) == ("active", 40000, 4)
    bookings = db_session.scalars(select(ClassBooking).where(ClassBooking.client_id == c.id)).all()
    assert len(bookings) == 4 and all(str(b.enrollment_id) == e["id"] and b.status == "booked" for b in bookings)
    assert len(_jobs(db_session, s, "course_enrolled")) == 1 and _jobs(db_session, s, "class_booked") == []
    assert "4 מפגשים" in _jobs(db_session, s, "course_enrolled")[0].body
    assert _enroll(client, h, t, c).json()["detail"] == "כבר רשום/ה לקורס"


def test_a_single_session_only_when_the_owner_allows_it(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    t = _course(client, h)
    first = _sessions(db_session, t["id"])[0]
    c = _client(db_session, s, 1)
    r = _book(client, h, first, c, drop_in=True)
    assert r.status_code == 400 and r.json()["detail"] == "ההרשמה היא לקורס כולו"
    _set(client, h, course_drop_in=True)
    assert _book(client, h, first, c, drop_in=True).status_code == 200


def test_a_full_course_refuses_the_whole_enrollment(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    t = _course(client, h)
    people = [_client(db_session, s, n) for n in range(1, 5)]
    for c in people[:3]:
        assert _enroll(client, h, t, c).status_code == 200
    r = _enroll(client, h, t, people[3])
    assert r.status_code == 400 and r.json()["detail"] == "הקורס מלא"
    assert db_session.scalars(select(ClassBooking).where(ClassBooking.client_id == people[3].id)).all() == []


def test_joining_late_by_the_owners_rule(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    t = _course(client, h)
    a, b, c = (_client(db_session, s, n) for n in (1, 2, 3))
    clock["now"] = MONDAY_5                                            # one session is behind, three are left
    e = _mine(_enroll(client, h, t, a), a)
    assert (e["price_cents"], e["sessions_total"]) == (30000, 3)      # the default: for the sessions that are left
    _set(client, h, course_late_join="full")
    assert _mine(_enroll(client, h, t, b), b)["price_cents"] == 40000
    _set(client, h, course_late_join="no")
    assert _enroll(client, h, t, c).json()["detail"] == "הקורס כבר התחיל וההרשמה אליו נסגרה"


def test_the_owner_or_a_manager_may_give_another_price(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    t = _course(client, h)
    c = _client(db_session, s, 1)
    assert _mine(_enroll(client, h, t, c, price_cents=30000), c)["price_cents"] == 30000


def test_payment_cancel_and_refund_by_the_owners_rule(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    t = _course(client, h)
    c = _client(db_session, s, 1)
    e = _mine(_enroll(client, h, t, c), c)
    assert e["refund_due_cents"] is None                               # the default: the owner decides each time
    e = _mine(_pay(client, h, e, 40000), c)
    assert e["paid_cents"] == 40000
    assert db_session.scalar(select(Payment).where(Payment.course_enrollment_id == e["id"])).class_booking_id is None

    _set(client, h, course_refund="full_until", course_refund_days=7)
    assert _mine(client.get(f"/api/classes/courses/{t['id']}", headers=h), c)["refund_due_cents"] == 0   # less than 7 days before

    _set(client, h, course_refund="prorated")
    clock["now"] = MONDAY_5                                            # one of the four sessions took place
    r = client.post(f"/api/classes/enrollments/{e['id']}/cancel", headers=h, json={"reason": "עברה דירה"})
    assert r.status_code == 200 and r.json()["result"] == {"canceled_sessions": 3, "refund_due_cents": 30000}
    statuses = sorted(b.status for b in db_session.scalars(select(ClassBooking).where(ClassBooking.client_id == c.id)).all())
    assert statuses == ["booked", "canceled", "canceled", "canceled"]  # the session that took place stays
    assert "₪300" in _jobs(db_session, s, "course_left")[0].body

    over = client.post(f"/api/classes/enrollments/{e['id']}/refund", headers=h, json={"amount_cents": 50000, "method": "cash"})
    assert over.status_code == 400 and over.json()["detail"] == "ההחזר גדול ממה ששולם"
    back = client.post(f"/api/classes/enrollments/{e['id']}/refund", headers=h, json={"amount_cents": 30000, "method": "bit"})
    assert _mine(back, c)["refunded_cents"] == 30000
    assert client.get("/api/dashboard/stats", headers=h).json()["total_revenue_cents"] == 10000       # ₪400 − ₪300


def test_a_course_session_has_no_late_cancel_or_no_show_fee(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    t = _course(client, h)
    first, second = _sessions(db_session, t["id"])[:2]
    c = _client(db_session, s, 1)
    _enroll(client, h, t, c)
    client.put("/api/classes/penalty-rules", headers=h, json={"rules": [
        {"event": "late_cancel", "action": "fixed", "amount_cents": 5000}, {"event": "no_show", "action": "fixed", "amount_cents": 5000}]})
    one = db_session.scalar(select(ClassBooking).where(ClassBooking.session_id == first.id, ClassBooking.client_id == c.id))
    clock["now"] = SUNDAY_4_13
    assert client.post(f"/api/classes/bookings/{one.id}/cancel", headers=h, json={}).status_code == 200
    db_session.expire_all()
    assert db_session.get(ClassBooking, one.id).status == "canceled"                # not a late cancellation
    two = db_session.scalar(select(ClassBooking).where(ClassBooking.session_id == second.id, ClassBooking.client_id == c.id))
    clock["now"] = datetime(2026, 10, 11, 16, 0, tzinfo=timezone.utc)
    assert client.post(f"/api/classes/bookings/{two.id}/attendance", headers=h, json={"status": "no_show"}).status_code == 200
    assert db_session.scalars(select(ClassFee)).all() == []


def test_a_membership_covers_the_course_when_the_owner_says_so(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    t = _course(client, h)
    _set(client, h, course_covered_by_membership=True)
    stranger, member = _client(db_session, s, 1), _client(db_session, s, 2)
    assert _enroll(client, h, t, stranger).status_code == 400                        # no membership
    card = _sell(client, h, member, _type(client, h))
    e = _mine(_enroll(client, h, t, member), member)
    assert e["price_cents"] == 0 and _balance(client, h, card["id"])["available"] == 6   # an entry for each of the 4 sessions


def test_club_points_on_a_course_payment_by_the_owners_percentage(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    db_session.add(StudioModule(studio_id=s.id, module_id="customer_club", is_enabled=True))
    db_session.commit()
    t = _course(client, h)
    c = _client(db_session, s, 1)
    c.is_club_member = True
    db_session.commit()
    _set(client, h, club_points_course_percent=5)
    _pay(client, h, _mine(_enroll(client, h, t, c), c), 40000)
    db_session.expire_all()
    assert db_session.get(type(c), c.id).loyalty_points == 20


def test_a_credit_note_for_a_membership_payment_stays_tied_to_the_membership(client, db_session, clock):
    """Before: the credit's refund row was tied to an appointment only — for a membership payment it broke the
    'a payment is always for something' rule and the credit note failed."""
    h, s, _ = _business(client, db_session)
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    client.post(f"/api/classes/memberships/{card['id']}/payments", headers=h, json={"amount_cents": 60000, "method": "cash", "send_receipt": False})
    paid = db_session.scalar(select(Payment).where(Payment.membership_id == card["id"]))
    r = client.post(f"/api/payments/{paid.id}/credit", headers=h)
    assert r.status_code == 200, r.text
    refund = db_session.scalar(select(Payment).where(Payment.membership_id == card["id"], Payment.type == "refund"))
    assert refund is not None and refund.amount_cents == 60000
