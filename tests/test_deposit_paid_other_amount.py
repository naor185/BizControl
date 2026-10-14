"""A deposit of ₪200 was asked and the client paid ₪400 (owner, 2026-10-14) — the owner types what came in: the payment,
the receipt and the balance follow it, and the activity log says so. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.payment import Payment
from tests.conftest import register_and_login


def _appointment(client, h, deposit_cents):
    me = client.get("/api/auth/me", headers=h).json()
    c = client.post("/api/clients", headers=h, json={"full_name": "שי גבריאלי", "phone": "0524448808"}).json()
    start = datetime.now(timezone.utc) + timedelta(days=2)
    a = client.post("/api/appointments", headers=h, json={"client_id": c["id"], "artist_id": me["id"], "title": "קעקוע",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=2)).isoformat(),
                                                          "deposit_amount_cents": deposit_cents})
    assert a.status_code in (200, 201), a.text
    return a.json()["id"]


def test_the_client_paid_more_than_the_deposit(client, db_session):
    h = register_and_login(client, "dep-more", "owner@dep-more.com")
    appt_id = _appointment(client, h, 20000)
    r = client.post(f"/api/appointments/{appt_id}/verify-payment", headers=h, params={"method": "bit", "send_receipt": False, "amount_cents": 40000})
    assert r.status_code == 200, r.text

    [paid] = db_session.scalars(select(Payment).where(Payment.appointment_id == appt_id)).all()
    assert paid.amount_cents == 40000 and paid.type == "deposit"
    assert db_session.get(Appointment, paid.appointment_id).deposit_amount_cents == 40000
    log = client.get("/api/activity", headers=h).json()["items"]
    assert log[0]["text"].startswith("אישור מקדמה של שי גבריאלי") and "התבקשו ₪200, התקבלו ₪400" in log[0]["text"]


def test_as_asked_nothing_changes(client, db_session):
    h = register_and_login(client, "dep-same", "owner@dep-same.com")
    appt_id = _appointment(client, h, 20000)
    assert client.post(f"/api/appointments/{appt_id}/verify-payment", headers=h, params={"send_receipt": False}).status_code == 200
    [paid] = db_session.scalars(select(Payment).where(Payment.appointment_id == appt_id)).all()
    assert paid.amount_cents == 20000
    assert client.get("/api/activity", headers=h).json()["items"] == []
