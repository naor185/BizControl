"""The day's collection report: every shekel received today is in exactly one part, and the parts add up to the
total (a deposit for a later appointment used to be inside "appointments" and listed again beside it).
Local test database; nothing is sent."""
from datetime import datetime, time, timedelta

import pytz
from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.payment import Payment
from app.models.pos_transaction import PosTransaction
from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def test_the_days_parts_add_up_to_what_came_in(client, db_session):
    h = register_and_login(client, slug="todayrev", email="owner@todayrev.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "todayrev"))
    owner = db_session.scalar(select(User).where(User.studio_id == s.id))
    c = Client(studio_id=s.id, full_name="ימית", phone="0503330001")
    db_session.add(c)
    db_session.flush()
    today = datetime.now(IL).date()
    now = datetime.now(pytz.utc)

    def appt(day):
        start = IL.localize(datetime.combine(day, time(12)))
        a = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="קעקוע", starts_at=start,
                        ends_at=start + timedelta(hours=2))
        db_session.add(a)
        db_session.flush()
        return a

    def pay(a, cents, **kw):
        db_session.add(Payment(studio_id=s.id, client_id=c.id, appointment_id=a.id, amount_cents=cents, currency="ILS",
                               status="paid", type=kw.pop("type", "payment"), method=kw.pop("method", "cash"),
                               created_at=kw.pop("at", now), **kw))

    today_appt, later, earlier = appt(today), appt(today + timedelta(days=5)), appt(today - timedelta(days=3))
    pay(today_appt, 650_000)
    pay(today_appt, 30_000, method="other", notes="[מערכת] הלקוח מימש 300 ש״ח באמצעות נקודות מועדון")   # not money
    pay(later, 20_000)
    pay(earlier, 100_000)
    pay(earlier, 10_000, type="refund", notes="[זיכוי אוטומטי] עבור תשלום")
    pay(earlier, 99_000, at=now - timedelta(days=2))                                                    # not today
    db_session.add(PosTransaction(studio_id=s.id, client_id=c.id, total_cents=5_000, method="cash", status="paid"))
    db_session.commit()

    r = client.get("/api/dashboard/today-revenue", headers=h).json()
    assert (r["appointments_today_cents"], r["deposits_today_cents"], r["earlier_appointments_cents"],
            r["other_payments_cents"], r["pos_revenue_cents"], r["refunds_cents"]) == (650_000, 20_000, 100_000, 0, 5_000, 10_000)
    assert r["total_today_cents"] == 650_000 + 20_000 + 100_000 + 5_000 - 10_000
    assert r["deposits_today"] == [{"client_name": "ימית", "amount_cents": 20_000,
                                    "appointment_date": (today + timedelta(days=5)).isoformat()}]
