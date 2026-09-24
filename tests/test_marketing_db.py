"""Marketing end to end on the local test database, through the real code: the daily birthday run
queues the benefit, the dispatcher sends it with a working unsubscribe link. Nothing leaves the
machine — conftest replaces the senders and records what would have been sent."""
from datetime import date, datetime, timedelta

import pytz
from sqlalchemy import select, text

from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.services import message_worker
from tests.conftest import SENT


def test_birthday_benefit_goes_out_once_with_a_working_unsubscribe_link(db_session):
    studio = Studio(name="בדיקה", slug="bday")
    db_session.add(studio)
    db_session.flush()
    db_session.add(StudioSettings(studio_id=studio.id))
    in_two_days = datetime.now(pytz.timezone("Asia/Jerusalem")).date() + timedelta(days=2)
    birthday = date(1992, in_two_days.month, in_two_days.day)   # 1992 is a leap year, so 29/2 works too
    ok = Client(studio_id=studio.id, full_name="טל", phone="0501110001", birth_date=birthday, is_club_member=True)
    refused = Client(studio_id=studio.id, full_name="גיל", phone="0501110002", birth_date=birthday,
                     is_club_member=True, marketing_consent=False)
    db_session.add_all([ok, refused])
    db_session.commit()

    assert message_worker.sweep_birthday_messages(db_session, studio_id=studio.id) == 1
    message_worker.process_due_jobs(db_session, limit=50)
    db_session.expire_all()

    (job,) = db_session.scalars(select(MessageJob).where(MessageJob.studio_id == studio.id)).all()
    assert job.client_id == ok.id and job.status == "sent", (job.status, job.last_error)
    assert ("whatsapp", "0501110001") in SENT and ("whatsapp", "0501110002") not in SENT
    code = job.body.rsplit("/optout/", 1)[1].split()[0]
    row = db_session.execute(text("SELECT client_id FROM client_optout_links WHERE code = :c"), {"c": code}).fetchone()
    assert row and str(row[0]) == str(ok.id), "the unsubscribe link in the message must lead to this client"

    assert message_worker.sweep_birthday_messages(db_session, studio_id=studio.id) == 0, "one benefit per birthday"
