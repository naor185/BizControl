"""Whether "ניהול עסק" asks for the PIN — the person's own choice in "החשבון שלי", off unless switched on, and switching
it off needs the PIN (the owner, 2026-10-14: the hub opened on a PIN window nobody chose)."""
from tests.conftest import register_and_login


def _status(client, h):
    return client.get("/api/security/pin/status", headers=h).json()


def test_the_lock_is_a_choice_and_off_needs_the_pin(client):
    h = register_and_login(client, "lock-shop", "owner@lock-shop.com")
    assert _status(client, h)["business_lock"] is False
    lock = lambda body: client.post("/api/security/pin/business-lock", headers=h, json=body)

    assert lock({"on": True}).status_code == 404                   # no PIN yet — nothing to lock with
    client.post("/api/security/pin/set", headers=h, json={"pin": "4321"})
    assert _status(client, h)["business_lock"] is False            # a PIN alone doesn't lock the hub

    assert lock({"on": True}).json() == {"business_lock": True}
    assert _status(client, h)["business_lock"] is True

    # switching it off: only right after the PIN was typed
    assert lock({"on": False}).status_code == 403
    assert lock({"on": False, "business_token": "not-a-token"}).status_code == 403
    assert lock({"on": False, "business_token": h["Authorization"].split()[1]}).status_code == 403   # a login isn't the PIN
    assert client.post("/api/security/pin/verify", headers=h, json={"pin": "1111"}).status_code == 400
    token = client.post("/api/security/pin/verify", headers=h, json={"pin": "4321"}).json()["business_token"]

    other = register_and_login(client, "other-shop", "owner@other-shop.com")
    assert client.post("/api/security/pin/set", headers=other, json={"pin": "9999"}).status_code == 200
    assert client.post("/api/security/pin/business-lock", headers=other, json={"on": True}).status_code == 200
    assert client.post("/api/security/pin/business-lock", headers=other,
                       json={"on": False, "business_token": token}).status_code == 403              # someone else's PIN

    assert lock({"on": False, "business_token": token}).json() == {"business_lock": False}
    assert _status(client, h)["business_lock"] is False
