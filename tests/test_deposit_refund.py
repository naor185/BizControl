"""Giving the deposit back after a cancellation in time (the owner, 2026-10-26: "when an appointment is canceled, the
deposit was approved and it's within the cancellation time — ask me whether to credit the deposit, and take me to the
documents"). Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.payment import Payment
from tests.conftest import register_and_login


def _paid_appointment(client, h, days_ahead: float, phone="0524448808", verify=True):
    me = client.get("/api/auth/me", headers=h).json()
    c = client.post("/api/clients", headers=h, json={"full_name": "שי גבריאלי", "phone": phone}).json()
    start = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    a = client.post("/api/appointments", headers=h, json={"client_id": c["id"], "artist_id": me["id"], "title": "קעקוע",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=2)).isoformat(),
                                                          "deposit_amount_cents": 20000})
    assert a.status_code in (200, 201), a.text
    appt_id = a.json()["id"]
    if verify:
        r = client.post(f"/api/appointments/{appt_id}/verify-payment", headers=h, params={"method": "bit", "send_receipt": False})
        assert r.status_code == 200, r.text
    return appt_id


def _offer(client, h, appt_id):
    r = client.get(f"/api/appointments/{appt_id}/deposit-refund", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["offer"]


def test_canceled_in_time_the_deposit_is_offered_and_the_credit_gives_the_money_back(client, db_session):
    h = register_and_login(client, "refund-shop", "owner@refund-shop.com")
    appt_id = _paid_appointment(client, h, days_ahead=10)                  # the policy: 7 days (the default)
    assert _offer(client, h, appt_id) is None                              # not canceled — nothing to give back
    assert client.delete(f"/api/appointments/{appt_id}", headers=h, params={"reason": "client_cancelled"}).status_code == 204

    offer = _offer(client, h, appt_id)
    assert offer["amount"] == 200 and offer["free_days"] == 7 and offer["days_before"] >= 9
    assert offer["client_name"] == "שי גבריאלי"

    # the credit note on the documents page — and the money given back is recorded, the way it went back
    r = client.post(f"/api/invoices/{offer['invoice_id']}/credit", headers=h, json={"payment_method": "bit", "notes": "החזר מקדמה"})
    assert r.status_code == 200, r.text
    [refund] = db_session.scalars(select(Payment).where(Payment.appointment_id == appt_id, Payment.type == "refund")).all()
    assert refund.amount_cents == 20000 and refund.method == "bit" and refund.status == "paid"
    assert _offer(client, h, appt_id) is None                              # credited — not asked again


def test_late_or_no_show_or_no_deposit_is_not_offered(client):
    h = register_and_login(client, "refund-late", "owner@refund-late.com")
    late = _paid_appointment(client, h, days_ahead=3, phone="0524448801")     # inside the 7 days — no refund by the policy
    client.delete(f"/api/appointments/{late}", headers=h, params={"reason": "client_cancelled"})
    assert _offer(client, h, late) is None

    no_show = _paid_appointment(client, h, days_ahead=10, phone="0524448802")
    client.delete(f"/api/appointments/{no_show}", headers=h, params={"reason": "no_show"})
    assert _offer(client, h, no_show) is None

    unpaid = _paid_appointment(client, h, days_ahead=10, phone="0524448803", verify=False)
    client.delete(f"/api/appointments/{unpaid}", headers=h)
    assert _offer(client, h, unpaid) is None


def test_a_worker_is_not_asked_and_another_business_sees_nothing(client):
    h = register_and_login(client, "refund-guard", "owner@refund-guard.com")
    appt_id = _paid_appointment(client, h, days_ahead=10)
    client.delete(f"/api/appointments/{appt_id}", headers=h)
    assert _offer(client, h, appt_id) is not None                           # a regular cancellation in time counts too

    r = client.post("/api/users/artists", headers=h, json={"email": "w@refund-guard.com", "password": "secret123",
                                                          "display_name": "דנה", "role": "artist"})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": "w@refund-guard.com", "password": "secret123"}).json()["access_token"]
    assert client.get(f"/api/appointments/{appt_id}/deposit-refund", headers={"Authorization": f"Bearer {t}"}).status_code == 403

    other = register_and_login(client, "refund-other", "owner@refund-other.com")
    assert _offer(client, other, appt_id) is None
