"""The monthly goal counts only the business's working days: a business closed on Saturday has no Saturdays left to
fill, so "days left" and "needed per day" leave them out. The owner picks the days (default Sunday–Friday).
Today counts as worked once money came in today, and is one of the days left until then. The month and
the daily chart go by the clock in Israel. Local test database; nothing is sent."""
from datetime import date, datetime, timezone

from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.payment import Payment
from app.models.pos_transaction import PosTransaction
from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login

OCT = "/api/goals/progress?year=2026&month=10"


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def test_days_left_and_needed_per_day_skip_days_off(client, db_session, monkeypatch):
    monkeypatch.setattr("app.repositories.goal_repository.today_il", lambda: date(2026, 10, 4))   # a Sunday
    h = register_and_login(client, slug="workdays", email="owner@workdays.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "workdays"))
    owner = db_session.scalar(select(User).where(User.studio_id == s.id))
    c = Client(studio_id=s.id, full_name="נוי", phone="0502222222")
    db_session.add(c)
    db_session.flush()
    appt = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="קעקוע",
                       starts_at=utc(2026, 10, 2, 8, 0), ends_at=utc(2026, 10, 2, 10, 0))
    db_session.add(appt)
    db_session.flush()
    sale = dict(studio_id=s.id, client_id=c.id, method="cash", status="paid")
    pay = dict(studio_id=s.id, client_id=c.id, appointment_id=appt.id, currency="ILS", status="paid", type="payment")
    db_session.add_all([
        PosTransaction(**sale, total_cents=100_000, created_at=utc(2026, 9, 30, 22, 30)),   # 1 Oct 01:30 in Israel
        Payment(**pay, amount_cents=200_000, method="cash", created_at=utc(2026, 10, 2, 9, 0)),
        Payment(**pay, amount_cents=50_000, method="other", created_at=utc(2026, 10, 2, 9, 30),
                notes="[מערכת] הלקוח מימש 500 ש״ח באמצעות נקודות מועדון"),                  # club points — not money
        PosTransaction(**sale, total_cents=920_000, created_at=utc(2026, 10, 2, 10, 0)),
        PosTransaction(**sale, total_cents=30_000, created_at=utc(2026, 10, 4, 7, 0)),       # today
        PosTransaction(**sale, total_cents=500_000, created_at=utc(2026, 10, 31, 22, 30)),  # 1 Nov 00:30 in Israel
    ])
    db_session.commit()
    assert client.post("/api/goals/?year=2026&month=10", json={"target_amount": 75000}, headers=h).status_code == 200
    assert client.get("/api/studio/automation", headers=h).json()["work_days"] == [0, 1, 2, 3, 4, 5]

    # Sunday–Friday: October 2026 has 5 Saturdays → 26 working days; 1, 2 and 4 October worked (money came in today)
    p = client.get(OCT, headers=h).json()
    assert float(p["current_revenue"]) == 12500
    assert (p["days_in_month"], p["days_elapsed"], p["days_remaining"], p["work_days"]) == (26, 3, 23, [0, 1, 2, 3, 4, 5])
    assert float(p["required_daily_avg"]) == 2717.39       # 62,500 / 23
    assert float(p["current_daily_avg"]) == 4166.67        # 12,500 / 3
    assert [(r["day"], float(r["amount"])) for r in p["daily_revenue"]] == [(1, 1000), (2, 11200), (3, 0), (4, 300)]

    # the next morning, before any money: Monday is still one of the days left
    monkeypatch.setattr("app.repositories.goal_repository.today_il", lambda: date(2026, 10, 5))
    p = client.get(OCT, headers=h).json()
    assert (p["days_elapsed"], p["days_remaining"]) == (3, 23)
    assert float(p["current_daily_avg"]) == 4166.67 and float(p["required_daily_avg"]) == 2717.39
    monkeypatch.setattr("app.repositories.goal_repository.today_il", lambda: date(2026, 10, 4))

    # the month ends at midnight in Israel, not at midnight UTC
    sep = client.get("/api/goals/progress?year=2026&month=9", headers=h).json()
    assert float(sep["current_revenue"]) == 0 and sep["days_remaining"] == 0
    nov = client.get("/api/goals/progress?year=2026&month=11", headers=h).json()
    assert float(nov["current_revenue"]) == 5000 and nov["days_elapsed"] == 0 and nov["daily_revenue"] == []

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
