"""לוח בקרה tidied (the owner, 2026-10-15): the calendar's fill counts only the business's working days ("98 hours" made
no sense), and the club's size is no longer on it (it's in the clients' screen). Local test database."""
from datetime import datetime, timedelta

import pytz
from sqlalchemy import select

from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def test_the_fill_counts_working_days_only_and_says_it_simply(client, db_session):
    h = register_and_login(client, "fill-shop", "owner@fill-shop.com")
    studio = db_session.scalar(select(Studio).where(Studio.slug == "fill-shop"))
    st = db_session.get(StudioSettings, studio.id)
    st.calendar_start_hour, st.calendar_end_hour = "08:00", "18:00"       # 10 hours a day
    st.work_days = [0, 1, 2, 3, 4]                                        # Sunday–Thursday
    db_session.commit()

    me = client.get("/api/auth/me", headers=h).json()
    c = client.post("/api/clients", headers=h, json={"full_name": "דנה לוי", "phone": "0501234567"}).json()
    start = IL.localize(datetime.combine(datetime.now(IL).date(), datetime.min.time().replace(hour=9)))
    r = client.post("/api/appointments", headers=h, json={"client_id": c["id"], "artist_id": me["id"], "title": "קעקוע",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=5)).isoformat()})
    assert r.status_code in (200, 201), r.text

    occ = client.get("/api/dashboard/occupancy", headers=h).json()
    assert set(occ) == {"this_week", "last_week", "this_month", "last_month"}
    assert occ["this_week"] == {"percent": 10, "count": 1}                 # 5 hours of 5 days × 10 hours, not of 7 days
    assert occ["last_week"] == {"percent": 0, "count": 0}

    st.work_days = []                                                     # no working day set — nothing to divide by
    db_session.commit()
    assert client.get("/api/dashboard/occupancy", headers=h).json()["this_week"]["percent"] == 0

    assert "total_club_members" not in client.get("/api/dashboard/stats", headers=h).json()
