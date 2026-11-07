"""The pre-launch review, 2026-11-07:
- a code sent by WhatsApp (password reset, BizFind sign-in, business claim) is voided by the fifth wrong try;
- a new password ends every login from before it — the device it was changed on stays signed in, a reset link works
  once, and the owner giving a worker a new password signs the worker out."""
from sqlalchemy import select, text

from app.core.limiter import reset as reset_limits
from app.models.user import User
from app.services.one_time_codes import VOIDED, WRONG
from tests.conftest import register_and_login


def _live_code(db_session, table, phone):
    return db_session.execute(text(f"""SELECT code FROM {table} WHERE phone = :p AND used_at IS NULL
                                       ORDER BY created_at DESC LIMIT 1"""), {"p": phone}).scalar()


def _other(code: str) -> str:
    return str((int(code) + 1) % 10 ** len(code)).zfill(len(code))


def test_a_reset_code_is_voided_by_the_fifth_wrong_try(client, db_session, monkeypatch):
    import app.api.auth_routes as auth_routes
    monkeypatch.setattr(auth_routes, "_send_reset_code_whatsapp", lambda *a, **k: None)
    register_and_login(client, "codes-a", "codes-a@example.com")
    user = db_session.scalar(select(User).where(User.email == "codes-a@example.com"))
    user.phone = "0521234567"
    db_session.commit()

    assert client.post("/api/auth/forgot-password/phone", json={"phone": "052-1234567"}).status_code == 200
    code = _live_code(db_session, "password_reset_otps", "972521234567")
    assert code and len(code) == 6
    for _ in range(4):
        r = client.post("/api/auth/forgot-password/verify-phone", json={"phone": "0521234567", "code": _other(code)})
        assert (r.status_code, r.json()["detail"]) == (400, WRONG)
    r = client.post("/api/auth/forgot-password/verify-phone", json={"phone": "0521234567", "code": _other(code)})
    assert (r.status_code, r.json()["detail"]) == (400, VOIDED)
    # the right code no longer opens anything
    r = client.post("/api/auth/forgot-password/verify-phone", json={"phone": "0521234567", "code": code})
    assert r.status_code == 400

    # a new code, right the first time
    reset_limits()
    assert client.post("/api/auth/forgot-password/phone", json={"phone": "0521234567"}).status_code == 200
    code = _live_code(db_session, "password_reset_otps", "972521234567")
    r = client.post("/api/auth/forgot-password/verify-phone", json={"phone": "0521234567", "code": code})
    assert r.status_code == 200 and r.json()["token"]
    # used once
    r = client.post("/api/auth/forgot-password/verify-phone", json={"phone": "0521234567", "code": code})
    assert r.status_code == 400


def test_a_bizfind_sign_in_code_is_voided_by_the_fifth_wrong_try(client, db_session, monkeypatch):
    import app.api.marketplace_customer_routes as mc
    monkeypatch.setattr(mc, "_send_sms", lambda *a, **k: None)
    phone = "0539876543"
    assert client.post("/api/marketplace/auth/request-otp", json={"phone": phone}).status_code == 200
    code = _live_code(db_session, "marketplace_otps", phone)
    assert code and len(code) == 5
    details = [client.post("/api/marketplace/auth/verify-otp", json={"phone": phone, "code": _other(code)}).json()["detail"]
               for _ in range(5)]
    assert details == [WRONG] * 4 + [VOIDED]
    reset_limits()
    assert client.post("/api/marketplace/auth/verify-otp", json={"phone": phone, "code": code}).status_code == 400

    assert client.post("/api/marketplace/auth/request-otp", json={"phone": phone}).status_code == 200
    code = _live_code(db_session, "marketplace_otps", phone)
    r = client.post("/api/marketplace/auth/verify-otp", json={"phone": phone, "code": code})
    assert r.status_code == 200 and r.json()["token"]


def _login(client, slug, email, password="password123"):
    r = client.post("/api/auth/login", json={"studio_slug": slug, "email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _me(client, access):
    return client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code


def _refresh(client, refresh):
    return client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code


def test_a_new_password_signs_out_every_other_device_and_keeps_this_one(client):
    here = register_and_login(client, "codes-b", "codes-b@example.com")
    phone = _login(client, "codes-b", "codes-b@example.com")            # the same owner on a second device
    assert _me(client, phone["access_token"]) == 200

    r = client.post("/api/auth/change-password", headers=here,
                    json={"current_password": "password123", "new_password": "newpass2026"})
    assert r.status_code == 200, r.text
    new = r.json()

    assert _me(client, phone["access_token"]) == 401                   # the other device is out
    assert _refresh(client, phone["refresh_token"]) == 401             # and can't come back by itself
    assert client.get("/api/auth/me", headers=here).status_code == 401  # the old token of this device too —
    assert _me(client, new["access_token"]) == 200                      # its new one keeps it signed in
    assert _refresh(client, new["refresh_token"]) == 200
    assert _login(client, "codes-b", "codes-b@example.com", "newpass2026")["access_token"]


def test_a_reset_link_works_once_and_signs_everyone_out(client, db_session):
    from app.core.security import create_set_password_token
    here = register_and_login(client, "codes-c", "codes-c@example.com")
    user = db_session.scalar(select(User).where(User.email == "codes-c@example.com"))
    link = create_set_password_token(str(user.id))

    assert client.post("/api/auth/set-password", json={"token": link, "new_password": "reset2026a"}).status_code == 200
    assert client.get("/api/auth/me", headers=here).status_code == 401
    r = client.post("/api/auth/set-password", json={"token": link, "new_password": "again2026b"})
    assert r.status_code == 400
    assert _login(client, "codes-c", "codes-c@example.com", "reset2026a")["access_token"]


def test_the_owner_giving_a_worker_a_new_password_signs_the_worker_out(client):
    h = register_and_login(client, "codes-d", "codes-d@example.com")
    w = client.post("/api/users/artists", headers=h, json={"email": "worker@codes-d.com", "password": "secret123",
                                                           "display_name": "עובד", "role": "artist"}).json()
    worker = _login(client, "codes-d", "worker@codes-d.com", "secret123")
    assert _me(client, worker["access_token"]) == 200

    assert client.patch(f"/api/users/artists/{w['id']}", headers=h, json={"password": "fresh2026"}).status_code == 200
    assert _me(client, worker["access_token"]) == 401
    assert _refresh(client, worker["refresh_token"]) == 401
    assert client.get("/api/auth/me", headers=h).status_code == 200      # the owner is not touched
