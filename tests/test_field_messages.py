"""Messages fit the business's field (part C, first piece): a clinic never gets a tattoo studio's
aftercare instructions, and placeholders are always filled in. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.data.business_types import GENERIC_MESSAGES, LEGACY_SAVED_ONLY_IF_UNCHANGED, TATTOO_AFTERCARE
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services.business_types import message_default
from tests.conftest import _build_production_schema, register_and_login


def _studio(db, slug, business_type, **settings):
    s = Studio(name=slug, slug=slug, business_type=business_type)
    db.add(s)
    db.flush()
    db.add(StudioSettings(studio_id=s.id, **settings))
    db.commit()
    return s


def test_only_a_tattoo_studio_gets_tattoo_aftercare_instructions(db_session):
    tattoo, clinic = _studio(db_session, "t1", "tattoo"), _studio(db_session, "c1", "medical")
    assert message_default(db_session, tattoo.id, "aftercare") == TATTOO_AFTERCARE
    assert message_default(db_session, clinic.id, "aftercare") == GENERIC_MESSAGES["aftercare"]
    assert "קעקוע" not in GENERIC_MESSAGES["aftercare"]


def test_the_settings_screen_shows_the_fields_default_and_saving_it_does_not_make_it_the_owners(client, db_session):
    h = register_and_login(client, slug="clinic2", email="owner@clinic2.com")
    client.patch("/api/studio/upload/business-type", headers=h, json={"business_type": "dental"})
    shown = client.get("/api/studio/automation", headers=h).json()["aftercare_message"]
    assert shown == GENERIC_MESSAGES["aftercare"] and "קעקוע" not in shown
    client.patch("/api/studio/automation", headers=h, json={"aftercare_message": shown})   # saved back unchanged
    studio = db_session.scalar(select(Studio).where(Studio.slug == "clinic2"))
    db_session.expire_all()
    assert db_session.get(StudioSettings, studio.id).aftercare_message is None
    client.patch("/api/studio/automation", headers=h, json={"aftercare_message": "לא לצחצח שעתיים"})
    db_session.expire_all()
    assert db_session.get(StudioSettings, studio.id).aftercare_message == "לא לצחצח שעתיים"


# The screen's latest version of every text it filled in by itself.
SCREEN_TEXTS = {k: v[-1] for k, v in LEGACY_SAVED_ONLY_IF_UNCHANGED.items()}


def test_start_clears_only_texts_the_old_screen_saved_by_itself(db_session):
    clinic = _studio(db_session, "c3", "medical", **SCREEN_TEXTS)
    older = _studio(db_session, "c3b", "medical",
                    deposit_approved_wa_template=LEGACY_SAVED_ONLY_IF_UNCHANGED["deposit_approved_wa_template"][0])
    own = _studio(db_session, "t3", "tattoo", aftercare_message="הוראות שלי", deposit_approved_wa_template="נוסח שלי {artist_name}",
                  confirm_wa_template="נתראה, {client_name}!")
    db_session.commit()
    _build_production_schema(db_session.connection().connection.dbapi_connection)
    db_session.expire_all()
    c = db_session.get(StudioSettings, clinic.id)
    assert {k: getattr(c, k) for k in SCREEN_TEXTS} == {k: None for k in SCREEN_TEXTS}
    assert db_session.get(StudioSettings, older.id).deposit_approved_wa_template is None
    o = db_session.get(StudioSettings, own.id)
    assert o.aftercare_message == "הוראות שלי" and o.deposit_approved_wa_template == "נוסח שלי {artist_name}"
    assert o.confirm_wa_template == "נתראה, {client_name}!"


def test_saving_the_settings_screen_does_not_make_the_message_texts_the_owners(client, db_session):
    h = register_and_login(client, slug="clinic6", email="owner@clinic6.com")
    shown = client.get("/api/studio/automation", headers=h).json()
    assert shown["confirm_wa_template"] is None and shown["reminder_wa_template"] is None
    # an old screen still open in a browser sends the texts it filled in by itself, with an unrelated change
    texts = {k: v for k, v in SCREEN_TEXTS.items() if k != "aftercare_message"}
    assert client.patch("/api/studio/automation", headers=h, json={**texts, "studio_address": "הרצל 1"}).status_code == 200
    studio = db_session.scalar(select(Studio).where(Studio.slug == "clinic6"))
    db_session.expire_all()
    s = db_session.get(StudioSettings, studio.id)
    assert {k: getattr(s, k) for k in texts} == {k: None for k in texts} and s.studio_address == "הרצל 1"
    # the owner's own text is kept
    client.patch("/api/studio/automation", headers=h, json={"confirm_wa_template": "נתראה, {client_name}!"})
    db_session.expire_all()
    assert db_session.get(StudioSettings, studio.id).confirm_wa_template == "נתראה, {client_name}!"


def _appointment(db, studio):
    artist = User(studio_id=studio.id, email=f"dana@{studio.slug}.com", password_hash="x", role="artist", display_name="דנה")
    cl = Client(studio_id=studio.id, full_name="רותם", phone="0501234567", email=f"rotem@{studio.slug}.com")
    db.add_all([artist, cl])
    db.flush()
    start = datetime.now(timezone.utc) + timedelta(days=3)
    appt = Appointment(studio_id=studio.id, client_id=cl.id, artist_id=artist.id, title="בדיקה",
                       starts_at=start, ends_at=start + timedelta(hours=1), status="scheduled")
    db.add(appt)
    db.commit()
    return appt


def test_with_no_text_of_its_own_the_confirmation_names_the_staff_and_the_cancellation_policy(db_session):
    from app.crud.automation import enqueue_confirmation_message
    clinic = _studio(db_session, "c7", "medical", studio_address="הרצל 1", cancellation_free_days=3)
    appt = _appointment(db_session, clinic)
    enqueue_confirmation_message(db_session, appt, artist_name="דנה")
    body = db_session.scalar(select(MessageJob.body).where(MessageJob.appointment_id == appt.id, MessageJob.channel == "whatsapp"))
    assert "רותם" in body and "דנה" in body and "הרצל 1" in body and "ביטול ללא עלות עד 3 ימים" in body


def test_aftercare_goes_out_with_the_clients_name_and_the_fields_text(db_session):
    from app.crud.automation import build_aftercare_message
    clinic = _studio(db_session, "c4", "medical")
    settings = db_session.get(StudioSettings, clinic.id)
    body = build_aftercare_message(settings, Client(full_name="רותם"), 0, 0, db=db_session)
    assert body.startswith("היי רותם!") and "{client_name}" not in body and "קעקוע" not in body


def test_the_deposit_approved_email_has_every_placeholder_filled(db_session, monkeypatch):
    import app.crud.automation as automation
    monkeypatch.setattr(automation, "_email_ok", lambda *a, **k: True)
    own = "✅ {client_name}, המקדמה אושרה!\n📅 {appointment_date} {appointment_time}\n👥 {staff_title}: {artist_name}"
    clinic = _studio(db_session, "c5", "medical", deposit_approved_wa_template=own, studio_address="הרצל 1")
    artist = User(studio_id=clinic.id, email="dana@c5.com", password_hash="x", role="artist", display_name="דנה")
    cl = Client(studio_id=clinic.id, full_name="רותם", phone="0501234567", email="rotem@c5.com")
    db_session.add_all([artist, cl])
    db_session.flush()
    start = datetime.now(timezone.utc) + timedelta(days=3)
    appt = Appointment(studio_id=clinic.id, client_id=cl.id, artist_id=artist.id, title="בדיקה",
                       starts_at=start, ends_at=start + timedelta(hours=1), status="scheduled")
    db_session.add(appt)
    db_session.commit()
    automation.enqueue_deposit_approved_message(db_session, appt, artist_name="דנה")
    jobs = {j.channel: j for j in db_session.scalars(select(MessageJob).where(MessageJob.appointment_id == appt.id)).all()}
    for ch in ("whatsapp", "email"):
        body = jobs[ch].body
        assert "{client_name}" not in body and "{appointment_date}" not in body and "{staff_title}" not in body, ch
        assert "רותם" in body and "מטפל/ת: דנה" in body and "אמן" not in body, ch
