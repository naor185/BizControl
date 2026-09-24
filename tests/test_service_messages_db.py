"""Service messages reach a client whatever their marketing flags (owner's decision, 2026-09-24).
Runs on the local test database; nothing is sent — messages are only queued."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login


def test_cancellation_and_aftercare_reach_a_client_who_refused_marketing(client, db_session):
    h = register_and_login(client, slug="svc", email="owner@svc.com")
    studio = db_session.scalar(select(Studio).where(Studio.slug == "svc"))
    owner = db_session.scalar(select(User).where(User.studio_id == studio.id, User.role == "owner"))

    r = client.post("/api/clients", headers=h, json={"full_name": "לקוחה בלי דיוור", "phone": "0502223333", "email": "nomkt@svc.com"})
    assert r.status_code == 201, r.text
    client_id = r.json()["id"]
    c = db_session.get(Client, client_id)
    c.marketing_consent, c.whatsapp_opted_out = False, True   # never agreed AND unsubscribed
    db_session.commit()

    def book(hours):
        starts = datetime.now(timezone.utc) + timedelta(hours=hours)
        r = client.post("/api/appointments", headers=h, json={
            "client_id": client_id, "artist_id": str(owner.id), "title": "קעקוע",
            "starts_at": starts.isoformat(), "ends_at": (starts + timedelta(hours=2)).isoformat(), "notes": None})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def jobs_for(appt_id):
        db_session.expire_all()
        return db_session.scalars(select(MessageJob).where(MessageJob.appointment_id == appt_id)).all()

    canceled = book(24)
    before = {j.id for j in jobs_for(canceled)}
    assert client.delete(f"/api/appointments/{canceled}?reason=client_cancelled", headers=h).status_code == 204
    notices = [j for j in jobs_for(canceled) if j.id not in before]
    assert {j.channel for j in notices} >= {"whatsapp"}, "the cancellation notice must be queued"

    done = book(48)
    before = {j.id for j in jobs_for(done)}
    assert client.patch(f"/api/appointments/{done}", headers=h, json={"status": "done"}).status_code == 200
    assert [j for j in jobs_for(done) if j.id not in before], "the message after treatment must be queued"
