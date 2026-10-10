"""Birthday messages: one per birthday whoever sends it (the daily sweep, joining the club, the owner's "send now"),
no internal code in the client's text, a missed day caught up before the birthday, and the month's list by date.
Local test database; messages are only queued, nothing is sent."""
from datetime import date, datetime, timedelta

import pytz
from sqlalchemy import select

from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.services import message_worker
from tests.conftest import register_and_login


def _il_today() -> date:
    return datetime.now(pytz.timezone("Asia/Jerusalem")).date()


def _born(days_ahead: int) -> date:
    return (_il_today() + timedelta(days=days_ahead)).replace(year=1992)   # 1992 is a leap year — 29/2 exists


def _jobs(db, client_id):
    db.expire_all()
    return db.scalars(select(MessageJob).where(MessageJob.client_id == client_id)).all()


def test_one_birthday_message_whoever_sends_it_and_a_missed_day_is_caught_up(client, db_session):
    h = register_and_login(client, slug="bdaymsg", email="owner@bdaymsg.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "bdaymsg"))
    db_session.add(StudioModule(studio_id=s.id, module_id="customer_club", is_enabled=True, is_locked=True))
    db_session.get(StudioSettings, s.id).birthday_send_timing = "two_days"
    member = dict(studio_id=s.id, is_club_member=True)
    by_hand = Client(**member, full_name="נועה", phone="0501230001", birth_date=_born(2))
    missed = Client(**member, full_name="דור", phone="0501230002", birth_date=_born(1))
    old_style = Client(**member, full_name="שיר", phone="0501230003", birth_date=_born(2))
    db_session.add_all([by_hand, missed, old_style])
    db_session.flush()
    bday = _il_today() + timedelta(days=2)
    key = f"birthday-{bday.year}-{bday.month:02d}"
    # sent by hand before "send now" used the shared key — must still count as sent
    db_session.add(MessageJob(studio_id=s.id, client_id=old_style.id, channel="whatsapp", to_phone=old_style.phone,
                              body=f"[{key}]\nהיי שיר, מזל טוב!", status="sent", reminder_type="birthday_manual",
                              scheduled_at=datetime.now(pytz.utc)))
    db_session.commit()

    r = client.post(f"/api/customer-club/send-birthday-coupon/{by_hand.id}?month={bday.month}&year={bday.year}", headers=h)
    assert r.status_code == 200, r.text
    (job,) = _jobs(db_session, by_hand.id)
    assert job.reminder_type == key and "[birthday-" not in job.body, job.body
    again = client.post(f"/api/customer-club/send-birthday-coupon/{by_hand.id}?month={bday.month}&year={bday.year}", headers=h)
    assert again.status_code == 400

    status = client.get(f"/api/customer-club/birthday-status?month={bday.month}&year={bday.year}", headers=h).json()
    sent = {c["full_name"]: c["message_sent"] for c in status["clients"]}
    assert sent["נועה"] is True and sent["שיר"] is True

    # the daily sweep: nothing new for the two already sent; the one whose day was missed gets it now, worded for tomorrow
    assert message_worker.sweep_birthday_messages(db_session, studio_id=s.id) == 1
    assert len(_jobs(db_session, by_hand.id)) == 1 and len(_jobs(db_session, old_style.id)) == 1
    (caught_up,) = _jobs(db_session, missed.id)
    assert "מחר יום ההולדת שלך" in caught_up.body and "[birthday-" not in caught_up.body
    assert message_worker.sweep_birthday_messages(db_session, studio_id=s.id) == 0, "one message per birthday"


def test_start_of_the_birthday_month_is_the_default(client, db_session):
    """The owner's choice (2026-10-05): the message goes out on the 1st of the birthday month; a day missed is caught
    up until the month ends — a birthday already past this month still gets its month's benefit."""
    h = register_and_login(client, slug="bdaymonth", email="owner@bdaymonth.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "bdaymonth"))
    db_session.add(StudioModule(studio_id=s.id, module_id="customer_club", is_enabled=True, is_locked=True))
    assert db_session.get(StudioSettings, s.id).birthday_send_timing == "month_start"
    born = {"early": date(1990, 10, 2), "late": date(1991, 10, 28), "next": date(1992, 11, 1), "last": date(1993, 9, 30)}
    people = {k: Client(studio_id=s.id, full_name=k, phone=f"05044400{i}", birth_date=d, is_club_member=True)
              for i, (k, d) in enumerate(born.items())}
    db_session.add_all(people.values())
    db_session.commit()

    assert message_worker.sweep_birthday_messages(db_session, studio_id=s.id, today=date(2026, 10, 5)) == 2
    for k in ("early", "late"):
        (job,) = _jobs(db_session, people[k].id)
        assert job.reminder_type == "birthday-2026-10" and "חודש יום ההולדת שלך הגיע" in job.body
    assert _jobs(db_session, people["next"].id) == [] and _jobs(db_session, people["last"].id) == []
    assert message_worker.sweep_birthday_messages(db_session, studio_id=s.id, today=date(2026, 10, 6)) == 0
    assert message_worker.sweep_birthday_messages(db_session, studio_id=s.id, today=date(2026, 10, 31)) == 0, "not before 1 Nov"
    assert message_worker.sweep_birthday_messages(db_session, studio_id=s.id, today=date(2026, 11, 1)) == 1
    (nov,) = _jobs(db_session, people["next"].id)
    assert nov.reminder_type == "birthday-2026-11"

    rows = client.get("/api/customer-club/birthday-status?month=10&year=2026", headers=h).json()
    assert rows["timing"] == "month_start"
    assert {(c["full_name"], c["send_from"], c["send_until"]) for c in rows["clients"]} == {
        ("early", "2026-10-01", "2026-10-31"), ("late", "2026-10-01", "2026-10-31")}
    assert client.patch("/api/studio/automation", json={"birthday_send_timing": "two_days"}, headers=h).json()["birthday_send_timing"] == "two_days"
    rows = client.get("/api/customer-club/birthday-status?month=10&year=2026", headers=h).json()
    assert {(c["full_name"], c["send_from"]) for c in rows["clients"]} == {("early", "2026-09-30"), ("late", "2026-10-26")}
    assert client.patch("/api/studio/automation", json={"birthday_send_timing": "weekly"}, headers=h).status_code == 422


def test_the_months_birthday_list_is_by_date(client, db_session):
    h = register_and_login(client, slug="bdaylist", email="owner@bdaylist.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "bdaylist"))
    db_session.add(StudioModule(studio_id=s.id, module_id="customer_club", is_enabled=True, is_locked=True))
    for name, day in (("אבי", 28), ("איילה", 9), ("מארק", 21), ("עדן", 19), ("שני", 29), ("שקד", 29)):
        db_session.add(Client(studio_id=s.id, full_name=name, phone=f"05000000{day}", birth_date=date(1990, 3, day), is_club_member=True))
    db_session.commit()
    rows = client.get("/api/customer-club/birthday-status?month=3&year=2026", headers=h).json()["clients"]
    assert [(c["full_name"], c["birth_day"]) for c in rows] == [
        ("איילה", 9), ("עדן", 19), ("מארק", 21), ("אבי", 28), ("שני", 29), ("שקד", 29)]
