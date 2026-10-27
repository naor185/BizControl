"""What a regular worker may do — the owner's switches, per worker (the owner, 2026-10-27: "and what about a regular
worker?"): the whole team's calendar, payments and deposits, the till, clients and leads. All off by default — the
worker's own calendar only; each one opens on the server exactly what it says. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

from tests.conftest import register_and_login


def _worker(client, h, email, role="artist"):
    r = client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123", "display_name": "דנה", "role": role})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return r.json()["id"], {"Authorization": f"Bearer {t}"}


def _appointment(client, h, artist_id, phone, days=1):
    c = client.post("/api/clients", headers=h, json={"full_name": "שי גבריאלי", "phone": phone}).json()
    start = datetime.now(timezone.utc) - timedelta(days=days)
    a = client.post("/api/appointments", headers=h, json={"client_id": c["id"], "artist_id": artist_id, "title": "קעקוע",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat(),
                                                          "deposit_amount_cents": 10000})
    assert a.status_code in (200, 201), a.text
    return a.json()["id"], c["id"]


def _pay(client, h, appt_id, client_id):
    return client.post("/api/payments", headers=h, json={"appointment_id": appt_id, "client_id": client_id, "amount_cents": 5000,
                                                         "type": "payment", "method": "cash", "send_receipt": False})


def _set(client, h, worker_id, **perms):
    r = client.put(f"/api/users/artists/{worker_id}/worker-permissions", headers=h, json={"permissions": perms})
    assert r.status_code == 200, r.text
    return {p["key"]: p["on"] for p in r.json()}


def test_off_by_default_the_workers_own_calendar_only(client):
    h = register_and_login(client, "wp-off", "owner@wp-off.com")
    owner_id = client.get("/api/auth/me", headers=h).json()["id"]
    w_id, w = _worker(client, h, "w@wp-off.com")
    mine, mine_client = _appointment(client, h, w_id, "0521110001")
    other, _ = _appointment(client, h, owner_id, "0521110002")

    me = client.get("/api/auth/me", headers=w).json()
    assert me["worker_permissions"] == {"all_calendars": False, "payments": False, "pos": False, "clients": False}
    assert client.get("/api/auth/me", headers=h).json()["worker_permissions"] is None        # the owner isn't a worker

    seen = {a["id"] for a in client.get("/api/appointments", headers=w).json()}
    assert mine in seen and other not in seen
    assert client.get(f"/api/appointments/{other}", headers=w).status_code == 403                # not even by its id
    assert client.get("/api/clients", headers=w).status_code == 200                              # the calendar finds clients
    for url in ("/api/pos/history", "/api/products", "/api/leads", f"/api/clients/{mine_client}/profile", "/api/clients/counts"):
        assert client.get(url, headers=w).status_code == 403, url
    assert _pay(client, w, mine, mine_client).status_code == 403                                 # money — not without it
    assert client.post(f"/api/appointments/{mine}/verify-payment", headers=w, params={"send_receipt": False}).status_code == 403
    assert client.post("/api/payment-requests", headers=w, json={"client_id": mine_client, "appointment_id": mine, "amount_cents": 5000}).status_code == 403


def test_each_switch_opens_what_it_says(client):
    h = register_and_login(client, "wp-on", "owner@wp-on.com")
    owner_id = client.get("/api/auth/me", headers=h).json()["id"]
    w_id, w = _worker(client, h, "w@wp-on.com", role="staff")
    mine, mine_client = _appointment(client, h, w_id, "0521110003")
    other, other_client = _appointment(client, h, owner_id, "0521110004")

    # the till — sells and reads the products, doesn't manage them; redeems a gift card, doesn't manage them
    assert _set(client, h, w_id, pos=True)["pos"] is True
    assert client.get("/api/auth/me", headers=w).json()["worker_permissions"]["pos"] is True
    assert client.get("/api/pos/history", headers=w).status_code == 200
    assert client.get("/api/products", headers=w).status_code == 200
    assert client.post("/api/products", headers=w, json={"name": "עגיל", "price": 50}).status_code == 403
    assert client.post("/api/gift-cards/redeem", headers=w, json={"code": "NOPE", "amount_cents": 100}).status_code != 403
    assert client.get("/api/gift-cards", headers=w).status_code == 403

    # clients and leads — the card and the leads; deleting a client and the analytics stay the management's
    _set(client, h, w_id, clients=True)
    assert client.get(f"/api/clients/{mine_client}/profile", headers=w).status_code == 200
    assert client.get("/api/leads", headers=w).status_code == 200
    assert client.get("/api/clients/analytics", headers=w).status_code == 403
    assert client.delete(f"/api/clients/{other_client}", headers=w).status_code == 403

    # payments — on their own appointments; another's only with the team's calendar
    _set(client, h, w_id, payments=True)
    assert _pay(client, w, mine, mine_client).status_code == 201
    assert _pay(client, w, other, other_client).status_code == 403
    assert client.post(f"/api/appointments/{mine}/verify-payment", headers=w, params={"send_receipt": False}).status_code == 200

    # the whole team's calendar
    _set(client, h, w_id, all_calendars=True)
    assert other in {a["id"] for a in client.get("/api/appointments", headers=w).json()}
    assert client.get(f"/api/appointments/{other}", headers=w).status_code == 200
    assert _pay(client, w, other, other_client).status_code == 201

    # and off again — closed again at once
    _set(client, h, w_id, all_calendars=False, pos=False)
    assert client.get(f"/api/appointments/{other}", headers=w).status_code == 403
    assert client.get("/api/pos/history", headers=w).status_code == 403


def test_only_the_owner_sets_them_and_only_for_a_worker_of_theirs(client):
    h = register_and_login(client, "wp-own", "owner@wp-own.com")
    w_id, w = _worker(client, h, "w@wp-own.com")
    m_id, m = _worker(client, h, "m@wp-own.com", role="admin")
    assert client.put(f"/api/users/artists/{w_id}/worker-permissions", headers=m, json={"permissions": {"pos": True}}).status_code == 403
    assert client.put(f"/api/users/artists/{w_id}/worker-permissions", headers=w, json={"permissions": {"pos": True}}).status_code == 403
    assert client.put(f"/api/users/artists/{m_id}/worker-permissions", headers=h, json={"permissions": {"pos": True}}).status_code == 400
    other = register_and_login(client, "wp-other", "owner@wp-other.com")
    assert client.put(f"/api/users/artists/{w_id}/worker-permissions", headers=other, json={"permissions": {"pos": True}}).status_code == 404
    assert client.get(f"/api/users/artists/{w_id}/worker-permissions", headers=h).json()[0]["key"] == "all_calendars"
