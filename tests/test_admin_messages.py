"""The message queue is the superadmin's, and a business's failing messages e-mail the superadmin (owner,
2026-10-11). Local test database; the senders are fakes — nothing is sent."""
from datetime import datetime, timezone

from sqlalchemy import select

import app.services.message_worker as mw
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.notification import Notification
from app.models.studio import Studio
from app.models.user import User
from app.services.integration_alerts import PLATFORM_ADMIN_EMAIL, mask_secrets
from tests.conftest import SENT, register_and_login


def _superadmin(client, db):
    h = register_and_login(client, slug="platform-sa", email="sa@platform.com")
    db.scalar(select(User).where(User.email == "sa@platform.com")).role = "superadmin"
    db.commit()
    return h


def _job(db, studio, client_, status="pending", body="שלום"):
    j = MessageJob(studio_id=studio.id, client_id=client_.id, channel="whatsapp", to_phone=client_.phone, body=body,
                   reminder_type="1day", scheduled_at=datetime.now(timezone.utc), status=status)
    db.add(j)
    db.commit()
    return j


def test_the_queue_is_the_superadmins(client, db_session):
    owner = register_and_login(client, slug="q-shop", email="owner@q-shop.com")
    register_and_login(client, slug="q-other", email="owner@q-other.com")
    a = db_session.scalar(select(Studio).where(Studio.slug == "q-shop"))
    b = db_session.scalar(select(Studio).where(Studio.slug == "q-other"))
    ca, cb = Client(studio_id=a.id, full_name="דנה", phone="0501111111"), Client(studio_id=b.id, full_name="רון", phone="0502222222")
    db_session.add_all([ca, cb])
    db_session.commit()
    failed, waiting, other = _job(db_session, a, ca, "failed"), _job(db_session, a, ca), _job(db_session, b, cb, "failed")

    assert client.get("/api/admin/messages", headers=owner).status_code == 403          # not the owner's
    assert client.get("/api/messages", headers=owner).status_code in (404, 405)          # the old queue is gone
    sa = _superadmin(client, db_session)
    rows = client.get("/api/admin/messages", headers=sa).json()
    assert {(r["studio_name"], r["status"]) for r in rows} >= {("Studio q-shop", "failed"), ("Studio q-other", "failed")}
    only_a = client.get(f"/api/admin/messages?studio_id={a.id}", headers=sa).json()
    assert {r["id"] for r in only_a} == {str(failed.id), str(waiting.id)}

    assert client.post(f"/api/admin/messages/{waiting.id}/cancel", headers=sa).status_code == 200
    assert client.post(f"/api/admin/messages/retry-all-failed?studio_id={a.id}", headers=sa).json() == {"reset": 1}
    db_session.expire_all()
    assert (db_session.get(MessageJob, failed.id).status, db_session.get(MessageJob, waiting.id).status,
            db_session.get(MessageJob, other.id).status) == ("pending", "canceled", "failed")


