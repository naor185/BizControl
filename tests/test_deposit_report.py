"""The client says they paid the deposit on the payment page — "שילמתי" with a picture of the payment — and the business
hears it at once and approves it from the calendar (the owner, 2026-10-15: most businesses send through the platform's
WhatsApp number, so a proof sent back on WhatsApp never reached them). Local test database; nothing is sent."""
import io
from datetime import datetime, timedelta, timezone

from PIL import Image
from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.message_job import MessageJob
from app.models.notification import Notification
from app.services import image_store
from tests.conftest import register_and_login


def _png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (60, 120), (0, 90, 255)).save(out, "PNG")
    return out.getvalue()


def _appointment(client, h, deposit_cents=20000, phone="0524448808"):
    me = client.get("/api/auth/me", headers=h).json()
    c = client.post("/api/clients", headers=h, json={"full_name": "שי גבריאלי", "phone": phone}).json()
    start = datetime.now(timezone.utc) + timedelta(days=3)
    a = client.post("/api/appointments", headers=h, json={"client_id": c["id"], "artist_id": me["id"], "title": "קעקוע",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=2)).isoformat(),
                                                          "deposit_amount_cents": deposit_cents})
    assert a.status_code in (200, 201), a.text
    return a.json()["id"]


def _no_cloud(monkeypatch):
    saved = []
    monkeypatch.setattr(image_store, "save_image", lambda data, ct, folder, prefix, db=None: saved.append(folder) or f"https://img.test/{folder}/p.jpg")
    return saved


def test_the_client_reports_with_a_picture_and_the_business_hears_once(client, db_session, monkeypatch):
    saved = _no_cloud(monkeypatch)
    h = register_and_login(client, "dep-report", "owner@dep-report.com")
    appt_id = _appointment(client, h)
    page = client.get(f"/api/public/payment/{appt_id}").json()
    assert (page["payment_sent"], page["payment_verified"], page["has_proof"]) == (False, False, False)

    # the picture — an image only
    assert client.post(f"/api/public/payment/{appt_id}/proof", files={"file": ("x.txt", b"not an image", "text/plain")}).status_code == 400
    r = client.post(f"/api/public/payment/{appt_id}/proof", files={"file": ("bit.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    assert saved and saved[0].startswith("deposit-proofs/")

    # "שילמתי" — the business is told: the bell, and a push to the owner, opening the appointment in the calendar
    assert client.post(f"/api/public/payment/{appt_id}/confirm", json={"notes": "שילמתי מהחשבון של אמא"}).status_code == 200
    assert client.post(f"/api/public/payment/{appt_id}/confirm", json={}).status_code == 200      # twice — told once
    [n] = db_session.scalars(select(Notification).where(Notification.type == "deposit_reported")).all()
    assert n.action_url == f"/calendar?appt={appt_id}" and "שי גבריאלי" in n.body and "₪200" in n.body and "עם צילום" in n.body
    pushes = db_session.scalars(select(MessageJob).where(MessageJob.channel == "push", MessageJob.reminder_type == "deposit_reported")).all()
    assert len(pushes) == 1 and pushes[0].deep_link == f"/calendar?appt={appt_id}"

    # the calendar and the deposits list see it
    a = client.get(f"/api/appointments/{appt_id}", headers=h).json()
    assert a["payment_sent_at"] and a["payment_proof_url"].startswith("https://img.test/") and a["payment_verified_at"] is None
    [pending] = client.get("/api/appointments/pending-deposits", headers=h).json()
    assert pending["payment_proof_url"] == a["payment_proof_url"]
    assert "שילמתי מהחשבון של אמא" in db_session.get(Appointment, a["id"]).notes

    # approved — the page says so, and no more pictures
    assert client.post(f"/api/appointments/{appt_id}/verify-payment", headers=h, params={"send_receipt": False}).status_code == 200
    assert client.get(f"/api/public/payment/{appt_id}").json()["payment_verified"] is True
    assert client.post(f"/api/public/payment/{appt_id}/proof", files={"file": ("bit.png", _png(), "image/png")}).status_code == 409
    assert client.get(f"/api/appointments/{appt_id}", headers=h).json()["payment_verified_at"]


def test_a_picture_sent_after_the_report_is_told_too(client, db_session, monkeypatch):
    _no_cloud(monkeypatch)
    h = register_and_login(client, "dep-later", "owner@dep-later.com")
    appt_id = _appointment(client, h)
    client.post(f"/api/public/payment/{appt_id}/confirm", json={})
    [first] = db_session.scalars(select(Notification).where(Notification.type == "deposit_reported")).all()
    assert "עם צילום" not in first.body
    client.post(f"/api/public/payment/{appt_id}/proof", files={"file": ("bit.png", _png(), "image/png")})
    assert db_session.scalars(select(Notification).where(Notification.type == "deposit_proof")).all()


def test_no_deposit_no_report_and_a_worker_cannot_approve(client):
    h = register_and_login(client, "dep-guard", "owner@dep-guard.com")
    free = _appointment(client, h, deposit_cents=0, phone="0524448809")
    assert client.post(f"/api/public/payment/{free}/confirm", json={}).status_code == 409
    assert client.post("/api/public/payment/00000000-0000-0000-0000-000000000001/confirm", json={}).status_code == 404

    appt_id = _appointment(client, h)
    r = client.post("/api/users/artists", headers=h, json={"email": "w@dep-guard.com", "password": "secret123", "display_name": "דנה", "role": "artist"})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": "w@dep-guard.com", "password": "secret123"}).json()["access_token"]
    assert client.post(f"/api/appointments/{appt_id}/verify-payment", headers={"Authorization": f"Bearer {t}"}).status_code == 403


def test_the_messages_send_the_client_to_the_payment_page(client, db_session):
    h = register_and_login(client, "dep-msg", "owner@dep-msg.com")
    client.patch("/api/studio/automation", headers=h, json={"bit_link": "https://bit.example/pay"})
    appt_id = _appointment(client, h)
    bodies = [j.body for j in db_session.scalars(select(MessageJob).where(MessageJob.appointment_id == appt_id,
                                                                          MessageJob.channel == "whatsapp")).all()]
    confirmation = next(b for b in bodies if "מקדמה" in b)
    assert f"/pay/{appt_id}" in confirmation and "שילמתי" in confirmation and "אסמכתא" not in confirmation

    assert client.post(f"/api/appointments/{appt_id}/send-deposit-reminder", headers=h).status_code == 200
    reminder = db_session.scalar(select(MessageJob).where(MessageJob.appointment_id == appt_id,
                                                          MessageJob.reminder_type == "deposit_24h"))
    assert f"/pay/{appt_id}" in reminder.body and "שילמתי" in reminder.body
