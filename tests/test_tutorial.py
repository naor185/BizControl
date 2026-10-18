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


def _checks(client, h):
    r = client.get("/api/tutorial/checks", headers=h)
    assert r.status_code == 200, r.text
    return r.json()["checks"]


def test_the_working_day_steps_are_done_only_when_they_really_happened(client, db_session):
    """The owner's working day (2026-10-15): a sale at the till, a deposit approved, a task given to a worker — each
    checked against the real data; the task step only where there is someone to give it to."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.models.studio import Studio
    owner = register_and_login(client, "workday-shop", "owner@workday-shop.com")
    db_session.scalar(select(Studio).where(Studio.slug == "workday-shop")).subscription_plan = "pro"
    db_session.commit()
    r = client.get("/api/tutorial/checks", headers=owner).json()
    assert r["name"] is None or isinstance(r["name"], str)
    c = r["checks"]
    assert c["pos_sale"] == {"applies": True, "done": False}
    assert c["deposit_approved"] == {"applies": True, "done": False}
    assert c["task_assigned"] == {"applies": False, "done": False}                # no one to give a task to
    assert "first_service" in c                                                    # the first steps' checks, as before

    sale = client.post("/api/pos/checkout", headers=owner, json={
        "items": [{"description": "טיפוח", "quantity": 1, "unit_price_cents": 5000}], "method": "cash", "send_receipt": False})
    assert sale.status_code == 200, sale.text
    me = client.get("/api/auth/me", headers=owner).json()
    cl = client.post("/api/clients", headers=owner, json={"full_name": "שי גבריאלי", "phone": "0524448808"}).json()
    start = datetime.now(timezone.utc) + timedelta(days=2)
    a = client.post("/api/appointments", headers=owner, json={"client_id": cl["id"], "artist_id": me["id"], "title": "קעקוע",
                                                              "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=2)).isoformat(),
                                                              "deposit_amount_cents": 20000}).json()
    assert _checks(client, owner)["deposit_approved"]["done"] is False                # asked, not yet approved
    assert client.post(f"/api/appointments/{a['id']}/verify-payment", headers=owner, params={"send_receipt": False}).status_code == 200

    w = client.post("/api/users/artists", headers=owner, json={"email": "dana@workday-shop.com", "password": "secret123",
                                                                 "display_name": "dana", "role": "artist"})
    assert w.status_code == 201, w.text
    c = _checks(client, owner)
    assert c["pos_sale"]["done"] and c["deposit_approved"]["done"]
    assert c["task_assigned"] == {"applies": True, "done": False}
    today = datetime.now(timezone.utc).date().isoformat()
    client.post("/api/tasks", headers=owner, json={"title": "ניקיון כללי", "task_date": today})         # the whole team
    assert _checks(client, owner)["task_assigned"]["done"] is False
    client.post("/api/tasks", headers=owner, json={"title": "להזמין דיו", "task_date": today, "assignee_id": w.json()["id"]})
    assert _checks(client, owner)["task_assigned"]["done"] is True


def test_a_worker_has_no_guide(client):
    """The guide is the owner's (the owner, 2026-10-17: no guide for a worker)."""
    owner = register_and_login(client, "worker-tour", "owner@worker-tour.com")
    assert client.post("/api/users/artists", headers=owner, json={"email": "dana@worker-tour.com", "password": "secret123",
                                                                  "display_name": "dana", "role": "artist"}).status_code == 201
    t = client.post("/api/auth/login-by-email", json={"email": "dana@worker-tour.com", "password": "secret123"}).json()["access_token"]
    dana = {"Authorization": f"Bearer {t}"}
    assert client.get("/api/tutorial/checks", headers=dana).status_code == 403
    assert client.put("/api/tutorial/worker_start", headers=dana, json={"state": "active"}).status_code == 404


def test_the_messages_path_takes_its_own_steps(client):
    owner = register_and_login(client, "msg-tour", "owner@msg-tour.com")
    r = client.put("/api/tutorial/owner_messages", headers=owner,
                   json={"state": "active", "skipped": ["messages_where", "messages_off", "pos_sale"]})
    assert r.status_code == 200 and r.json() == {"state": "active", "skipped": ["messages_where", "messages_off"]}
