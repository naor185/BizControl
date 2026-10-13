"""What a manager (סגן מנהל) may do — the owner switches each; the server enforces (owner, 2026-10-13). Off by default:
settings, receipts, money, team; on: fixing attendance."""
from tests.conftest import register_and_login


def _manager(client, owner, email):
    r = client.post("/api/users/artists", headers=owner, json={"email": email, "password": "secret123", "display_name": "סגן", "role": "admin"})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return r.json()["id"], {"Authorization": f"Bearer {t}"}


def test_the_owner_decides_what_the_manager_may_do(client):
    owner = register_and_login(client, "perm-shop", "owner@perm-shop.com")
    mid, mgr = _manager(client, owner, "deputy@perm-shop.com")

    assert client.get("/api/auth/me", headers=mgr).json()["permissions"] == {
        "settings": False, "receipts": False, "money": False, "team": False, "attendance": True}
    assert all(client.get("/api/auth/me", headers=owner).json()["permissions"].values())

    assert client.patch("/api/studio/automation", headers=mgr, json={"calendar_start_hour": "08:00"}).status_code == 403
    assert client.get("/api/expenses", headers=mgr).status_code == 403
    assert client.get("/api/invoices", headers=mgr).status_code == 403
    assert client.patch(f"/api/users/artists/{mid}", headers=mgr, json={"display_name": "אני"}).status_code == 403
    assert client.get(f"/api/staff/shifts?user_id={mid}&start_date=2026-10-01T00:00:00&end_date=2026-10-31T23:59:59",
                      headers=mgr).status_code == 200                                          # attendance: on
    assert client.get("/api/studio/automation", headers=mgr).status_code == 200                   # reading is fine

    # only the owner switches them
    assert client.put("/api/users/artists/manager-permissions", headers=mgr, json={"permissions": {"settings": True}}).status_code == 403
    r = client.put("/api/users/artists/manager-permissions", headers=owner, json={"permissions": {"settings": True, "money": True, "nonsense": True}})
    assert r.status_code == 200 and {p["key"]: p["on"] for p in r.json()}["settings"] is True

    assert client.patch("/api/studio/automation", headers=mgr, json={"calendar_start_hour": "08:00"}).status_code == 200
    assert client.get("/api/expenses", headers=mgr).status_code == 200
    assert client.get("/api/invoices", headers=mgr).status_code == 403                          # receipts still off
