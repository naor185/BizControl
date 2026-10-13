"""The invitation to the BizFind app (owner, 2026-10-13): once per client after the first visit, at the owner's time,
saying only what this business offers; by hand from the client's card; never to a client off the list or already on
BizFind. The club invitation's switch and time now save too. Local test database; nothing is sent."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text

from app.models.client import Client
from app.models.message_job import MessageJob
from tests.conftest import register_and_login


def _visit(client, h, phone):
    me = client.get("/api/auth/me", headers=h).json()
    c = client.post("/api/clients", headers=h, json={"full_name": "דנה כהן", "phone": phone}).json()
    start = datetime.now(timezone.utc) - timedelta(hours=2)
    a = client.post("/api/appointments", headers=h, json={"client_id": c["id"], "artist_id": me["id"], "title": "תור",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()})
    assert a.status_code in (200, 201), a.text
    r = client.patch(f"/api/appointments/{a.json()['id']}", headers=h, json={"status": "done"})
    assert r.status_code == 200, r.text
    return c["id"]


def _invites(db, client_id):
    return db.scalars(select(MessageJob).where(MessageJob.client_id == client_id, MessageJob.reminder_type == "app_invite")).all()


def test_once_after_the_first_visit_saying_what_the_business_offers(client, db_session):
    h = register_and_login(client, "app-inv", "owner@app-inv.com")
    assert client.patch("/api/studio/automation", headers=h, json={"self_booking_enabled": True}).status_code == 200
    cid = _visit(client, h, "0521110001")
    [job] = _invites(db_session, cid)
    assert job.channel == "whatsapp" and job.status == "pending"
    assert timedelta(hours=23) < job.scheduled_at - datetime.now(timezone.utc) <= timedelta(hours=24)   # a day after
    assert "find.biz-control.com/app?b=app-inv" in job.body
    assert "לקבוע תור בעצמך" in job.body and "התורים, הקבלות והתמונות" in job.body
    assert "נקודות" not in job.body                          # no club in this plan — no promise of points
    assert "להסרה מרשימת ההודעות" in job.body                # marketing carries the way off the list

    # a second visit — no second invitation
    me = client.get("/api/auth/me", headers=h).json()
    start = datetime.now(timezone.utc) - timedelta(hours=1)
    a = client.post("/api/appointments", headers=h, json={"client_id": cid, "artist_id": me["id"], "title": "תור",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=30)).isoformat()}).json()
    client.patch(f"/api/appointments/{a['id']}", headers=h, json={"status": "done"})
    assert len(_invites(db_session, cid)) == 1


def test_the_owner_decides_text_time_and_switch(client, db_session):
    h = register_and_login(client, "app-own", "owner@app-own.com")
    r = client.patch("/api/studio/automation", headers=h, json={
        "app_invite_delay_minutes": 0, "app_invite_wa_template": "שלום {client_name}, הורידו: {app_link}",
        "club_invite_enabled": False, "club_invite_delay_minutes": 60})
    assert r.status_code == 200, r.text
    s = client.get("/api/studio/automation", headers=h).json()
    assert s["app_invite_delay_minutes"] == 0 and s["club_invite_enabled"] is False and s["club_invite_delay_minutes"] == 60
    cid = _visit(client, h, "0521110002")
    [job] = _invites(db_session, cid)
    assert job.body.startswith("שלום דנה כהן, הורידו: https://find.biz-control.com/app?b=app-own")
    assert job.scheduled_at <= datetime.now(timezone.utc) + timedelta(minutes=1)        # at once

    client.patch("/api/studio/automation", headers=h, json={"app_invite_enabled": False})
    assert not _invites(db_session, _visit(client, h, "0521110003"))


def test_not_to_someone_off_the_list_or_already_on_bizfind(client, db_session):
    h = register_and_login(client, "app-no", "owner@app-no.com")
    c =client.post("/api/clients", headers=h, json={"full_name": "רון", "phone": "0521110004"}).json()
    db_session.execute(text("INSERT INTO marketplace_customers (id, phone) SELECT :id, phone FROM clients WHERE id = :c"),
                       {"id": str(uuid.uuid4()), "c": c["id"]})
    db_session.commit()
    me = client.get("/api/auth/me", headers=h).json()
    start = datetime.now(timezone.utc) - timedelta(hours=2)
    a = client.post("/api/appointments", headers=h, json={"client_id": c["id"], "artist_id": me["id"], "title": "תור",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()}).json()
    client.patch(f"/api/appointments/{a['id']}", headers=h, json={"status": "done"})
    assert not _invites(db_session, c["id"])                  # already on BizFind

    cid = _visit(client, h, "0521110005")
    db_session.query(MessageJob).filter(MessageJob.client_id == cid).delete()
    db_session.get(Client, uuid.UUID(cid)).whatsapp_opted_out = True
    db_session.commit()
    r = client.post(f"/api/clients/{cid}/app-invite", headers=h)
    assert r.status_code == 400 and "הסיר" in r.json()["detail"]


def test_by_hand_from_the_client_card(client, db_session):
    h = register_and_login(client, "app-hand", "owner@app-hand.com")
    c = client.post("/api/clients", headers=h, json={"full_name": "מיכל", "phone": "0521110006"}).json()
    assert client.post(f"/api/clients/{c['id']}/app-invite", headers=h).status_code == 200
    [job] = _invites(db_session, c["id"])
    assert job.scheduled_at <= datetime.now(timezone.utc) + timedelta(minutes=1)
    r = client.post(f"/api/clients/{c['id']}/app-invite", headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "ההזמנה כבר נשלחה ללקוח היום"


def test_the_app_link_without_store_links_yet(client):
    assert client.get("/api/public/bizfind-app").json() == {"ios": None, "android": None}
