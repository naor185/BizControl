"""Each message on the message templates page can be turned off (owner, 2026-10-12)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.message_job import MessageJob
from tests.conftest import register_and_login


def _appointment(client, h, phone="0521112233"):
    me = client.get("/api/auth/me", headers=h).json()
    c = client.post("/api/clients", headers=h, json={"full_name": "דנה", "phone": phone})
    assert c.status_code in (200, 201), c.text
    start = datetime.now(timezone.utc) + timedelta(days=5)
    a = client.post("/api/appointments", headers=h, json={"client_id": c.json()["id"], "artist_id": me["id"], "title": "תספורת",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()})
    assert a.status_code in (200, 201), a.text
    return a.json()["id"]


def _jobs(db, appointment_id):
    return db.scalars(select(MessageJob).where(MessageJob.appointment_id == appointment_id,
                                               MessageJob.channel == "whatsapp")).all()


def test_the_switches_are_kept_and_only_known_ones(client):
    h = register_and_login(client, "off-keep", "owner@off-keep.com")
    assert client.get("/api/studio/automation", headers=h).json()["messages_off"] == []
    r = client.patch("/api/studio/automation", headers=h, json={"messages_off": ["confirm", "nothing-like-it"]})
    assert r.status_code == 200, r.text
    assert client.get("/api/studio/automation", headers=h).json()["messages_off"] == ["confirm"]


def test_a_confirmation_turned_off_isnt_sent_and_on_it_is(client, db_session):
    h = register_and_login(client, "off-conf", "owner@off-conf.com")
    on = _appointment(client, h, "0521112233")
    assert len(_jobs(db_session, on)) == 1

    client.patch("/api/studio/automation", headers=h, json={"messages_off": ["confirm"]})
    off = _appointment(client, h, "0521112234")
    assert _jobs(db_session, off) == []


def test_a_cancellation_turned_off_isnt_sent(client, db_session):
    h = register_and_login(client, "off-cancel", "owner@off-cancel.com")
    client.patch("/api/studio/automation", headers=h, json={"messages_off": ["confirm"]})
    sent = _appointment(client, h, "0521112233")
    assert client.delete(f"/api/appointments/{sent}?reason=client_cancelled", headers=h).status_code == 204
    assert len(_jobs(db_session, sent)) == 1                                  # on: the cancellation goes out

    client.patch("/api/studio/automation", headers=h, json={"messages_off": ["confirm", "cancel"]})
    quiet = _appointment(client, h, "0521112234")
    assert client.delete(f"/api/appointments/{quiet}?reason=client_cancelled", headers=h).status_code == 204
    assert _jobs(db_session, quiet) == []
