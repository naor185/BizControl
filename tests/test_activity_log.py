"""The business's activity log — who did what, and when (owner, 2026-10-13) — and what a manager never does on the team:
touch the owner or another manager, make someone a manager, fix his own shifts, or wipe pay he can't see."""
from datetime import datetime, timedelta, timezone

from tests.conftest import register_and_login


def _add(client, owner, email, role, **pay):
    r = client.post("/api/users/artists", headers=owner, json={"email": email, "password": "secret123",
                                                                "display_name": email.split("@")[0], "role": role, **pay})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return r.json()["id"], {"Authorization": f"Bearer {t}"}


def _log(client, owner, **q):
    r = client.get("/api/activity", headers=owner, params=q)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_owner_sees_who_did_what(client):
    owner = register_and_login(client, "log-shop", "owner@log-shop.com")
    mid, mgr = _add(client, owner, "deputy@log-shop.com", "admin")
    assert client.put("/api/users/artists/manager-permissions", headers=owner,
                      json={"permissions": {"settings": True}}).status_code == 200

    assert client.patch("/api/studio/automation", headers=mgr, json={"calendar_start_hour": "07:00"}).status_code == 200
    assert client.patch("/api/studio/automation", headers=mgr, json={"calendar_start_hour": "07:00"}).status_code == 200  # nothing changed

    log = _log(client, owner)
    assert [i["text"] for i in log["items"]] == [            # the newest first
        "שינוי הגדרות: שעות היומן",
        "סגן מנהל — הותר: שינוי הגדרות העסק",
        "הוספה לצוות: deputy (סגן מנהל)",
    ]
    assert log["items"][0]["name"] == "deputy" and log["items"][0]["area"] == "settings"
    assert [i["text"] for i in _log(client, owner, person=mid)["items"]] == ["שינוי הגדרות: שעות היומן"]
    assert [i["area"] for i in _log(client, owner, area="team")["items"]] == ["team", "team"]
    assert {p["id"] for p in log["people"]} >= {mid}

    # the log is the owner's — not the manager's, not another business's
    assert client.get("/api/activity", headers=mgr).status_code == 403
    other = register_and_login(client, "log-other", "owner@log-other.com")
    assert _log(client, other)["items"] == []

    # paging
    first = _log(client, owner, limit=1)
    assert first["more"] is True and len(first["items"]) == 1
    rest = _log(client, owner, before=first["items"][0]["at"])
    assert [i["id"] for i in rest["items"]] == [i["id"] for i in log["items"][1:]]


def test_a_manager_never_touches_the_owner_or_the_managers(client):
    owner = register_and_login(client, "team-guard", "owner@team-guard.com")
    me = client.get("/api/auth/me", headers=owner).json()
    mid, mgr = _add(client, owner, "deputy@team-guard.com", "admin")
    other_mid, _ = _add(client, owner, "second@team-guard.com", "admin")
    wid, _ = _add(client, owner, "noa@team-guard.com", "artist", pay_type="hourly", hourly_rate=60)
    client.put("/api/users/artists/manager-permissions", headers=owner, json={"permissions": {"team": True}})

    assert client.patch(f"/api/users/artists/{me['id']}", headers=mgr, json={"password": "hacked123"}).status_code == 403
    assert client.delete(f"/api/users/artists/{me['id']}", headers=mgr).status_code == 403
    assert client.patch(f"/api/users/artists/{other_mid}", headers=mgr, json={"is_active": False}).status_code == 403
    assert client.patch(f"/api/users/artists/{wid}", headers=mgr, json={"role": "admin"}).status_code == 403

    # his screen shows zeros instead of the pay he may not see — saving a worker keeps her pay
    r = client.patch(f"/api/users/artists/{wid}", headers=mgr,
                     json={"display_name": "נועה", "role": "artist", "pay_type": "none", "hourly_rate": 0})
    assert r.status_code == 200, r.text
    noa = next(u for u in client.get("/api/users/artists", headers=owner).json() if u["id"] == wid)
    assert noa["display_name"] == "נועה" and noa["pay_type"] == "hourly" and float(noa["hourly_rate"]) == 60
    assert _log(client, owner, person=mid)["items"][0]["text"] == "עדכון נועה: שם"

    # the owner saving his own row (the screen sends "artist") stays the owner
    assert client.patch(f"/api/users/artists/{me['id']}", headers=owner,
                        json={"display_name": "הבעלים", "role": "artist"}).status_code == 200
    assert client.get("/api/auth/me", headers=owner).json()["role"] == "owner"


def test_a_manager_fixes_the_workers_shifts_not_his_own(client):
    owner = register_and_login(client, "shift-guard", "owner@shift-guard.com")
    mid, mgr = _add(client, owner, "deputy@shift-guard.com", "admin")
    wid, _ = _add(client, owner, "noa@shift-guard.com", "artist", pay_type="hourly", hourly_rate=50)
    start = (datetime.now(timezone.utc) - timedelta(days=1)).replace(hour=6, minute=0, second=0, microsecond=0)
    shift = {"start_time": start.isoformat(), "end_time": (start + timedelta(hours=8)).isoformat()}

    assert client.post("/api/staff/shifts", headers=mgr, json={"user_id": mid, **shift}).status_code == 403
    r = client.post("/api/staff/shifts", headers=mgr, json={"user_id": wid, **shift})
    assert r.status_code == 201, r.text
    assert _log(client, owner, area="attendance")["items"][0]["text"].startswith("הוספת משמרת לnoa: ")
    assert client.post("/api/staff/shifts", headers=owner, json={"user_id": mid, **shift}).status_code == 201


def test_deleting_an_appointment_for_good(client):
    owner = register_and_login(client, "appt-gone", "owner@appt-gone.com")
    me = client.get("/api/auth/me", headers=owner).json()
    c = client.post("/api/clients", headers=owner, json={"full_name": "דנה כהן", "phone": "0521234567"})
    start = datetime.now(timezone.utc) + timedelta(days=3)
    a = client.post("/api/appointments", headers=owner, json={"client_id": c.json()["id"], "artist_id": me["id"], "title": "תור",
                                                              "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()})
    assert a.status_code in (200, 201), a.text
    r = client.delete(f"/api/appointments/{a.json()['id']}", headers=owner, params={"hard_delete": True})
    assert r.status_code == 204, r.text                      # it used to fail after deleting — reading what was gone
    assert _log(client, owner, area="clients")["items"][0]["text"].startswith("מחיקת תור של דנה כהן · ")
