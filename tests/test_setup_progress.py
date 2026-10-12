"""The business setup checklist marks a step done the moment it's done (owner, 2026-10-12)."""
from tests.conftest import register_and_login


def _step(client, h, step_id):
    items = client.get("/api/dashboard/setup-progress", headers=h).json()["items"]
    return next(i for i in items if i["id"] == step_id)["done"]


def test_adding_a_manager_completes_the_staff_step(client):
    h = register_and_login(client, "setup-shop", "owner@setup-shop.com")
    assert _step(client, h, "staff_member") is False
    r = client.post("/api/users/artists", headers=h, json={"email": "manager@setup-shop.com", "password": "secret123",
                                                           "display_name": "מנהלת", "role": "admin"})
    assert r.status_code == 201, r.text
    assert _step(client, h, "staff_member") is True
