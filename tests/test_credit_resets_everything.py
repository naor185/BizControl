"""A credit note undoes the sale — everything resets (the owner, 2026-10-26: "of course everything resets when a
payment is credited"): the money, the points it earned, the points used to pay, its coupon, its stock, the artist's
commission; a till sale credited on its receipt is void. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models.client import Client
from app.models.client_points_ledger import ClientPointsLedger
from app.models.coupon import CouponUse
from app.models.payment import Payment
from app.models.pos_transaction import PosTransaction
from app.models.product import Product
from app.models.user import User
from app.repositories.staff_repository import StaffRepository
from tests.test_coupons import _appointment, _business, _coupon, _pay


def _member(db, s, points=100, phone="0500000077"):
    c = Client(studio_id=s.id, full_name="יעל", phone=phone, is_club_member=True, loyalty_points=points)
    db.add(c)
    db.commit()
    return c


def test_a_credited_payment_gives_back_the_points_the_coupon_and_the_commission(client, db_session):
    h, s = _business(client, db_session, "reset-pay")
    owner = db_session.scalar(select(User).where(User.studio_id == s.id))
    owner.pay_type, owner.commission_rate = "commission", Decimal("10")
    db_session.commit()
    _coupon(client, h, max_uses=1)
    c = _member(db_session, s)
    a = _appointment(db_session, s, c)

    # ₪1,000 less 10% (the coupon) = ₪900, ₪50 of it in points → ₪850 cash; 5% cashback on it = 42 points
    r = _pay(client, h, a, c, coupon_code="SUMMER10", points_redeemed=50)
    assert r.status_code == 201, r.text
    pay_id = r.json()["id"]
    db_session.expire_all()
    assert db_session.get(Client, c.id).loyalty_points == 100 - 50 + 42

    credit = client.post(f"/api/payments/{pay_id}/credit", headers=h)
    assert credit.status_code == 200, credit.text
    assert credit.json()["undone"] == {"points_taken": 42, "points_given": 50, "coupon": True, "restocked": 0}
    db_session.expire_all()
    assert db_session.get(Client, c.id).loyalty_points == 100                         # as before the payment
    history = [x.reason for x in db_session.scalars(select(ClientPointsLedger).where(ClientPointsLedger.client_id == c.id)).all()]
    assert any(x.startswith("זיכוי — בוטלו") for x in history) and any(x.startswith("זיכוי — הוחזרו") for x in history)

    rows = db_session.scalars(select(Payment).where(Payment.appointment_id == a.id)).all()
    [refund] = [p for p in rows if p.type == "refund"]
    assert refund.amount_cents == 85000
    assert all(p.status == "void" for p in rows if (p.notes or "").startswith("[מערכת]"))   # points + coupon rows
    assert db_session.scalar(select(CouponUse)) is None
    assert client.get(f"/api/coupons/validate?code=SUMMER10&client_id={c.id}", headers=h).status_code == 200

    # the artist's commission: the payment less what was given back — nothing
    now = datetime.now(timezone.utc)
    [mine] = [x for x in StaffRepository(db_session).get_user_payroll_summary(s.id, now - timedelta(days=1), now + timedelta(days=1))
              if str(x.get("user_id")) == str(owner.id)]
    assert Decimal(str(mine["commission_pay"])) == 0

    # credited once — the receipt can't be credited again, nothing is reversed twice
    assert client.post(f"/api/payments/{pay_id}/credit", headers=h).status_code == 400


def test_a_till_sale_credited_on_its_receipt_is_void_with_its_stock_and_points_back(client, db_session):
    h, s = _business(client, db_session, "reset-till")
    c = _member(db_session, s, phone="0500000078")
    earring = Product(studio_id=s.id, name="עגיל", price=Decimal("100"), stock_quantity=10)
    db_session.add(earring)
    db_session.commit()
    sale = client.post("/api/pos/checkout", headers=h, json={
        "items": [{"product_id": str(earring.id), "description": "עגיל", "quantity": 2, "unit_price_cents": 10000}],
        "method": "cash", "client_id": str(c.id), "points_redeemed": 20, "send_receipt": False})
    assert sale.status_code == 200, sale.text
    txn_id = sale.json()["id"]
    db_session.expire_all()
    assert db_session.get(Product, earring.id).stock_quantity == 8
    receipt = db_session.execute(
        __import__("sqlalchemy").text("SELECT id FROM invoices WHERE source_id = :t AND doc_type != 'credit'"), {"t": txn_id}).scalar()
    assert receipt

    r = client.post(f"/api/invoices/{receipt}/credit", headers=h, json={"payment_method": "cash"})
    assert r.status_code == 200, r.text
    assert r.json()["undone"]["points_given"] == 20 and r.json()["undone"]["restocked"] == 2
    db_session.expire_all()
    assert db_session.get(PosTransaction, txn_id).status == "void"                    # out of income
    assert db_session.get(Product, earring.id).stock_quantity == 10
    assert db_session.get(Client, c.id).loyalty_points == 100                         # the 20 used back, the earned taken


def test_a_deposit_credited_takes_back_points_recorded_before_the_link(client, db_session):
    """Points lines from before 2026-10-26 have no payment link — found by what they say."""
    h, s = _business(client, db_session, "reset-old")
    c = _member(db_session, s, points=10, phone="0500000079")
    a = _appointment(db_session, s, c)
    a.deposit_amount_cents = 20000
    db_session.commit()
    assert client.post(f"/api/appointments/{a.id}/verify-payment", headers=h, params={"send_receipt": False}).status_code == 200
    line = db_session.scalar(select(ClientPointsLedger).where(ClientPointsLedger.client_id == c.id, ClientPointsLedger.delta_points > 0))
    assert line.payment_id is not None                                                # linked from now on
    line.payment_id = None                                                            # as an old line
    db_session.commit()
    dep = db_session.scalar(select(Payment).where(Payment.appointment_id == a.id, Payment.type == "deposit"))
    r = client.post(f"/api/payments/{dep.id}/credit", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["undone"]["points_taken"] == 10                                   # 5% of ₪200
    db_session.expire_all()
    assert db_session.get(Client, c.id).loyalty_points == 10
