"""A service's own care instructions (the owner, 2026-10-27 — a piercing service in a tattoo studio): its clients get
the piercing text, the tattoo clients keep the studio's. Ready templates on the services screen, in the business's
language. Local test database; nothing is sent."""
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.crud import automation
from app.data.business_types import PIERCING_AFTERCARE, TATTOO_AFTERCARE
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.service import Service
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from tests.conftest import register_and_login

HEB = re.compile(r"[֐-׿]")


def _done_appointment(db, studio, service, phone):
    artist = User(studio_id=studio.id, email=f"a{phone[-2:]}@{studio.slug}.com", password_hash="x", role="artist",
                  display_name="דנה")
    cl = Client(studio_id=studio.id, full_name="רותם", phone=phone, email=f"r{phone[-2:]}@{studio.slug}.com")
    db.add_all([artist, cl])
    db.flush()
    start = datetime.now(timezone.utc) - timedelta(hours=2)
    appt = Appointment(studio_id=studio.id, client_id=cl.id, artist_id=artist.id, title=service.name,
                       service_id=service.id, starts_at=start, ends_at=start + timedelta(hours=1), status="done")
    db.add(appt)
    db.commit()
    return appt


def _studio_with_services(db, slug):
    s = Studio(name=slug, slug=slug, business_type="tattoo")
    db.add(s)
    db.flush()
    db.add(StudioSettings(studio_id=s.id))
    piercing = Service(studio_id=s.id, name="פירסינג", send_aftercare=True, aftercare_message=PIERCING_AFTERCARE)
    tattoo = Service(studio_id=s.id, name="קעקוע", send_aftercare=True)
    db.add_all([piercing, tattoo])
    db.commit()
    return s, piercing, tattoo


def test_a_piercing_gets_its_own_instructions_and_a_tattoo_keeps_the_studios(db_session):
    s, piercing, tattoo = _studio_with_services(db_session, "pierce1")
    for svc, phone in ((piercing, "0501111101"), (tattoo, "0501111102")):
        automation.enqueue_aftercare_if_needed(db_session, _done_appointment(db_session, s, svc, phone))
    db_session.commit()
    bodies = {j.to_phone: j.body for j in db_session.scalars(select(MessageJob).where(MessageJob.studio_id == s.id))}
    assert bodies["0501111101"].startswith("היי רותם!") and "סליין" in bodies["0501111101"]
    assert "קעקוע" not in bodies["0501111101"] and "{client_name}" not in bodies["0501111101"]
    assert "הקעקוע" in bodies["0501111102"] and "סליין" not in bodies["0501111102"]


def test_the_payment_thanks_carries_the_services_own_instructions(db_session, monkeypatch):
    monkeypatch.setattr(automation, "_email_ok", lambda *a, **k: True)
    s, piercing, _ = _studio_with_services(db_session, "pierce2")
    db_session.get(StudioSettings, s.id).aftercare_message = "הוראות הקעקוע שלי"
    db_session.commit()
    appt = _done_appointment(db_session, s, piercing, "0501111103")
    automation.enqueue_post_payment_message(db_session, appt, 20000)
    jobs = {j.channel: j.body for j in db_session.scalars(select(MessageJob).where(MessageJob.appointment_id == appt.id))}
    assert "סליין" in jobs["whatsapp"] and "הוראות הקעקוע שלי" not in jobs["whatsapp"]
    assert "סליין" in jobs["email"] and "<br>" in jobs["email"] and "הוראות הקעקוע שלי" not in jobs["email"]


def test_the_services_screen_saves_the_text_and_offers_the_templates(client, db_session):
    h = register_and_login(client, slug="pierce3", email="owner@pierce3.com")
    made = client.post("/api/services", headers=h, json={"name": "פירסינג", "send_aftercare": True,
                                                          "aftercare_message": "   "}).json()
    assert made["aftercare_message"] is None                               # blank = the business's text
    put = client.put(f"/api/services/{made['id']}", headers=h, json={"aftercare_message": PIERCING_AFTERCARE})
    assert put.json()["aftercare_message"] == PIERCING_AFTERCARE
    db_session.expire_all()
    assert db_session.get(Service, made["id"]).aftercare_message == PIERCING_AFTERCARE

    templates = client.get("/api/services/aftercare-templates", headers=h).json()
    assert [t["key"] for t in templates] == ["piercing", "tattoo"]
    assert templates[0]["text"] == PIERCING_AFTERCARE and templates[1]["text"] == TATTOO_AFTERCARE


def test_an_english_business_gets_the_templates_in_english(client, db_session):
    h = register_and_login(client, slug="pierce4", email="owner@pierce4.com")
    client.put("/api/auth/me/locale", headers=h, json={"locale": "en"})
    piercing = client.get("/api/services/aftercare-templates", headers=h).json()[0]["text"]
    assert [line for line in piercing.split("\n") if HEB.search(line)] == []
    assert piercing.startswith("Hi {client_name}!") and "saline" in piercing
