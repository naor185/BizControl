"""Where I'm signed in — one line per login still alive, signing a device out ends its whole login, "sign out every
other device", and the long-expired rows go (owner, 2026-10-14: 1,236 "devices" for 13 real ones)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.refresh_token import RefreshToken
from app.services import login_sessions
from tests.conftest import register_and_login


def _login(client, email):
    r = client.post("/api/auth/login-by-email", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text
    return r.json()


def test_one_line_per_login_and_signing_out(client, db_session):
    h = register_and_login(client, "dev-shop", "owner@dev-shop.com")
    a = _login(client, "owner@dev-shop.com")
    b = _login(client, "owner@dev-shop.com")
    for _ in range(3):                                            # login a refreshes — still one device
        a = client.post("/api/auth/refresh", json={"refresh_token": a["refresh_token"]}).json()

    listed = client.get("/api/auth/sessions", headers=h).json()
    assert len(listed) == 3                                       # register_and_login's own, a, b

    # a row of a login long expired — not a device, and the night's cleaning deletes it
    old = db_session.scalars(select(RefreshToken)).first()
    stale = RefreshToken(studio_id=old.studio_id, user_id=old.user_id, token="stale-token", is_revoked=False,
                         session_started_at=datetime.now(timezone.utc) - timedelta(days=90),
                         created_at=datetime.now(timezone.utc) - timedelta(days=90))
    db_session.add(stale)
    db_session.commit()
    assert len(client.get("/api/auth/sessions", headers=h).json()) == 3
    assert login_sessions.purge_expired(db_session) >= 1
    assert db_session.scalar(select(RefreshToken).where(RefreshToken.token == "stale-token")) is None

    # signing b's device out ends that login
    b_row = next(s for s in listed if s["id"] == str(db_session.scalar(select(RefreshToken.id).where(RefreshToken.token == b["refresh_token"]))))
    assert client.delete(f"/api/auth/sessions/{b_row['id']}", headers=h).status_code == 204
    assert client.post("/api/auth/refresh", json={"refresh_token": b["refresh_token"]}).status_code == 401
    assert len(client.get("/api/auth/sessions", headers=h).json()) == 2

    # every other device but a's
    r = client.post("/api/auth/sessions/revoke-others", headers=h, json={"refresh_token": a["refresh_token"]})
    assert r.status_code == 200 and r.json()["signed_out"] == 1
    assert len(client.get("/api/auth/sessions", headers=h).json()) == 1
    assert client.post("/api/auth/sessions/revoke-others", headers=h, json={"refresh_token": "not-mine"}).status_code == 400
