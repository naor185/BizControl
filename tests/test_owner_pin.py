"""A discount at the till needs the business owner's PIN, whoever is at the till (owner, 2026-10-12)."""
from tests.conftest import register_and_login


def _worker(client, h, email):
    r = client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123",
                                                           "display_name": "עובד", "role": "staff"})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}


def test_the_owners_pin_approves_a_discount_for_a_worker(client):
    h = register_and_login(client, "pin-shop", "owner@pin-shop.com")
    w = _worker(client, h, "staff@pin-shop.com")

    r = client.post("/api/security/pin/verify-owner", headers=w, json={"pin": "1234"})
    assert r.status_code == 404 and "בעל העסק עוד לא הגדיר" in r.json()["detail"]      # no owner PIN yet

    assert client.post("/api/security/pin/set", headers=h, json={"pin": "4321"}).status_code == 200
    client.post("/api/security/pin/set", headers=w, json={"pin": "1111"})          # the worker's own PIN doesn't count

    assert client.post("/api/security/pin/verify-owner", headers=w, json={"pin": "1111"}).status_code == 400
    r = client.post("/api/security/pin/verify-owner", headers=w, json={"pin": "4321"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert client.post("/api/security/pin/verify-owner", headers=h, json={"pin": "4321"}).status_code == 200


def test_wrong_owner_pins_lock_it_and_the_own_pin_still_works(client):
    h = register_and_login(client, "pin-lock", "owner@pin-lock.com")
    client.post("/api/security/pin/set", headers=h, json={"pin": "4321"})
    answers = [client.post("/api/security/pin/verify-owner", headers=h, json={"pin": "0000"}) for _ in range(5)]
    assert [a.status_code for a in answers] == [400, 400, 400, 400, 429]
    assert "נותרו 4" in answers[0].json()["detail"]
    assert client.post("/api/security/pin/verify-owner", headers=h, json={"pin": "4321"}).status_code == 429
