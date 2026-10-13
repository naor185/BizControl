"""The owner and the managers fix shifts — a forgotten clock-in, a wrong time; the pay follows (owner, 2026-10-13)."""
from datetime import datetime, timedelta

from tests.conftest import register_and_login


def _worker(client, h, email):
    r = client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123", "display_name": "דנה",
                                                           "role": "staff", "pay_type": "hourly", "hourly_rate": 50})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return r.json()["id"], {"Authorization": f"Bearer {t}"}


def test_the_owner_adds_fixes_and_removes_a_shift_and_a_worker_cant(client):
    owner = register_and_login(client, "shift-shop", "owner@shift-shop.com")
    wid, worker = _worker(client, owner, "dana@shift-shop.com")
    day = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    r = client.post("/api/staff/shifts", headers=owner, json={"user_id": wid, "start_time": f"{day}T09:00", "end_time": f"{day}T13:00"})
    assert r.status_code == 201, r.text
    shift = r.json()
    assert shift["hours"] == 4.0 and shift["pay"] == 200.0 and shift["fixed"] is True          # 4 h × ₪50

    r = client.patch(f"/api/staff/shifts/{shift['id']}", headers=owner, json={"end_time": f"{day}T15:00"})
    assert r.json()["hours"] == 6.0 and r.json()["pay"] == 300.0

    month = day[:7]
    listed = client.get(f"/api/staff/shifts?user_id={wid}&start_date={month}-01T00:00:00&end_date={day}T23:59:59", headers=owner).json()
    assert [s["id"] for s in listed] == [shift["id"]]

    assert client.patch(f"/api/staff/shifts/{shift['id']}", headers=owner, json={"end_time": f"{day}T08:00"}).status_code == 400
    assert client.post("/api/staff/shifts", headers=worker, json={"user_id": wid, "start_time": f"{day}T09:00"}).status_code == 403
    assert client.delete(f"/api/staff/shifts/{shift['id']}", headers=owner).status_code == 204
