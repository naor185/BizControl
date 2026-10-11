"""One worker's pay summary PDF (owner, 2026-10-10): the same sums as the team's report and every shift; the
owner and the managers only. Local test database; nothing is sent."""
import os
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models.studio import Studio
from app.models.work_session import WorkSession
from tests.conftest import register_and_login

OCTOBER = "start_date=2026-10-01T00:00:00&end_date=2026-10-31T23:59:59"


def test_a_workers_pay_summary(client, db_session):
    h = register_and_login(client, slug="pay-shop", email="owner@pay-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "pay-shop"))
    w = client.post("/api/users/artists", headers=h, json={"email": "noa@pay-shop.com", "password": "secret123",
                                                           "display_name": "נועה", "role": "artist", "pay_type": "hourly",
                                                           "hourly_rate": 50}).json()
    for day, hours in ((5, 6), (7, 4)):
        start = datetime(2026, 10, day, 7, 0, tzinfo=timezone.utc)
        db_session.add(WorkSession(studio_id=s.id, user_id=w["id"], start_time=start,
                                   end_time=start.replace(hour=7 + hours), session_pay=Decimal(50 * hours)))
    db_session.commit()

    r = client.get(f"/api/staff/payroll/{w['id']}/pdf?{OCTOBER}", headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    if os.getenv("KEEP_PDF"):                                     # to look at it: KEEP_PDF=<path> pytest …
        open(os.environ["KEEP_PDF"], "wb").write(r.content)
    team = client.get(f"/api/staff/payroll?{OCTOBER}", headers=h).json()
    assert float(next(i for i in team["items"] if i["user_id"] == w["id"])["total_pay"]) == 500   # the same sum

    assert client.get(f"/api/staff/payroll/00000000-0000-0000-0000-000000000000/pdf?{OCTOBER}", headers=h).status_code == 404
    worker = client.post("/api/auth/login", json={"studio_slug": "pay-shop", "email": "noa@pay-shop.com",
                                                  "password": "secret123"}).json()["access_token"]
    assert client.get(f"/api/staff/payroll/{w['id']}/pdf?{OCTOBER}",
                      headers={"Authorization": f"Bearer {worker}"}).status_code == 403   # pay is the management's
