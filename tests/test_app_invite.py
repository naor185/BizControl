"""The invitation to the BizFind app (owner, 2026-10-13): once per client after the first visit, at the owner's time,
saying only what this business offers; by hand from the client's card; never to a client off the list or already on
BizFind. Only once the app is in the App Store, and very short (owner, 2026-10-15). The club invitation's switch and
time save too. Local test database; nothing is sent."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text

from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.services import message_worker
from tests.conftest import register_and_login


def _in_app_store(client, db, link="https://apps.apple.com/app/bizfind/id1"):
    """The platform, with BizFind's App Store link set by the superadmin (empty: not in the store yet)."""
    register_and_login(client, "platform-sa", "sa@platform.com")
    platform = db.scalar(select(Studio).where(Studio.slug == "platform-sa"))
    platform.is_platform = True
    db.get(StudioSettings, platform.id).bizfind_ios_url = link
    db.commit()


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
    _in_app_store(client, db_session)
    h = register_and_login(client, "app-inv", "owner@app-inv.com")
    assert client.patch("/api/studio/automation", headers=h, json={"self_booking_enabled": True}).status_code == 200
    cid = _visit(client, h, "0521110001")
    [job] = _invites(db_session, cid)
    assert job.channel == "whatsapp" and job.status == "pending"
    assert timedelta(hours=23) < job.scheduled_at - datetime.now(timezone.utc) <= timedelta(hours=24)   # a day after
    assert "find.biz-control.com/app?b=app-inv" in job.body
    assert "בפעם הבאה אפשר לקבוע תור בעצמך ולראות מתי יש תור פנוי" in job.body
    assert "נקודות" not in job.body                          # no club in this plan — no promise of points
    assert "להסרה מרשימת ההודעות" in job.body                # marketing carries the way off the list
    assert len(job.body.split("להסרה")[0].strip().splitlines()) == 3   # very short: hello, what, the link

    # a second visit — no second invitation
    me = client.get("/api/auth/me", headers=h).json()
    start = datetime.now(timezone.utc) - timedelta(hours=1)
    a = client.post("/api/appointments", headers=h, json={"client_id": cid, "artist_id": me["id"], "title": "תור",
                                                          "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=30)).isoformat()}).json()
    client.patch(f"/api/appointments/{a['id']}", headers=h, json={"status": "done"})
    assert len(_invites(db_session, cid)) == 1


def test_a_club_member_hears_of_the_points_only_where_the_club_is_on(client, db_session):
    _in_app_store(client, db_session)
    h = register_and_login(client, "app-club", "owner@app-club.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "app-club"))
    db_session.add(StudioModule(studio_id=s.id, module_id="customer_club", is_enabled=True, is_locked=True))
    db_session.commit()
    member = client.post("/api/clients", headers=h, json={"full_name": "מיכל", "phone": "0521110011"}).json()
    other = client.post("/api/clients", headers=h, json={"full_name": "רון", "phone": "0521110012"}).json()
    db_session.get(Client, uuid.UUID(member["id"])).is_club_member = True
    db_session.commit()
    for c in (member, other):
        assert client.post(f"/api/clients/{c['id']}/app-invite", headers=h).status_code == 200
    [to_member] = _invites(db_session, member["id"])
    [to_other] = _invites(db_session, other["id"])
    assert "כמה נקודות יש לך במועדון, את התורים והקבלות" in to_member.body
    assert "נקודות" not in to_other.body and "התורים והקבלות שלך" in to_other.body


def test_nothing_goes_out_before_the_app_is_in_the_app_store(client, db_session):
    _in_app_store(client, db_session, link=None)
    h = register_and_login(client, "app-wait", "owner@app-wait.com")
    assert not _invites(db_session, _visit(client, h, "0521110021"))           # automatically — not queued
    c = client.post("/api/clients", headers=h, json={"full_name": "שי", "phone": "0521110022"}).json()
    r = client.post(f"/api/clients/{c['id']}/app-invite", headers=h)           # by hand — the owner hears why
    assert r.status_code == 400 and "עוד לא ב-App Store" in r.json()["detail"]

    # one queued while the app was there, whose time comes after the link was taken away — dropped, not sent
    s = db_session.scalar(select(Studio).where(Studio.slug == "app-wait"))
    db_session.query(MessageJob).delete()                     # only that one is due (the visit queued the others)
    db_session.add(MessageJob(studio_id=s.id, client_id=uuid.UUID(c["id"]), channel="whatsapp", to_phone="0521110022",
                              body="הזמנה", scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=1),
                              status="pending", reminder_type="app_invite"))
    db_session.commit()
    message_worker.process_due_jobs(db_session)
    [job] = _invites(db_session, c["id"])
    assert job.status == "canceled" and "App Store" in job.last_error


def test_the_owner_decides_text_time_and_switch(client, db_session):
    _in_app_store(client, db_session)
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
    _in_app_store(client, db_session)
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
    _in_app_store(client, db_session)
    h = register_and_login(client, "app-hand", "owner@app-hand.com")
    c = client.post("/api/clients", headers=h, json={"full_name": "מיכל", "phone": "0521110006"}).json()
    assert client.post(f"/api/clients/{c['id']}/app-invite", headers=h).status_code == 200
    [job] = _invites(db_session, c["id"])
    assert job.scheduled_at <= datetime.now(timezone.utc) + timedelta(minutes=1)
    r = client.post(f"/api/clients/{c['id']}/app-invite", headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "ההזמנה כבר נשלחה ללקוח היום"


def test_the_app_link_without_store_links_yet(client):
    assert client.get("/api/public/bizfind-app").json() == {"ios": None, "android": None}
