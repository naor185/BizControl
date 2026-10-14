"""The business's clients and appointments in Excel (owner, 2026-10-14) — the owner only, with his PIN; deleted
clients stay out; what was paid comes from the payments; the activity log says so. Nothing is sent."""
import io
from datetime import datetime, timedelta, timezone

from openpyxl import load_workbook

from tests.conftest import register_and_login


def _setup(client, h):
    me = client.get("/api/auth/me", headers=h).json()
    keep = client.post("/api/clients", headers=h, json={"full_name": "דנה כהן", "phone": "0521112233", "notes": "אוהבת קווים דקים"}).json()
    gone = client.post("/api/clients", headers=h, json={"full_name": "לקוח שנמחק", "phone": "0521112234"}).json()
    assert client.delete(f"/api/clients/{gone['id']}", headers=h).status_code == 204
    start = datetime.now(timezone.utc) + timedelta(days=3)
    a = client.post("/api/appointments", headers=h, json={"client_id": keep["id"], "artist_id": me["id"], "title": "קעקוע קטן",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat(),
                                                          "deposit_amount_cents": 20000}).json()
    assert client.post(f"/api/appointments/{a['id']}/verify-payment", headers=h, params={"send_receipt": False}).status_code == 200


def test_only_the_owner_with_his_pin(client):
    h = register_and_login(client, "exp-shop", "owner@exp-shop.com")
    r = client.post("/api/users/artists", headers=h, json={"email": "deputy@exp-shop.com", "password": "secret123", "display_name": "סגן", "role": "admin"})
    t = client.post("/api/auth/login-by-email", json={"email": "deputy@exp-shop.com", "password": "secret123"}).json()["access_token"]
    assert client.post("/api/data-export", headers={"Authorization": f"Bearer {t}"}, json={"pin": "1234"}).status_code == 403
    assert client.post("/api/data-export", headers=h, json={"pin": "1234"}).status_code == 404          # no PIN yet
    client.post("/api/security/pin/set", headers=h, json={"pin": "4321"})
    assert client.post("/api/data-export", headers=h, json={"pin": "1111"}).status_code == 400          # a wrong one


def test_the_file_has_the_clients_and_the_appointments(client):
    h = register_and_login(client, "exp-file", "owner@exp-file.com")
    _setup(client, h)
    client.post("/api/security/pin/set", headers=h, json={"pin": "4321"})
    r = client.post("/api/data-export", headers=h, json={"pin": "4321"})
    assert r.status_code == 200, r.text
    assert "spreadsheetml" in r.headers["content-type"] and "exp-file" in r.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["לקוחות", "תורים"]
    clients = list(wb["לקוחות"].iter_rows(values_only=True))
    assert [row[0] for row in clients[1:]] == ["דנה כהן"]                     # the deleted one stays out
    assert clients[1][4] == "אוהבת קווים דקים" and clients[1][12] == 200    # notes; paid ₪200 (the deposit)
    appts = list(wb["תורים"].iter_rows(values_only=True))
    assert appts[1][3] == "דנה כהן" and appts[1][5] == "קעקוע קטן" and appts[1][8] == "מתוכנן" and appts[1][11] == 200
    log = client.get("/api/activity", headers=h).json()["items"]
    assert log[0]["text"] == "ייצוא לאקסל: 1 לקוחות ו-1 תורים — הורדה"


def test_by_email_to_the_owner(client, monkeypatch):
    h = register_and_login(client, "exp-mail", "owner@exp-mail.com")
    client.post("/api/security/pin/set", headers=h, json={"pin": "4321"})
    sent = []
    monkeypatch.setattr("app.services.email_center.send_email", lambda db, **kw: sent.append(kw) or True)
    r = client.post("/api/data-export", headers=h, json={"pin": "4321", "deliver": "email"})
    assert r.status_code == 200 and r.json()["email"] == "owner@exp-mail.com"
    assert sent[0]["to_email"] == "owner@exp-mail.com" and sent[0]["attachments"][0]["filename"].endswith(".xlsx")
