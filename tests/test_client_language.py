"""A business that works in English talks to its clients in English (the owner, 2026-10-20): the system's own
messages — built in Hebrew — go out in the business's language (services/client_language, applied by
message_worker.process_due_jobs). What the owner wrote stays as written. Local test database; nothing is sent."""
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.crud import automation
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services.client_language import speak
from tests.conftest import register_and_login

HEB = re.compile(r"[֐-׿]")


def _shop(client, db, slug, lang):
    owner = register_and_login(client, slug, f"owner@{slug}.com")
    client.put("/api/auth/me/locale", headers=owner, json={"locale": lang})
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    st = db.get(StudioSettings, s.id)
    st.studio_address, st.studio_map_link, st.cancellation_free_days = "1 Main St", "https://maps.example/x", 3
    c = Client(studio_id=s.id, full_name="Dana", phone="0501234567", email="dana@example.com")
    db.add(c)
    db.flush()
    owner_user = db.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
    starts = datetime.now(timezone.utc) + timedelta(days=5)
    a = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner_user.id, title="Tattoo", starts_at=starts,
                    ends_at=starts + timedelta(hours=1))
    db.add(a)
    db.commit()
    return s, c, a


def _bodies(db, studio_id):
    jobs = db.scalars(select(MessageJob).where(MessageJob.studio_id == studio_id,
                                               MessageJob.channel.in_(("whatsapp", "email")))).all()
    return [(j.subject or "", j.body or "") for j in jobs]


def test_an_english_business_sends_its_clients_english(client, db_session):
    s, c, a = _shop(client, db_session, "en-shop", "en")
    automation.enqueue_confirmation_message(db_session, a, "Noa")
    a.deposit_amount_cents = 10000
    db_session.commit()
    automation.enqueue_confirmation_message(db_session, a, "Noa")
    automation.enqueue_deposit_approved_message(db_session, a, "Noa")
    automation.enqueue_reschedule_message(db_session, a)
    automation.enqueue_cancel_message(db_session, a)
    left = []
    for subject, body in _bodies(db_session, s.id):
        for text in (subject, body):
            said = speak(text, "en")
            left += [line for line in re.split(r"<[^>]+>|\n", said) if HEB.search(line)]
    assert left == [], left                                           # every line of every message in English
    said = speak(_bodies(db_session, s.id)[0][1], "en")
    assert "Hi Dana" in said and "Tattoo" in said and "See you soon" in said
    assert 'dir="ltr"' in speak('<div dir="rtl"><p>שלום Dana,</p></div>', "en")


def test_a_hebrew_business_and_the_owners_own_text_stay_as_written(client, db_session):
    s, c, a = _shop(client, db_session, "he-shop", "he")
    automation.enqueue_confirmation_message(db_session, a, "נועה")
    body = _bodies(db_session, s.id)[0][1]
    assert speak(body, "he") == body and HEB.search(body)
    own = "היי {client_name}, טקסט שכתבתי בעצמי"                      # an owner's own words aren't the system's
    assert speak(own, "en") == own


def test_reminders_payment_thanks_and_the_club_in_english(client, db_session):
    from app.crud.client import _handle_new_club_member
    from app.services import message_worker as mw
    s, c, a = _shop(client, db_session, "en-more", "en")
    owner = db_session.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
    now = datetime.now(timezone.utc)
    st = db_session.get(StudioSettings, s.id)
    for attr in ("reminder_1_day_enabled", "reminder_7_days_enabled", "reminder_3_days_enabled", "reminder_2_hours_enabled"):
        if hasattr(st, attr):
            setattr(st, attr, True)
    for hours in (24, 24 * 7, 24 * 3, 2):                                 # one appointment for each reminder
        db_session.add(Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="Tattoo",
                                   starts_at=now + timedelta(hours=hours), ends_at=now + timedelta(hours=hours + 1),
                                   deposit_amount_cents=5000 if hours == 24 else 0))
    db_session.commit()
    mw.sweep_upcoming_reminders(db_session)
    mw.sweep_7day_reminders(db_session)
    mw.sweep_3day_reminders(db_session)
    mw.sweep_2hour_reminders(db_session)
    automation.enqueue_post_payment_message(db_session, a, 10000, 10)
    c.is_club_member, c.loyalty_points = True, 30
    db_session.commit()
    _handle_new_club_member(db_session, s.id, c)
    left, kinds = [], set()
    for j in db_session.scalars(select(MessageJob).where(MessageJob.studio_id == s.id,
                                                         MessageJob.channel.in_(("whatsapp", "email")))).all():
        kinds.add(j.reminder_type)
        for text in (j.subject or "", j.body or ""):
            left += [(j.reminder_type, line) for line in re.split(r"<[^>]+>|\n", speak(text, "en")) if HEB.search(line)]
    assert {"1day", "7day", "3day"} <= kinds, kinds
    assert left == [], left


def test_the_queue_says_it_in_english_before_sending(client, db_session, monkeypatch):
    from app.services import message_worker as mw
    s, c, a = _shop(client, db_session, "en-queue", "en")
    c.email = None                                                    # WhatsApp only — the e-mail sender is real
    db_session.commit()
    automation.enqueue_cancel_message(db_session, a)
    sent = []
    monkeypatch.setattr(mw, "send_whatsapp_message", lambda to, body, *x, **k: sent.append(body))
    mw.process_due_jobs(db_session)
    assert sent and not any(HEB.search(b) for b in sent), sent
    assert "Sorry, your appointment was canceled." in sent[0]
