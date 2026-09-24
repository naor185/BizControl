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


def test_start_clears_only_texts_the_old_screen_saved_by_itself(db_session):
    old_dep = LEGACY_SAVED_ONLY_IF_UNCHANGED["deposit_approved_wa_template"]
    clinic = _studio(db_session, "c3", "medical", aftercare_message=TATTOO_AFTERCARE, deposit_approved_wa_template=old_dep)
    own = _studio(db_session, "t3", "tattoo", aftercare_message="הוראות שלי", deposit_approved_wa_template="נוסח שלי {artist_name}")
    db_session.commit()
    _build_production_schema(db_session.connection().connection.dbapi_connection)
    db_session.expire_all()
    c = db_session.get(StudioSettings, clinic.id)
    assert c.aftercare_message is None
    # the same text, only the staff line now uses the business's word
    expected = "\n".join("👥 {staff_title}: {artist_name}" if "{artist_name}" in l else l for l in old_dep.split("\n"))
    assert c.deposit_approved_wa_template == expected and "אמן" not in c.deposit_approved_wa_template
    o = db_session.get(StudioSettings, own.id)
    assert o.aftercare_message == "הוראות שלי" and o.deposit_approved_wa_template == "נוסח שלי {artist_name}"


def test_aftercare_goes_out_with_the_clients_name_and_the_fields_text(db_session):
    from app.crud.automation import build_aftercare_message
    clinic = _studio(db_session, "c4", "medical")
    settings = db_session.get(StudioSettings, clinic.id)
    body = build_aftercare_message(settings, Client(full_name="רותם"), 0, 0, db=db_session)
    assert body.startswith("היי רותם!") and "{client_name}" not in body and "קעקוע" not in body


def test_the_deposit_approved_email_has_every_placeholder_filled(db_session, monkeypatch):
    import app.crud.automation as automation
    monkeypatch.setattr(automation, "_email_ok", lambda *a, **k: True)
    old_dep = LEGACY_SAVED_ONLY_IF_UNCHANGED["deposit_approved_wa_template"]
    new_dep = "\n".join("👥 {staff_title}: {artist_name}" if "{artist_name}" in l else l for l in old_dep.split("\n"))
    clinic = _studio(db_session, "c5", "medical", deposit_approved_wa_template=new_dep, studio_address="הרצל 1")
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
