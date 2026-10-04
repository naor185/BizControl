"""The monthly goal counts only the business's working days: a business closed on Saturday has no Saturdays left to
fill, so "days left" and "needed per day" leave them out. The owner picks the days (default Sunday–Friday).
Local test database; nothing is sent."""
from datetime import date, datetime, timezone

from sqlalchemy import select

from app.models.client import Client
from app.models.pos_transaction import PosTransaction
from app.models.studio import Studio
from tests.conftest import register_and_login

OCT = "/api/goals/progress?year=2026&month=10"


def test_days_left_and_needed_per_day_skip_days_off(client, db_session, monkeypatch):
    monkeypatch.setattr("app.repositories.goal_repository.today_il", lambda: date(2026, 10, 4))   # a Sunday
    h = register_and_login(client, slug="workdays", email="owner@workdays.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "workdays"))
    c = Client(studio_id=s.id, full_name="נוי", phone="0502222222")
    db_session.add(c)
    db_session.flush()
    db_session.add(PosTransaction(studio_id=s.id, client_id=c.id, total_cents=1_220_000, method="cash", status="paid",
                                  created_at=datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc)))
    db_session.commit()
    assert client.post("/api/goals/?year=2026&month=10", json={"target_amount": 75000}, headers=h).status_code == 200
    assert client.get("/api/studio/automation", headers=h).json()["work_days"] == [0, 1, 2, 3, 4, 5]

    # Sunday–Friday: October 2026 has 5 Saturdays → 26 working days; 1, 2 and 4 October have passed
    p = client.get(OCT, headers=h).json()
    assert (p["days_in_month"], p["days_elapsed"], p["days_remaining"], p["work_days"]) == (26, 3, 23, [0, 1, 2, 3, 4, 5])
    assert float(p["required_daily_avg"]) == 2730.43       # 62,800 / 23, not / 27
    assert float(p["current_daily_avg"]) == 4066.67        # 12,200 / 3

    # Sunday–Thursday: Fridays are off too
    r = client.patch("/api/studio/automation", json={"work_days": [4, 0, 3, 1, 2, 2]}, headers=h)
    assert r.status_code == 200 and r.json()["work_days"] == [0, 1, 2, 3, 4]
    p = client.get(OCT, headers=h).json()
    assert (p["days_in_month"], p["days_elapsed"], p["days_remaining"]) == (21, 2, 19)

    # every day of the week — the whole month counts
    client.patch("/api/studio/automation", json={"work_days": [0, 1, 2, 3, 4, 5, 6]}, headers=h)
    p = client.get(OCT, headers=h).json()
    assert (p["days_in_month"], p["days_elapsed"], p["days_remaining"]) == (31, 4, 27)

    # no working day at all, or a day that does not exist, is refused
    assert client.patch("/api/studio/automation", json={"work_days": []}, headers=h).status_code == 422
    assert client.patch("/api/studio/automation", json={"work_days": [7]}, headers=h).status_code == 422
