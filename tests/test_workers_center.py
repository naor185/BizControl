"""The workers center, stage 1 (the owner, 2026-10-19): today's view, and the month's hours and pay to the accountant —
by hand or by itself on the 1st, once a month."""
import base64
import uuid
from datetime import datetime, timedelta, timezone

import pytz
from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.audit_log import AuditLog
from app.models.client import Client
from app.models.studio import Studio
from app.models.user import User
from app.models.work_session import WorkSession
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _business(client, db, slug):
    owner = register_and_login(client, slug, f"owner@{slug}.com")
    db.scalar(select(Studio).where(Studio.slug == slug)).subscription_plan = "pro"
    db.commit()
    return owner


def _member(client, owner, email, pay_type="hourly"):
    r = client.post("/api/users/artists", headers=owner, json={"email": email, "password": "secret123", "role": "artist",
                                                               "display_name": email.split("@")[0], "pay_type": pay_type,
                                                               "hourly_rate": 50})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
    return {"Authorization": f"Bearer {t}"}, uuid.UUID(r.json()["id"])


def test_the_month_goes_to_the_accountant(client, db_session, monkeypatch):
    owner = _business(client, db_session, "wc-pay")
    worker, wid = _member(client, owner, "dana@wc-pay.com")
    studio_id = db_session.get(User, wid).studio_id
    now = datetime.now(IL)
    last = (now.replace(day=1) - timedelta(days=1))                       # last month — its shifts are over
    at = lambda h: IL.localize(datetime(last.year, last.month, 10, h, 0))
    db_session.add(WorkSession(studio_id=studio_id, user_id=wid, start_time=at(9), end_time=at(13), session_pay=200))
    db_session.commit()
    body = {"year": last.year, "month": last.month}

    r = client.post("/api/staff/payroll/send-to-accountant", headers=owner, json=body)
    assert r.status_code == 400 and "רואה החשבון" in r.json()["detail"]       # no address yet
    assert client.post("/api/staff/payroll/send-to-accountant", headers=worker, json=body).status_code == 403

    client.patch("/api/invoices/settings/accountant-email", headers=owner, json={"accountant_email": "cpa@wc-pay.com"})
    assert client.get("/api/staff/payroll/accountant", headers=owner).json()["email"] == "cpa@wc-pay.com"
    sent = []
    monkeypatch.setattr("app.services.email_center.send_email", lambda db, **kw: sent.append(kw) or True)
    r = client.post("/api/staff/payroll/send-to-accountant", headers=owner, json=body)
    assert r.status_code == 200 and r.json()["shifts"] == 1
    assert sent[0]["to_email"] == "cpa@wc-pay.com"
    files = {a["filename"]: base64.b64decode(a["content_base64"]) for a in sent[0]["attachments"]}
    csv_file = next(v for k, v in files.items() if k.endswith(".csv")).decode("utf-8-sig")
    assert "dana" in csv_file and "09:00" in csv_file and "13:00" in csv_file and "4.00" in csv_file and "200.00" in csv_file
    assert any(k.endswith(".pdf") for k in files)
    assert db_session.scalars(select(AuditLog).where(AuditLog.studio_id == str(studio_id), AuditLog.action == "money")).all()

    # by itself on the 1st — once
    from app.services.payroll_report import sweep_monthly
    first = IL.localize(datetime(now.year, now.month, 1, 9, 0)).astimezone(timezone.utc)
    assert client.post("/api/staff/payroll/accountant/auto", headers=owner, json={"on": True}).json()["auto"] is True
    sent.clear()
    assert sweep_monthly(db_session, first) == 1 and len(sent) == 1
    assert sweep_monthly(db_session, first + timedelta(days=1)) == 0 and len(sent) == 1


def test_today_on_the_workers_center(client, db_session):
    owner = _business(client, db_session, "wc-today")
    worker, wid = _member(client, owner, "dana@wc-today.com")
    _, rid = _member(client, owner, "ron@wc-today.com")
    _, nid = _member(client, owner, "noa@wc-today.com")
    w = db_session.get(User, wid)
    now = datetime.now(timezone.utc)
    day = datetime.now(IL)
    midnight = IL.localize(datetime(day.year, day.month, day.day)).astimezone(timezone.utc)
    db_session.add(WorkSession(studio_id=w.studio_id, user_id=wid, start_time=now - timedelta(minutes=30)))     # on shift
    db_session.add(WorkSession(studio_id=w.studio_id, user_id=nid, start_time=midnight + timedelta(minutes=5),
                               end_time=midnight + timedelta(minutes=65)))                                       # done today
    c = Client(studio_id=w.studio_id, full_name="לקוחה", phone="0521234567")
    db_session.add(c)
    db_session.flush()
    later = max(now + timedelta(minutes=5), midnight + timedelta(minutes=70))
    if later < midnight + timedelta(days=1):                                     # an appointment later today, for Ron
        db_session.add(Appointment(studio_id=w.studio_id, client_id=c.id, artist_id=rid, title="טיפול",
                                   starts_at=later, ends_at=later + timedelta(minutes=30), status="scheduled"))
    db_session.commit()

    assert client.get("/api/staff/today", headers=worker).status_code == 403
    t = client.get("/api/staff/today", headers=owner).json()
    assert [x["name"] for x in t["working"]] == ["dana"]
    assert [x["name"] for x in t["done"]] == ["noa"] and t["done"][0]["hours"] == 1.0
    if later < midnight + timedelta(days=1):
        assert [x["name"] for x in t["missing"]] == ["ron"]
