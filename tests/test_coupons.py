"""The business's own coupons (2026-09-27): the owner writes the code and the percent, a category and a source; the
code is used at the till and on an appointment's payment; limits (uses, once per client, expiry, stopped); the
coupon's BizFind link counts visits; the report adds up uses, money in and discount given — per coupon, category and
source, birthday coupons as one line. A split payment no longer takes the coupon twice. Local test database;
nothing is sent."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.birthday_coupon import BirthdayCoupon
from app.models.client import Client
from app.models.coupon import CouponUse
from app.models.payment import Payment
from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login
from tests.test_classes_stage4 import clock  # noqa: F401  (a fixed "now" for the class tests)


def _business(client, db, slug="coupons"):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.subscription_plan = "pro"             # coupons and the club (birthday coupons) are pro's (the plans, 2026-10)
    db.commit()
    return h, s


def _client(db, s, n=1):
    c = Client(studio_id=s.id, full_name=f"לקוחה {n}", phone=f"05000000{n:02d}")
    db.add(c)
    db.commit()
    return c


def _appointment(db, s, c):
    owner = db.scalar(select(User).where(User.studio_id == s.id))
    a = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="קעקוע",
                    starts_at=datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc), ends_at=datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc))
    db.add(a)
    db.commit()
    return a


def _coupon(client, h, **body):
    r = client.post("/api/coupons", headers=h, json={"code": "summer10", "discount_percent": 10, **body})
    assert r.status_code == 200, r.text
    return r.json()


def _pay(client, h, a, c, amount=100000, **extra):
    return client.post("/api/payments", headers=h, json={"appointment_id": str(a.id), "client_id": str(c.id), "amount_cents": amount,
                                                         "type": "payment", "method": "cash", **extra})


def test_the_owner_writes_the_code_and_the_payment_takes_it_once(client, db_session):
    h, s = _business(client, db_session)
    made = _coupon(client, h, category="קיץ", source="אינסטגרם", max_uses=1)
    assert made["code"] == "SUMMER10"
    assert client.post("/api/coupons", headers=h, json={"code": "SUMMER10", "discount_percent": 20}).status_code == 409
    assert client.post("/api/coupons", headers=h, json={"code": "a b", "discount_percent": 20}).status_code in (400, 422)
    assert client.get("/api/coupons/validate?code=summer10", headers=h).json()["discount_percent"] == 10

    c = _client(db_session, s)
    a = _appointment(db_session, s, c)
    r = _pay(client, h, a, c, coupon_code="SUMMER10")
    assert r.status_code == 201 and r.json()["amount_cents"] == 90000                  # ₪1,000 less 10%
    use = db_session.scalar(select(CouponUse))
    assert (use.before_cents, use.discount_cents, use.client_id) == (100000, 10000, c.id)
    again = _pay(client, h, a, c, coupon_code="SUMMER10")
    assert again.status_code == 404 and "נוצל עד הסוף" in again.json()["detail"]


def test_a_split_payment_takes_the_coupon_off_the_full_price_once(client, db_session):
    h, s = _business(client, db_session)
    _coupon(client, h, discount_percent=20)
    c = _client(db_session, s)
    a = _appointment(db_session, s, c)
    # ₪500 with 20% off = ₪400; the screen splits it — ₪300 now (with the coupon), ₪100 later
    first = _pay(client, h, a, c, amount=30000, coupon_code="SUMMER10", coupon_base_cents=50000)
    assert first.json()["amount_cents"] == 30000                                          # not reduced again
    use = db_session.scalar(select(CouponUse))
    assert (use.before_cents, use.discount_cents) == (50000, 10000)


def test_limits_the_owner_set(client, db_session):
    h, s = _business(client, db_session)
    once = _coupon(client, h, code="ONCE15", discount_percent=15, once_per_client=True)
    c1, c2 = _client(db_session, s, 1), _client(db_session, s, 2)
    a1 = _appointment(db_session, s, c1)
    assert _pay(client, h, a1, c1, coupon_code="ONCE15").status_code == 201
    second = _pay(client, h, a1, c1, coupon_code="ONCE15")
    assert second.status_code == 404 and "כבר השתמש" in second.json()["detail"]
    assert _pay(client, h, _appointment(db_session, s, c2), c2, coupon_code="ONCE15").status_code == 201
    no_client = client.get("/api/coupons/validate?code=ONCE15", headers=h)
    assert no_client.status_code == 404 and "צריך לבחור לקוח" in no_client.json()["detail"]

    old = _coupon(client, h, code="OLD5", discount_percent=5, expires_on=(date.today() - timedelta(days=2)).isoformat())
    assert "פג" in client.get("/api/coupons/validate?code=OLD5", headers=h).json()["detail"]
    client.patch(f"/api/coupons/{once['id']}", headers=h, json={"is_active": False})
    assert "הופסק" in client.get(f"/api/coupons/validate?code=ONCE15&client_id={c2.id}", headers=h).json()["detail"]
    # a used coupon is stopped, not deleted; an unused one can go
    assert client.delete(f"/api/coupons/{once['id']}", headers=h).status_code == 409
    assert client.delete(f"/api/coupons/{old['id']}", headers=h).status_code == 204


def test_the_till_records_it_and_a_voided_sale_gives_it_back(client, db_session):
    h, s = _business(client, db_session)
    _coupon(client, h, max_uses=1)
    sale = client.post("/api/pos/checkout", headers=h, json={
        "items": [{"description": "טיפוח", "quantity": 2, "unit_price_cents": 5000}], "method": "cash",
        "discount_cents": 1000, "coupon_code": "SUMMER10", "send_receipt": False})
    assert sale.status_code == 200, sale.text
    use = db_session.scalar(select(CouponUse))
    assert (use.before_cents, use.discount_cents, str(use.pos_transaction_id)) == (10000, 1000, sale.json()["id"])
    refused = client.post("/api/pos/checkout", headers=h, json={
        "items": [{"description": "טיפוח", "quantity": 1, "unit_price_cents": 5000}], "method": "cash", "coupon_code": "SUMMER10", "send_receipt": False})
    assert refused.status_code == 400 and "נוצל עד הסוף" in refused.json()["detail"]
    assert client.post(f"/api/pos/void/{sale.json()['id']}", headers=h).status_code == 200
    db_session.expire_all()
    assert db_session.scalar(select(CouponUse)) is None
    assert client.get("/api/coupons/validate?code=SUMMER10", headers=h).status_code == 200


def test_a_birthday_coupon_goes_through_the_same_field_and_the_report(client, db_session):
    h, s = _business(client, db_session)
    c = _client(db_session, s)
    now = datetime.now(timezone.utc)
    db_session.add(BirthdayCoupon(studio_id=s.id, client_id=c.id, code="OCT10DAN", discount_percent=10, birthday_month=10,
                                  birthday_year=2026, starts_at=now - timedelta(days=1), expires_at=now + timedelta(days=20)))
    db_session.commit()
    other = _client(db_session, s, 2)
    assert "שייך ללקוח אחר" in client.get(f"/api/coupons/validate?code=OCT10DAN&client_id={other.id}", headers=h).json()["detail"]
    a = _appointment(db_session, s, c)
    assert _pay(client, h, a, c, amount=20000, coupon_code="oct10dan").json()["amount_cents"] == 18000
    db_session.expire_all()
    assert db_session.scalar(select(BirthdayCoupon)).status == "redeemed"

    _coupon(client, h, category="קיץ", source="אינסטגרם")
    _pay(client, h, a, c, amount=50000, coupon_code="SUMMER10")
    rep = client.get("/api/coupons", headers=h).json()
    assert rep["birthday"] == {"issued": 1, "active": 0, "uses": 1, "paid_cents": 18000, "discount_cents": 2000}
    row = rep["coupons"][0]
    assert (row["uses"], row["paid_cents"], row["discount_cents"], row["state"]) == (1, 45000, 5000, "active")
    cats = {r["name"]: r for r in rep["by_category"]}
    assert (cats["קיץ"]["paid_cents"], cats["יום הולדת"]["paid_cents"]) == (45000, 18000)
    assert {r["name"] for r in rep["by_source"]} == {"אינסטגרם", "אוטומטי — יום הולדת"}
    assert (rep["totals"]["uses"], rep["totals"]["paid_cents"], rep["totals"]["discount_cents"]) == (2, 63000, 7000)
    # deleting the payment (the platform's admin) gives the use back
    from app.crud.payment import delete_payment
    paid = db_session.scalar(select(Payment).where(Payment.amount_cents == 45000))
    assert delete_payment(db_session, s.id, paid.id)
    assert client.get("/api/coupons", headers=h).json()["coupons"][0]["uses"] == 0


def test_the_coupon_link_counts_visits_and_only_management_manages(client, db_session):
    h, s = _business(client, db_session)
    made = _coupon(client, h)
    first = client.post(f"/api/public/coupons/{s.slug}/summer10", json={"count": True})
    assert first.status_code == 200 and first.json()["discount_percent"] == 10
    client.post(f"/api/public/coupons/{s.slug}/SUMMER10", json={"count": False})          # the same visit again
    assert client.get("/api/coupons", headers=h).json()["coupons"][0]["clicks"] == 1
    client.patch(f"/api/coupons/{made['id']}", headers=h, json={"is_active": False})
    assert client.post(f"/api/public/coupons/{s.slug}/SUMMER10", json={"count": True}).status_code == 404
    assert client.get("/api/coupons", headers=h).json()["studio_slug"] == s.slug

    me = db_session.scalar(select(User).where(User.studio_id == s.id))
    me.role = "staff"
    db_session.commit()
    r = client.post("/api/coupons", headers=h, json={"code": "STAFF50", "discount_percent": 50})
    assert r.status_code == 403 and r.json()["detail"] == "קופונים — רק לבעלים או למנהל"
    assert client.get("/api/coupons/validate?code=SUMMER10", headers=h).status_code == 404            # staff still checks codes (this one is stopped)


def test_the_discount_closes_the_bill_and_is_not_money(client, db_session):
    """Paying with a coupon leaves nothing owed — the discount has its own "[מערכת] קופון" row (like paying with club
    points) that closes the appointment's balance, and the money on the client card is only what was paid."""
    h, s = _business(client, db_session)
    _coupon(client, h)
    c = _client(db_session, s)
    a = _appointment(db_session, s, c)
    a.total_price_cents = 100000
    db_session.commit()
    _pay(client, h, a, c, coupon_code="SUMMER10")
    assert client.get(f"/api/payments/appointments/{a.id}/balance", headers=h).json()["net_paid_cents"] == 100000
    card = client.get(f"/api/clients/{c.id}/profile", headers=h).json()
    assert (card["net_paid_cents"], card["remaining_balance_cents"]) == (90000, 0)


