"""The owner's details and password protected (the owner, 2026-10-19): the team list shows the e-mails (each one's
sign-in) only to who manages the team, the owner's only to the owner; the owner's password is never changed from the
team screen — only in the settings, with the current one."""
from tests.conftest import register_and_login


def _member(client, owner, email, role):
    r = client.post("/api/users/artists", headers=owner, json={"email": email, "password": "secret123", "role": role,
                                                               "display_name": email.split("@")[0]})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}, r.json()["id"]


def test_the_owners_details_are_protected(client):
    owner = register_and_login(client, "own-safe", "owner@own-safe.com")
    worker, _ = _member(client, owner, "dana@own-safe.com", "staff")
    manager, _ = _member(client, owner, "ron@own-safe.com", "admin")

    emails = lambda h: {u["display_name"] or u["role"]: u["email"] for u in client.get("/api/users/artists", headers=h).json()}
    seen_by_owner = emails(owner)
    assert "owner@own-safe.com" in seen_by_owner.values() and "dana@own-safe.com" in seen_by_owner.values()
    assert set(emails(worker).values()) == {""}                      # a worker sees names, no sign-ins
    assert "owner@own-safe.com" not in emails(manager).values()      # nor a manager the owner's

    me = next(u for u in client.get("/api/users/artists", headers=owner).json() if u["role"] == "owner")
    r = client.patch(f"/api/users/artists/{me['id']}", headers=owner, json={"password": "taken-over"})
    assert r.status_code == 403
    assert client.post("/api/auth/login-by-email", json={"email": "owner@own-safe.com", "password": "password123"}).status_code == 200
    assert client.patch(f"/api/users/artists/{me['id']}", headers=owner, json={"display_name": "נאור"}).status_code == 200
    assert client.patch(f"/api/users/artists/{me['id']}", headers=manager, json={"display_name": "x"}).status_code == 403
