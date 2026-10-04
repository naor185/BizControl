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
    db_session.add(StudioModule(studio_id=s.id, module_id="customer_club", is_enabled=True))
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


def test_the_months_birthday_list_is_by_date(client, db_session):
    h = register_and_login(client, slug="bdaylist", email="owner@bdaylist.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "bdaylist"))
    db_session.add(StudioModule(studio_id=s.id, module_id="customer_club", is_enabled=True))
    for name, day in (("אבי", 28), ("איילה", 9), ("מארק", 21), ("עדן", 19), ("שני", 29), ("שקד", 29)):
        db_session.add(Client(studio_id=s.id, full_name=name, phone=f"05000000{day}", birth_date=date(1990, 3, day), is_club_member=True))
    db_session.commit()
    rows = client.get("/api/customer-club/birthday-status?month=3&year=2026", headers=h).json()["clients"]
    assert [(c["full_name"], c["birth_day"]) for c in rows] == [
        ("איילה", 9), ("עדן", 19), ("מארק", 21), ("אבי", 28), ("שני", 29), ("שקד", 29)]
