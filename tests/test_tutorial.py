"""The guided tour's state per user (the owner, 2026-10-15): kept on the server — started, closed, finished, the steps
skipped — so the phone, the computer and the app agree; each user their own. Local test database."""
from tests.conftest import register_and_login


def test_the_tour_state_is_each_users_own(client):
    owner = register_and_login(client, "tour-shop", "owner@tour-shop.com")
    assert client.get("/api/tutorial", headers=owner).json() == {}               # never started

    r = client.put("/api/tutorial/owner_start", headers=owner, json={"state": "active"})
    assert r.status_code == 200 and r.json() == {"state": "active", "skipped": []}
    r = client.put("/api/tutorial/owner_start", headers=owner, json={"skipped": ["payment", "payment", "nonsense"]})
    assert r.json() == {"state": "active", "skipped": ["payment"]}               # once, and only real steps
    client.put("/api/tutorial/owner_start", headers=owner, json={"state": "dismissed"})
    assert client.get("/api/tutorial", headers=owner).json() == {"owner_start": {"state": "dismissed", "skipped": ["payment"]}}

    other = register_and_login(client, "tour-other", "owner@tour-other.com")
    assert client.get("/api/tutorial", headers=other).json() == {}               # not another user's
    assert client.put("/api/tutorial/no_such_tour", headers=owner, json={"state": "active"}).status_code == 404
    assert client.put("/api/tutorial/owner_start", headers=owner, json={"state": "finished?"}).status_code == 422
