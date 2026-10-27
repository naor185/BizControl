"""Each worker's sales goal and ויקי's words about their month (the owner, 2026-10-27): their sales are the payments
on their appointments and what they sold at the till, less what was given back; the owner sets the goal; the worker
sees their own progress — the goal, their tasks, their appointments. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

import pytz

from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _worker(client, h, email):
    r = client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123", "display_name": "דנה", "role": "artist"})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return r.json()["id"], {"Authorization": f"Bearer {t}"}


def test_the_goal_the_sales_and_her_words(client):
    h = register_and_login(client, "goal-shop", "owner@goal-shop.com")
    w_id, w = _worker(client, h, "w@goal-shop.com")
    c = client.post("/api/clients", headers=h, json={"full_name": "שי", "phone": "0521113301"}).json()
    start = datetime.now(timezone.utc) - timedelta(hours=2)
    a = client.post("/api/appointments", headers=h, json={"client_id": c["id"], "artist_id": w_id, "title": "קעקוע",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()}).json()
    pay = client.post("/api/payments", headers=h, json={"appointment_id": a["id"], "client_id": c["id"], "amount_cents": 60000,
                                                        "type": "payment", "method": "cash", "send_receipt": False})
    assert pay.status_code == 201, pay.text
    sale = client.post("/api/pos/checkout", headers=h, json={"items": [{"description": "עגיל", "quantity": 1, "unit_price_cents": 20000}],
                                                             "method": "cash", "performer_id": w_id, "send_receipt": False})
    assert sale.status_code == 200, sale.text

    # the owner sets the goal; everyone's month
    r = client.put(f"/api/workers/{w_id}/goal", headers=h, json={"target": 1000})
    assert r.status_code == 200, r.text
    assert (r.json()["sales"], r.json()["goal"], r.json()["percent"]) == (800, 1000, 80)
    [mine] = [p for p in client.get("/api/workers/progress", headers=h).json() if p["user_id"] == w_id]
    assert mine["sales"] == 800

    # the worker's own — ויקי's words
    me = client.get("/api/workers/me", headers=w).json()
    assert me["lines"][0]["text"].startswith("כבר שלושה רבעים מהיעד! החודש: ₪800 מתוך היעד שלך, ₪1,000 (80%).")
    assert me["lines"][0]["tone"] == "good"

    # a credit note takes it off
    assert client.post(f"/api/payments/{pay.json()['id']}/credit", headers=h).status_code == 200
    assert client.get("/api/workers/me", headers=w).json()["sales"] == 200


def test_her_tasks_in_time_and_late(client):
    h = register_and_login(client, "goal-tasks", "owner@goal-tasks.com")
    w_id, w = _worker(client, h, "w@goal-tasks.com")
    today = datetime.now(IL).date()
    day = today - timedelta(days=1) if today.day > 1 else today
    times = {} if today.day > 1 else {"start_time": "00:00", "end_time": "00:01"}
    ids = []
    for title in ("לנקות את העמדה", "להזמין דיו"):
        r = client.post("/api/tasks", headers=h, json={"title": title, "task_date": day.isoformat(), "assignee_id": w_id, **times})
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    assert client.post(f"/api/tasks/{ids[0]}/done", headers=w, json={"date": day.isoformat()}).status_code == 204
    t = client.get("/api/workers/me", headers=w).json()["tasks"]
    assert (t["total"], t["done"], t["late"]) == (2, 1, 1)
    words = [x["text"] for x in client.get("/api/workers/me", headers=w).json()["lines"]]
    assert any(x.startswith("המשימות החודש: 1 מתוך 2 בוצעו") and "1 עוד מחכות" in x for x in words)


def test_only_who_manages_the_team_sets_and_sees_everyones(client):
    h = register_and_login(client, "goal-guard", "owner@goal-guard.com")
    w_id, w = _worker(client, h, "w@goal-guard.com")
    assert client.get("/api/workers/progress", headers=w).status_code == 403
    assert client.put(f"/api/workers/{w_id}/goal", headers=w, json={"target": 5000}).status_code == 403
    other = register_and_login(client, "goal-other", "owner@goal-other.com")
    assert client.put(f"/api/workers/{w_id}/goal", headers=other, json={"target": 5000}).status_code == 404
    assert client.get("/api/workers/me", headers=w).json()["lines"][0]["text"].endswith("עוד לא נקבע לך יעד חודשי.")