def test_a_business_failing_messages_alerts_the_superadmin_once_without_the_key(client, db_session, monkeypatch):
    register_and_login(client, slug="down-shop", email="owner@down-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "down-shop"))
    c = Client(studio_id=s.id, full_name="דנה", phone="0503333333")
    db_session.add(c)
    db_session.commit()
    first, second = _job(db_session, s, c), _job(db_session, s, c)
    first.attempts = len(mw.RETRY_AFTER_MINUTES)                                         # its last try
    db_session.commit()

    def down(to, body, *a, **k):
        raise RuntimeError("timeout calling https://7105.api.greenapi.com/waInstance7105123456/sendMessage/abcdef123456SECRET")
    monkeypatch.setattr(mw, "send_whatsapp_message", down)
    mw.process_due_jobs(db_session)

    db_session.expire_all()
    errors = {db_session.get(MessageJob, j.id).last_error for j in (first, second)}
    assert all("SECRET" not in e and "sendMessage/***" in e for e in errors)              # the key isn't kept
    alerts = [x for x in SENT if x == ("email", PLATFORM_ADMIN_EMAIL)]
    assert len(alerts) == 1                                                             # once, for both failures
    SENT.clear()
    note = db_session.scalar(select(Notification).where(Notification.studio_id == s.id, Notification.type == "message_failed"))
    assert note.body == "ההודעה לדנה לא נשלחה. צוות BizControl קיבל התראה ומטפל." and note.action_url == f"/clients/{c.id}"
    assert mask_secrets("waInstance1/getStateInstance/tok123") == "waInstance1/getStateInstance/***"


def test_a_reminder_is_never_sent_after_the_appointment_began_and_retry_all_is_recent_only(client, db_session):
    from datetime import timedelta
    from app.models.appointment import Appointment
    sa = _superadmin(client, db_session)
    register_and_login(client, slug="late-shop", email="owner@late-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "late-shop"))
    owner = db_session.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
    c = Client(studio_id=s.id, full_name="דנה", phone="0504444444")
    db_session.add(c)
    db_session.flush()
    now = datetime.now(timezone.utc)
    passed = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="קעקוע",
                         starts_at=now - timedelta(days=100), ends_at=now - timedelta(days=100) + timedelta(hours=1))
    db_session.add(passed)
    db_session.flush()
    reminder = MessageJob(studio_id=s.id, client_id=c.id, appointment_id=passed.id, channel="whatsapp", to_phone=c.phone,
                          body="מחר יש לך תור", reminder_type="1day", scheduled_at=now, status="pending")
    old_failed = MessageJob(studio_id=s.id, client_id=c.id, channel="whatsapp", to_phone=c.phone, body="ישן",
                            reminder_type="club_invite", scheduled_at=now, status="failed", created_at=now - timedelta(days=90))
    db_session.add_all([reminder, old_failed])
    db_session.commit()

    mw.process_due_jobs(db_session)                         # the worker itself refuses a reminder for a past appointment
    db_session.expire_all()
    assert (db_session.get(MessageJob, reminder.id).status, SENT) == ("canceled", [])
    db_session.get(MessageJob, reminder.id).status = "failed"
    db_session.commit()
    r = client.post(f"/api/admin/messages/{reminder.id}/retry", headers=sa)
    assert r.status_code == 400 and "התור כבר התחיל" in r.json()["detail"]
    assert client.post(f"/api/admin/messages/retry-all-failed?studio_id={s.id}", headers=sa).json() == {"reset": 0}  # 90 days old


def test_a_push_to_someone_without_the_app_is_no_failure(client, db_session):
    """Owner, 2026-10-12: a worker without the app filled the owner's bell with "הודעת פוש נכשלה"."""
    register_and_login(client, slug="push-shop", email="owner@push-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "push-shop"))
    owner = db_session.scalar(select(User).where(User.email == "owner@push-shop.com"))
    j = MessageJob(studio_id=s.id, recipient_user_id=owner.id, channel="push", body="תור חדש", attempts=2,
                   scheduled_at=datetime.now(timezone.utc), status="pending")
    db_session.add(j)
    db_session.commit()
    mw.process_due_jobs(db_session)

    db_session.expire_all()
    j = db_session.get(MessageJob, j.id)
    assert j.status == "canceled" and "אין את האפליקציה" in j.last_error
    assert SENT == []                                                      # no alert to the superadmin
    assert db_session.scalar(select(Notification).where(Notification.studio_id == s.id,
                                                        Notification.type == "message_failed")) is None


def test_a_failed_message_waits_before_trying_again_and_a_canceled_appointment_gets_none(client, db_session, monkeypatch):
    """2026-10-20: Green API was "starting" for a few minutes and 12 messages failed for good — three tries a
    minute apart. And a retry of them would have confirmed an appointment the business had canceled."""
    from datetime import timedelta
    from app.models.appointment import Appointment
    register_and_login(client, slug="wait-shop", email="owner@wait-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "wait-shop"))
    owner = db_session.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
    c = Client(studio_id=s.id, full_name="דנה", phone="0505555555")
    db_session.add(c)
    db_session.flush()
    now = datetime.now(timezone.utc)
    canceled = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="קעקוע", status="canceled",
                           starts_at=now + timedelta(days=3), ends_at=now + timedelta(days=3, hours=1))
    db_session.add(canceled)
    db_session.flush()
    confirm = MessageJob(studio_id=s.id, client_id=c.id, appointment_id=canceled.id, channel="whatsapp", to_phone=c.phone,
                         body="התור נקבע", reminder_type="new_appointment", scheduled_at=now, status="pending")
    db_session.add(confirm)
    db_session.commit()
    job = _job(db_session, s, c)

    def down(to, body, *a, **k):
        raise RuntimeError("Green API instance is starting")
    monkeypatch.setattr(mw, "send_whatsapp_message", down)
    mw.process_due_jobs(db_session)
    db_session.expire_all()
    assert db_session.get(MessageJob, confirm.id).status == "canceled"
    assert "התור בוטל" in db_session.get(MessageJob, confirm.id).last_error

    j = db_session.get(MessageJob, job.id)
    assert (j.status, j.attempts) == ("pending", 1)
    assert j.scheduled_at > now + timedelta(minutes=1)                               # in 2 minutes, not on the next tick
    mw.process_due_jobs(db_session)                                                  # the next tick leaves it alone
    db_session.expire_all()
    assert db_session.get(MessageJob, job.id).attempts == 1

    for _ in mw.RETRY_AFTER_MINUTES:                                                 # every try after its wait
        db_session.get(MessageJob, job.id).scheduled_at = datetime.now(timezone.utc)
        db_session.commit()
        mw.process_due_jobs(db_session)
        db_session.expire_all()
    j = db_session.get(MessageJob, job.id)
    assert (j.status, j.attempts) == ("failed", len(mw.RETRY_AFTER_MINUTES) + 1)
    SENT.clear()
