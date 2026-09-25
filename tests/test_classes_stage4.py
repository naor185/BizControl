"""Classes & memberships, stage 4 — memberships and the owner's late-cancel / no-show rules. The plan's
end-of-stage checks: sell a punch card, see its balance, set a late-cancel policy, see the fee a rule
recorded and waive it; a booking without a covering membership is refused. The entry log follows the
plan's table: 10 → book 9 → attend 9 (never 8) → cancel on time 10; a repeated action changes nothing.
Frozen clock; local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.classes import ClassBooking, ClassSession
from app.models.client import Client
from app.models.memberships import ClassFee, Membership, MembershipEntry
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.service import Service
from app.models.studio import Studio
from app.models.user import User
from app.services import classes as svc
from app.services import memberships as ms
from tests.conftest import register_and_login

NOW = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)          # Thursday 1 Oct, 10:00 in Israel
SUNDAY_18 = datetime(2026, 10, 4, 15, 0, tzinfo=timezone.utc)


@pytest.fixture()
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(svc, "now_utc", lambda: state["now"])
    return state


def _business(client, db, slug="pilates", weekdays=(0, 2)):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.name = "פילאטיס בלב"
    for m in ("classes", "memberships"):
        db.add(StudioModule(studio_id=s.id, module_id=m, is_enabled=True))
    service = Service(studio_id=s.id, name="שיעור קבוצתי", duration_minutes=55, price_cents=8000)
    db.add(service)
    db.commit()
    t = client.post("/api/classes/templates", headers=h, json={
        "name": "פילאטיס מכשירים", "weekdays": list(weekdays), "start_time": "18:00", "starts_on": "2026-10-01",
        "capacity": 10, "service_id": str(service.id)}).json()
    return h, s, t


def _sessions(db, template_id):
    db.expire_all()
    return db.scalars(select(ClassSession).where(ClassSession.template_id == template_id).order_by(ClassSession.starts_at)).all()


def _client(db, studio, n):
    c = Client(studio_id=studio.id, full_name=f"מתאמנת {n}", phone=f"05500000{n:02d}", email=f"m{n}@x.com")
    db.add(c)
    db.commit()
    return c


def _type(client, h, **body):
    r = client.post("/api/classes/membership-types", headers=h, json={"name": "כרטיסייה 10", "kind": "punch", "entries": 10,
                                                                      "duration_days": 90, "price_cents": 60000, **body})
    assert r.status_code == 200, r.text
    return r.json()


def _sell(client, h, c, t, **extra):
    r = client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": t["id"], **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _book(client, h, session, c, **extra):
    return client.post(f"/api/classes/sessions/{session.id}/bookings", headers=h, json={"client_id": str(c.id), **extra})


def _booking(r, c):
    data = r.json() if hasattr(r, "json") else r
    return next(b for b in data["bookings"] if b["client_id"] == str(c.id))


def _balance(client, h, membership_id):
    return client.get(f"/api/classes/memberships/{membership_id}", headers=h).json()["balance"]


def _jobs(db, studio, kind):
    db.expire_all()
    return [j for j in db.scalars(select(MessageJob).where(MessageJob.studio_id == studio.id,
                                                          MessageJob.reminder_type == f"notify-{kind}")).all()
            if j.channel == "whatsapp"]


# ── the punch card and its entry log ─────────────────────────────────────────

def test_a_punch_card_follows_the_plans_table_and_never_takes_twice(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first, second = _sessions(db_session, t["id"])[:2]
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    assert card["status"] == "active" and card["ends_on"] == "2026-12-29" and card["balance"]["available"] == 10

    r = _book(client, h, first, c)
    assert _booking(r, c)["membership"] == "כרטיסייה 10 · נותרו 9"
    assert _balance(client, h, card["id"]) == {"total": 10, "reserved": 1, "consumed": 0, "available": 9}

    clock["now"] = SUNDAY_18
    booking_id = _booking(r, c)["id"]
    for _ in range(2):                                                     # the same action twice
        client.post(f"/api/classes/bookings/{booking_id}/attendance", headers=h, json={"status": "attended"})
    assert _balance(client, h, card["id"]) == {"total": 10, "reserved": 0, "consumed": 1, "available": 9}

    clock["now"] = NOW
    later = _booking(_book(client, h, second, c), c)["id"]
    assert _balance(client, h, card["id"])["available"] == 8
    client.post(f"/api/classes/bookings/{later}/cancel", headers=h, json={})          # on time: back
    assert _balance(client, h, card["id"]) == {"total": 10, "reserved": 0, "consumed": 1, "available": 9}
    ms.settle(db_session, db_session.get(ClassBooking, later), "return", reason="again")
    assert _balance(client, h, card["id"])["available"] == 9

    db_session.add(MembershipEntry(studio_id=s.id, membership_id=card["id"], booking_id=booking_id, stage="reserve"))
    with pytest.raises(IntegrityError):                                    # the database refuses a second reserve
        db_session.flush()
    db_session.rollback()


def test_the_business_cancelling_a_class_returns_the_entry_and_says_so(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first = _sessions(db_session, t["id"])[0]
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    _book(client, h, first, c)
    client.post(f"/api/classes/sessions/{first.id}/cancel", headers=h, json={})
    assert _balance(client, h, card["id"])["available"] == 10
    assert "הכניסה חזרה לכרטיסייה." in _jobs(db_session, s, "class_changed")[0].body


# ── who may book ─────────────────────────────────────────────────────────────

def test_without_a_covering_membership_a_booking_is_refused_or_recorded_as_a_single_entry(client, db_session, clock):
    h, s, t = _business(client, db_session, weekdays=(0, 1, 2))
    sun, mon, tue = _sessions(db_session, t["id"])[:3]
    nobody, weekly, both, later = (_client(db_session, s, n) for n in (1, 2, 3, 4))

    check = client.get(f"/api/classes/sessions/{sun.id}/eligibility?client_id={nobody.id}", headers=h).json()
    assert check == {"required": True, "membership": None, "reason": "אין מנוי"}
    refused = _book(client, h, sun, nobody)
    assert refused.status_code == 400 and refused.json()["detail"] == "אין מנוי — אפשר לרשום ככניסה בודדת"
    single = _book(client, h, sun, nobody, drop_in=True)
    assert single.status_code == 200 and _booking(single, nobody)["drop_in"] is True

    twice = _type(client, h, name="פעמיים בשבוע", kind="weekly", entries=2, duration_days=30)
    _sell(client, h, weekly, twice)
    assert _book(client, h, sun, weekly).status_code == 200
    assert _book(client, h, mon, weekly).status_code == 200
    third = _book(client, h, tue, weekly)
    assert third.status_code == 400 and "כבר נוצלו 2 כניסות" in third.json()["detail"]
    next_week = _sessions(db_session, t["id"])[3]
    assert _book(client, h, next_week, weekly).status_code == 200

    unlimited = _type(client, h, name="חודשי", kind="unlimited", duration_days=30)
    card = _sell(client, h, both, _type(client, h, name="כרטיסייה 5", entries=5))
    _sell(client, h, both, unlimited)
    assert _booking(_book(client, h, sun, both), both)["membership"] == "חודשי"          # unlimited first
    assert _balance(client, h, card["id"])["available"] == 5

    _sell(client, h, later, unlimited, starts_on="2026-10-11")
    assert _book(client, h, sun, later).json()["detail"].startswith("אין מנוי בתוקף ביום השיעור")
    assert _book(client, h, _sessions(db_session, t["id"])[6], later).status_code == 200


def test_a_membership_covers_only_its_classes_and_an_empty_card_stops(client, db_session, clock):
    h, s, t = _business(client, db_session)
    other = client.post("/api/classes/templates", headers=h, json={"name": "יוגה", "weekdays": [3], "start_time": "08:00",
                        "starts_on": "2026-10-01", "duration_minutes": 60, "capacity": 8}).json()
    c = _client(db_session, s, 1)
    yoga_only = _sell(client, h, c, _type(client, h, name="יוגה בלבד", entries=2, covers_all=False, covered_templates=[other["id"]]))
    first = _sessions(db_session, t["id"])[0]
    assert "המנוי לא כולל את השיעור הזה" in _book(client, h, first, c).json()["detail"]
    yoga = _sessions(db_session, other["id"])
    assert _book(client, h, yoga[0], c).status_code == 200
    assert _book(client, h, yoga[1], c).status_code == 200
    assert "נגמרו הכניסות בכרטיסייה" in _book(client, h, yoga[2], c).json()["detail"]
    fixed = client.post(f"/api/classes/memberships/{yoga_only['id']}/adjust", headers=h, json={"delta": 1, "reason": "מתנה"})
    assert fixed.json()["balance"]["available"] == 1
    assert _book(client, h, yoga[2], c).status_code == 200


# ── the owner's rules ────────────────────────────────────────────────────────

def test_by_default_a_late_cancel_consumes_the_entry_and_charges_nothing(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first = _sessions(db_session, t["id"])[0]
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    booking = _booking(_book(client, h, first, c), c)["id"]
    clock["now"] = SUNDAY_18 - timedelta(hours=2)
    client.post(f"/api/classes/bookings/{booking}/cancel", headers=h, json={})
    assert _balance(client, h, card["id"])["consumed"] == 1
    assert db_session.scalars(select(ClassFee)).all() == [] and _jobs(db_session, s, "late_fee") == []
    assert "הכניסה נוצלה מהכרטיסייה." in _jobs(db_session, s, "booking_cancelled")[0].body


def test_the_owners_rules_warn_then_charge_and_a_justified_case_is_waived(client, db_session, clock):
    h, s, t = _business(client, db_session, weekdays=(0, 1, 2, 3))
    sessions = _sessions(db_session, t["id"])
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    rules = client.put("/api/classes/penalty-rules", headers=h, json={"rules": [
        {"event": "late_cancel", "from_count": 1, "action": "warn"},
        {"event": "late_cancel", "from_count": 2, "within_days": 30, "action": "percent", "percent": 50},
        {"event": "no_show", "from_count": 1, "action": "full"}]})
    assert rules.status_code == 200 and len(rules.json()) == 3

    ids = [_booking(_book(client, h, sessions[i], c), c)["id"] for i in range(3)]
    clock["now"] = sessions[0].starts_at - timedelta(hours=1)
    client.post(f"/api/classes/bookings/{ids[0]}/cancel", headers=h, json={})           # 1st late cancel: a warning
    clock["now"] = sessions[1].starts_at - timedelta(hours=1)
    client.post(f"/api/classes/bookings/{ids[1]}/cancel", headers=h, json={})           # 2nd within 30 days: 50% of ₪80
    fees = client.get("/api/classes/fees", headers=h).json()
    assert [(f["event"], f["amount_cents"]) for f in fees] == [("late_cancel", 4000)]
    notes = [j.body for j in _jobs(db_session, s, "late_fee")]
    assert any("בפעם הבאה ייתכן חיוב" in n for n in notes) and any("נרשם חיוב של ₪40" in n for n in notes)
    assert _balance(client, h, card["id"])["available"] == 9                    # warnings and fees return the entry

    clock["now"] = sessions[2].starts_at + timedelta(minutes=10)
    r = client.post(f"/api/classes/bookings/{ids[2]}/attendance", headers=h, json={"status": "no_show"}).json()
    assert _booking(r, c)["fee"]["amount_cents"] == 8000                        # a no-show: the full price
    justified = client.post(f"/api/classes/bookings/{ids[2]}/justify", headers=h).json()
    assert _booking(justified, c)["fee"]["status"] == "waived" and _booking(justified, c)["justified"] is True
    assert db_session.get(Client, c.id).no_show_count == 1

    fee_id = client.get("/api/classes/fees", headers=h).json()[0]["id"]
    assert client.post(f"/api/classes/fees/{fee_id}/waive", headers=h, json={"reason": "לקוחה ותיקה"}).json()["status"] == "waived"
    assert client.get("/api/classes/fees", headers=h).json() == []


def test_a_class_templates_rule_beats_the_business_rule(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first = _sessions(db_session, t["id"])[0]
    c = _client(db_session, s, 1)
    _sell(client, h, c, _type(client, h))
    client.put("/api/classes/penalty-rules", headers=h, json={"rules": [{"event": "late_cancel", "action": "fixed", "amount_cents": 3000}]})
    client.put("/api/classes/penalty-rules", headers=h, json={"scope_type": "class_template", "scope_id": t["id"],
                                                              "rules": [{"event": "late_cancel", "action": "nothing"}]})
    booking = _booking(_book(client, h, first, c), c)["id"]
    clock["now"] = SUNDAY_18 - timedelta(hours=1)
    client.post(f"/api/classes/bookings/{booking}/cancel", headers=h, json={})
    assert client.get("/api/classes/fees", headers=h).json() == []
    bad = client.put("/api/classes/penalty-rules", headers=h, json={"rules": [{"event": "late_cancel", "action": "percent"}]})
    assert bad.status_code == 400 and "אחוז" in bad.json()["detail"]


def test_changing_attendance_undoes_the_fee_and_keeps_the_balance_right(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first = _sessions(db_session, t["id"])[0]
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    client.put("/api/classes/penalty-rules", headers=h, json={"rules": [{"event": "no_show", "action": "fixed", "amount_cents": 5000}]})
    booking = _booking(_book(client, h, first, c), c)["id"]
    clock["now"] = SUNDAY_18
    def mark(status):
        return client.post(f"/api/classes/bookings/{booking}/attendance", headers=h, json={"status": status})

    fee = _booking(mark("no_show"), c)["fee"]
    assert (fee["amount_cents"], fee["status"]) == (5000, "pending")
    assert _balance(client, h, card["id"])["available"] == 10                  # a fee: the entry comes back
    assert _booking(mark("attended"), c)["fee"]["status"] == "waived"
    assert _balance(client, h, card["id"]) == {"total": 10, "reserved": 0, "consumed": 1, "available": 9}
    assert _booking(mark("no_show"), c)["fee"]["status"] == "pending"          # back again: the fee returns
    assert _balance(client, h, card["id"])["available"] == 10
    assert db_session.get(Client, c.id).no_show_count == 1


# ── renewal, status, who may ─────────────────────────────────────────────────

def test_renewal_starts_the_day_after_and_statuses_follow_the_dates(client, db_session, clock):
    h, s, t = _business(client, db_session)
    c = _client(db_session, s, 1)
    month = _sell(client, h, c, _type(client, h, name="חודשי", kind="unlimited", duration_days=30))
    assert month["ends_on"] == "2026-10-30"
    renewed = client.post(f"/api/classes/memberships/{month['id']}/renew", headers=h, json={}).json()
    assert (renewed["starts_on"], renewed["status"]) == ("2026-10-31", "pending")
    clock["now"] = datetime(2026, 11, 2, 7, 0, tzinfo=timezone.utc)
    assert ms.refresh_statuses(db_session) == 2
    db_session.expire_all()
    assert [db_session.get(Membership, m["id"]).status for m in (month, renewed)] == ["expired", "active"]


def test_the_front_desk_sells_but_does_not_correct_and_businesses_do_not_see_each_other(client, db_session, clock):
    h, s, t = _business(client, db_session)
    c = _client(db_session, s, 1)
    kind = _type(client, h)
    db_session.scalar(select(User).where(User.studio_id == s.id)).role = "staff"
    db_session.commit()
    card = _sell(client, h, c, kind)
    assert client.post(f"/api/classes/memberships/{card['id']}/adjust", headers=h, json={"delta": 1, "reason": "x"}).status_code == 403
    assert client.post("/api/classes/membership-types", headers=h, json={"name": "x", "kind": "punch", "entries": 1}).status_code == 403
    h2, _, _ = _business(client, db_session, slug="gym-b")
    assert client.get(f"/api/classes/memberships/{card['id']}", headers=h2).status_code == 404
    assert client.post("/api/classes/memberships", headers=h2, json={"client_id": str(c.id), "type_id": kind["id"]}).status_code == 404


# ── payments (recorded, never collected) ─────────────────────────────────────

def test_a_membership_payment_is_income_by_its_date_gets_a_receipt_and_skews_nothing(client, db_session, clock):
    from sqlalchemy import text
    h, s, t = _business(client, db_session)
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    detail = client.post(f"/api/classes/memberships/{card['id']}/payments", headers=h,
                         json={"amount_cents": 60000, "method": "bit", "send_receipt": False}).json()
    assert detail["paid_cents"] == 60000 and [p["amount_cents"] for p in detail["payments"]] == [60000]

    listed = client.get("/api/payments", headers=h)
    assert listed.status_code == 200                                       # no appointment — the list still works
    row = next(p for p in listed.json() if p["membership_id"] == card["id"])
    assert row["appointment_id"] is None
    assert client.get("/api/dashboard/stats", headers=h).json()["total_revenue_cents"] == 60000
    advanced = client.get("/api/dashboard/advanced", headers=h).json()
    assert advanced["kpis"]["avg_appt_value_ils"] == 0                      # not an appointment's value
    invoice = db_session.execute(text("SELECT doc_type FROM invoices WHERE source_id = :pid"), {"pid": row["id"]}).fetchone()
    assert invoice is not None                                              # its receipt, through the usual invoicing


def test_a_fee_and_a_single_entry_are_paid_and_deleting_the_fees_payment_opens_it_again(client, db_session, clock):
    from app.models.payment import Payment
    h, s, t = _business(client, db_session)
    first = _sessions(db_session, t["id"])[0]
    c, walk_in = _client(db_session, s, 1), _client(db_session, s, 2)
    _sell(client, h, c, _type(client, h))
    client.put("/api/classes/penalty-rules", headers=h, json={"rules": [{"event": "no_show", "action": "fixed", "amount_cents": 5000}]})
    booking = _booking(_book(client, h, first, c), c)["id"]
    single = _booking(_book(client, h, first, walk_in, drop_in=True), walk_in)["id"]
    clock["now"] = SUNDAY_18
    client.post(f"/api/classes/bookings/{booking}/attendance", headers=h, json={"status": "no_show"})
    fee = client.get("/api/classes/fees", headers=h).json()[0]
    assert client.post(f"/api/classes/fees/{fee['id']}/pay", headers=h, json={"method": "cash", "send_receipt": False}).json()["status"] == "paid"
    assert client.get("/api/classes/fees", headers=h).json() == []

    paid = client.post(f"/api/classes/bookings/{single}/payments", headers=h,
                       json={"amount_cents": 8000, "method": "cash", "send_receipt": False}).json()
    assert paid["paid_cents"] == 8000
    session = client.get(f"/api/classes/sessions/{first.id}", headers=h).json()
    assert session["price_cents"] == 8000 and _booking(session, walk_in)["paid_cents"] == 8000
    assert _booking(session, c)["paid_cents"] == 0                          # a fee's payment is not a single entry's

    fee_payment = db_session.scalar(select(Payment).where(Payment.class_booking_id == booking))
    db_session.scalar(select(User).where(User.studio_id == s.id)).role = "superadmin"
    db_session.commit()
    assert client.delete(f"/api/payments/{fee_payment.id}", headers=h).status_code == 204
    assert [f["status"] for f in client.get("/api/classes/fees", headers=h).json()] == ["pending"]


def test_a_payment_is_always_for_something(db_session):
    from app.models.payment import Payment
    s = Studio(name="x", slug="x-pay")
    db_session.add(s)
    db_session.flush()
    c = Client(studio_id=s.id, full_name="x", phone="0500000000")
    db_session.add(c)
    db_session.flush()
    db_session.add(Payment(studio_id=s.id, client_id=c.id, amount_cents=100, type="payment", status="paid", method="cash"))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_a_card_payment_from_the_payment_screen_is_accepted():
    """The payment screen sends "credit_card" for a card; the server refused it (found 2026-09-25)."""
    import uuid
    from app.schemas.payment import PaymentCreate
    p = PaymentCreate(appointment_id=uuid.uuid4(), client_id=uuid.uuid4(), amount_cents=100, type="payment", method="credit_card")
    assert p.method == "credit_card"
