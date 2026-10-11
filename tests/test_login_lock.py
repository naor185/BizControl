"""Sign-in lock (owner, 2026-10-11): every wrong password says how many tries are left, a locked account says so at
once, and a successful password reset lifts the lock — a user who reset after ~8 wrong tries was still locked for 14
minutes."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.core.security import create_set_password_token
from app.models.user import User
from app.services import auth_service
from tests.conftest import register_and_login


@pytest.fixture()
def alerts(monkeypatch):
    sent = []
    monkeypatch.setattr(auth_service, "_send_login_alert", lambda db, user, count, reason: sent.append((user.email, count)))
    return sent


def _wrong(client, email, path="/api/auth/login-by-email"):
    return client.post(path, json={"email": email, "password": "wrong-password-1"})


def test_tries_left_then_lock_then_reset_lets_them_in(client, db_session, alerts):
    register_and_login(client, "lock-a", "lock-a@example.com")

    answers = [_wrong(client, "lock-a@example.com") for _ in range(5)]
    assert [(r.status_code, r.json()["detail"]) for r in answers[:4]] == [
        (401, "invalid_credentials:4"), (401, "invalid_credentials:3"),
        (401, "invalid_credentials:2"), (401, "invalid_credentials:1"),
    ]
    assert answers[4].status_code == 423 and answers[4].json()["detail"].startswith("account_locked:")
    assert alerts == [("lock-a@example.com", 5)]

    # the right password is still refused while locked
    r = client.post("/api/auth/login-by-email", json={"email": "lock-a@example.com", "password": "password123"})
    assert r.status_code == 423

    # a successful reset lifts the lock — the new password works at once
    user = db_session.query(User).filter(User.email == "lock-a@example.com").one()
    r = client.post("/api/auth/set-password", json={"token": create_set_password_token(str(user.id)), "new_password": "newpass456"})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login-by-email", json={"email": "lock-a@example.com", "password": "newpass456"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]


def test_unknown_email_gets_the_same_answers(client, alerts):
    answers = [_wrong(client, "nobody-here@example.com") for _ in range(5)]
    assert [r.json()["detail"] for r in answers[:4]] == [f"invalid_credentials:{n}" for n in (4, 3, 2, 1)]
    assert answers[4].status_code == 423 and answers[4].json()["detail"].startswith("account_locked:")
    assert alerts == []


def test_a_lock_that_ran_out_starts_a_fresh_count(client, db_session, alerts):
    register_and_login(client, "lock-b", "lock-b@example.com")
    for _ in range(5):
        _wrong(client, "lock-b@example.com")
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.execute(text("UPDATE login_failure_tracking SET locked_until = :t WHERE email = 'lock-b@example.com'"), {"t": past})
    db_session.commit()

    r = _wrong(client, "lock-b@example.com")
    assert (r.status_code, r.json()["detail"]) == (401, "invalid_credentials:4")


def test_changing_the_password_lifts_the_lock(client, db_session, alerts):
    headers = register_and_login(client, "lock-c", "lock-c@example.com")
    for _ in range(5):
        _wrong(client, "lock-c@example.com")
    r = client.post("/api/auth/change-password", headers=headers,
                    json={"current_password": "password123", "new_password": "newpass789"})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login-by-email", json={"email": "lock-c@example.com", "password": "newpass789"})
    assert r.status_code == 200, r.text


def test_bizfind_business_sign_in_says_tries_left(client, alerts):
    register_and_login(client, "lock-d", "lock-d@example.com")
    r = _wrong(client, "lock-d@example.com", "/api/marketplace/auth/login")
    assert (r.status_code, r.json()["detail"]) == (401, "invalid_credentials:4")


def test_the_owner_giving_a_worker_a_new_password_lifts_the_lock(client, alerts):
    h = register_and_login(client, "lock-e", "lock-e@example.com")
    w = client.post("/api/users/artists", headers=h, json={"email": "worker@lock-e.com", "password": "secret123",
                                                           "display_name": "עובד", "role": "artist"}).json()
    for _ in range(5):
        _wrong(client, "worker@lock-e.com")
    assert client.patch(f"/api/users/artists/{w['id']}", headers=h, json={"password": "fresh2026"}).status_code == 200
    r = client.post("/api/auth/login-by-email", json={"email": "worker@lock-e.com", "password": "fresh2026"})
    assert r.status_code == 200, r.text
