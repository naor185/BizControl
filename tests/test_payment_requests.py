"""A link to pay sent to a client on WhatsApp (the owner, 2026-10-24) — from the till and from an appointment: the
client's page shows only this request, "שילמתי" tells the business, the approval records the sale with its receipt.
Local test database; the senders are fakes — nothing is sent."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.message_job import MessageJob
from app.models.notification import Notification
from app.models.payment import Payment
from app.models.pos_transaction import PosTransaction
from tests.conftest import register_and_login


def _client(client, h, name="דנה כהן", phone="0521112233"):
    return client.post("/api/clients", headers=h, json={"full_name": name, "phone": phone}).json()["id"]


def test_from_the_till_a_link_the_client_reports_and_the_business_approves(client, db_session):
    owner = register_and_login(client, "link-shop", "owner@link-shop.com")
    me = client.get("/api/auth/me", headers=owner).json()
    cid = _client(client, owner)
    r = client.post("/api/payment-requests", headers=owner, json={
        "client_id": cid, "performer_id": me["id"], "discount_cents": 1000,
        "items": [{"description": "עגיל", "quantity": 2, "unit_price_cents": 6000}]})
    assert r.status_code == 201, r.text
    rid, link = r.json()["id"], r.json()["link"]
    assert r.json()["amount_cents"] == 11000 and link.endswith(f"/pay/r/{rid}")
    job = db_session.scalar(select(MessageJob).where(MessageJob.reminder_type == "payment_request"))
    assert link in job.body and "₪110" in job.body and job.to_phone == "0521112233"

    page = client.get(f"/api/public/payment-request/{rid}").json()           # no sign-in — the link is the key
    assert (page["amount_cents"], page["client_first_name"], page["status"]) == (11000, "דנה", "waiting")
    assert page["items"][0]["description"] == "עגיל" and "phone" not in str(page)    # nothing beyond this request
    assert client.post(f"/api/public/payment-request/{rid}/confirm", json={"notes": "שילמתי בביט"}).json()["status"] == "reported"
    note = db_session.scalar(select(Notification).where(Notification.type == "payment_request"))
    assert note and "₪110" in note.body

    waiting = client.get("/api/payment-requests", headers=owner).json()
    assert [w["id"] for w in waiting] == [rid] and waiting[0]["status"] == "reported"
    ok = client.post(f"/api/payment-requests/{rid}/approve", headers=owner, json={"method": "bit", "send_receipt": False})
    assert ok.status_code == 200, ok.text
    txn = db_session.scalar(select(PosTransaction).where(PosTransaction.idempotency_key == f"preq-{rid}"))
    assert (txn.total_cents, txn.method, str(txn.performer_id)) == (11000, "bit", me["id"])
    assert client.post(f"/api/payment-requests/{rid}/approve", headers=owner, json={"method": "bit"}).status_code == 409
    assert client.post(f"/api/public/payment-request/{rid}/confirm", json={}).status_code == 409
    assert client.get("/api/payment-requests", headers=owner).json() == []


def test_from_an_appointment_and_never_another_business(client, db_session):
    owner = register_and_login(client, "link-appt", "owner@link-appt.com")
    me = client.get("/api/auth/me", headers=owner).json()
    cid = _client(client, owner, phone="0521112244")
    start = datetime.now(timezone.utc) + timedelta(days=2)
    appt = client.post("/api/appointments", headers=owner, json={
        "client_id": cid, "artist_id": me["id"], "title": "קעקוע", "starts_at": start.isoformat(),
        "ends_at": (start + timedelta(hours=1)).isoformat(), "total_price_cents": 80000}).json()
    rid = client.post("/api/payment-requests", headers=owner, json={
        "client_id": cid, "appointment_id": appt["id"], "amount_cents": 60000}).json()["id"]
    assert client.get(f"/api/public/payment-request/{rid}").json()["title"] == "קעקוע"

    other = register_and_login(client, "link-other", "owner@link-other.com")
    assert client.get("/api/payment-requests", headers=other).json() == []
    assert client.post(f"/api/payment-requests/{rid}/approve", headers=other, json={"method": "cash"}).status_code == 404
    assert client.post(f"/api/payment-requests/{rid}/cancel", headers=other).status_code == 404
    other_client = _client(client, other, phone="0521112255")
    assert client.post("/api/payment-requests", headers=other, json={      # their own client, my appointment — no
        "client_id": other_client, "appointment_id": appt["id"], "amount_cents": 100}).status_code == 404

    assert client.post(f"/api/payment-requests/{rid}/approve", headers=owner,
                       json={"method": "cash", "send_receipt": False}).status_code == 200
    pay = db_session.scalar(select(Payment).where(Payment.appointment_id == appt["id"], Payment.type == "payment"))
    assert (pay.amount_cents, pay.method, pay.status) == (60000, "cash", "paid")


def test_no_phone_no_link_and_a_worker_doesnt_approve(client, db_session):
    owner = register_and_login(client, "link-rules", "owner@link-rules.com")
    no_phone = client.post("/api/clients", headers=owner, json={"full_name": "בלי טלפון", "email": "x@example.com"}).json()["id"]
    assert client.post("/api/payment-requests", headers=owner, json={
        "client_id": no_phone, "items": [{"description": "קרם", "unit_price_cents": 5000}]}).status_code == 400
    r = client.post("/api/users/artists", headers=owner, json={"email": "w@link-rules.com", "password": "secret123",
                                                              "role": "staff", "display_name": "עובד"})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": "w@link-rules.com", "password": "secret123"}).json()["access_token"]
    worker = {"Authorization": f"Bearer {t}"}
    cid = _client(client, owner, phone="0521112266")
    rid = client.post("/api/payment-requests", headers=worker, json={
        "client_id": cid, "items": [{"description": "קרם", "unit_price_cents": 5000}]}).json()["id"]
    assert client.post(f"/api/payment-requests/{rid}/approve", headers=worker, json={"method": "cash"}).status_code == 403
    assert client.post(f"/api/payment-requests/{rid}/cancel", headers=owner).status_code == 200
    assert client.get(f"/api/public/payment-request/{rid}").json()["status"] == "canceled"