def test_a_membership_class_course_or_rental_payment_takes_a_coupon(client, db_session, clock):
    from tests.test_classes_stage4 import _business as _classes_business, _client as _classes_client, _sell, _type
    h, s, _ = _classes_business(client, db_session)
    s.subscription_plan = "pro"             # coupons are pro's (the plans, 2026-10)
    db_session.commit()
    _coupon(client, h, code="YOGA20", discount_percent=20, category="סטודיו", source="פייסבוק")
    c = _classes_client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))                                   # ₪600
    r = client.post(f"/api/classes/memberships/{card['id']}/payments", headers=h,
                    json={"amount_cents": 60000, "method": "cash", "coupon_code": "yoga20", "send_receipt": False})
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["paid_cents"] == 60000                                                # ₪480 paid + ₪120 coupon = settled
    assert sorted((p["amount_cents"], p["is_coupon"]) for p in m["payments"]) == [(12000, True), (48000, False)]
    row = client.get("/api/coupons", headers=h).json()["coupons"][0]
    assert (row["uses"], row["paid_cents"], row["discount_cents"]) == (1, 48000, 12000)
    bad = client.post(f"/api/classes/memberships/{card['id']}/payments", headers=h,
                      json={"amount_cents": 1000, "method": "cash", "coupon_code": "NOPE", "send_receipt": False})
    assert bad.status_code == 400 and "אין קופון" in bad.json()["detail"]
