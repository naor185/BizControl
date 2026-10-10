"""Stage 3 of the plans: WhatsApp messages a month by plan (עסק קטן 400, פרו 1,500, חברה גדולה 8,000 — owner,
2026-10-10) and עסק קטן's 10 broadcasts a month. Every WhatsApp counts (a test message doesn't); push never does.
Past the limit marketing stops and a service message goes by e-mail; the owner hears at 80% and 100%; the usage
shows to the owner. Local test database; the senders are fakes — nothing is sent."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text

from app.core.features import _period_key
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.notification import Notification
from app.models.studio import Studio
from app.services import message_quota
from app.services.message_worker import process_due_jobs
from tests.conftest import SENT, register_and_login


def _on(client, db, slug, plan):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.subscription_plan = plan
    db.commit()
    return h, s


def _used(db, s, n, key="whatsapp"):
    db.execute(text("""INSERT INTO studio_usage_counters (studio_id, quota_key, period_key, used_count)
                       VALUES (:s, :k, :m, :n) ON CONFLICT (studio_id, quota_key, period_key) DO UPDATE SET used_count = :n"""),
               {"s": str(s.id), "k": key, "m": _period_key("monthly"), "n": n})
    db.commit()


def _job(db, s, c, kind, channel="whatsapp", to=None):
    j = MessageJob(studio_id=s.id, client_id=c.id, channel=channel, to_phone=to or c.phone, body="תזכורת: התור מחר ב-10:00",
                   reminder_type=kind, scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=1), status="pending")
    db.add(j)
    db.commit()
    return j


def test_every_whatsapp_counts_and_the_owner_hears_at_80_and_100(client, db_session):
    _, s = _on(client, db_session, "small-wa", "starter")
    c = Client(studio_id=s.id, full_name="יעל", phone="0501112233", marketing_consent=True)
    db_session.add(c)
    db_session.commit()
    _used(db_session, s, 319)
    _job(db_session, s, c, "1day")
    process_due_jobs(db_session)
    assert SENT == [("whatsapp", "0501112233")]
    SENT.clear()
    assert message_quota.balance(db_session, s.id) == {"used": 320, "limit": 400, "remaining": 80, "month": _period_key("monthly")}
    titles = db_session.scalars(select(Notification.title).where(Notification.studio_id == s.id)).all()
    assert titles == ["נוצלו 80% מהודעות ה-WhatsApp של החודש"]

    _used(db_session, s, 399)
    _job(db_session, s, c, "same_day")
    process_due_jobs(db_session)
    SENT.clear()
    assert "נגמרו הודעות ה-WhatsApp של החודש" in db_session.scalars(select(Notification.title).where(Notification.studio_id == s.id)).all()


def test_past_the_limit_marketing_stops_and_a_reminder_goes_by_email(client, db_session):
    _, s = _on(client, db_session, "small-out", "starter")
    with_mail = Client(studio_id=s.id, full_name="דנה", phone="0502223344", email="dana@x.com", marketing_consent=True)
    no_mail = Client(studio_id=s.id, full_name="רון", phone="0503334455", marketing_consent=True)
    db_session.add_all([with_mail, no_mail])
    db_session.commit()
    _used(db_session, s, 400)
    reminder = _job(db_session, s, with_mail, "1day")
    lost = _job(db_session, s, no_mail, "1day")
    promo = _job(db_session, s, with_mail, "broadcast")
    process_due_jobs(db_session)
    assert SENT == [("email", "dana@x.com")]                                  # no WhatsApp went out
    SENT.clear()
    db_session.expire_all()
    assert (reminder.channel, reminder.status) == ("email", "sent")
    assert lost.status == "canceled" and "ללקוח אין מייל" in lost.last_error
    assert promo.status == "canceled" and "הודעה שיווקית לא נשלחה" in promo.last_error
    assert message_quota.balance(db_session, s.id)["used"] == 400            # the e-mail is not a WhatsApp


def test_the_client_card_message_and_broadcasts_respect_the_month(client, db_session):
    h, s = _on(client, db_session, "small-bc", "starter")
    c = Client(studio_id=s.id, full_name="טל", phone="0504445566", marketing_consent=True)
    db_session.add(c)
    db_session.commit()

    _used(db_session, s, 400)
    r = client.post("/api/messages/quick-send", headers=h, json={"client_id": str(c.id), "body": "היי"})
    assert r.status_code == 429 and r.json()["detail"].startswith("נגמרו הודעות ה-WhatsApp של החודש")
    body = {"title": "מבצע", "body": "20% הנחה", "audience": "all", "scheduled_at": datetime.now(timezone.utc).isoformat()}
    r = client.post("/api/broadcasts", headers=h, json=body)
    assert r.status_code == 400 and "ונשארו במסלול 0 הודעות" in r.json()["detail"]

    _used(db_session, s, 0)
    _used(db_session, s, 10, "broadcasts")
    assert client.post("/api/broadcasts", headers=h, json=body).json()["detail"] == "נשלחו כל התפוצות של החודש במסלול. אפשר לשלוח שוב בחודש הבא."
    _used(db_session, s, 9, "broadcasts")
    made = client.post("/api/broadcasts", headers=h, json=body)
    assert made.status_code == 201 and message_quota.broadcasts_left(db_session, s.id) == 0
    assert client.delete(f"/api/broadcasts/{made.json()['id']}", headers=h).status_code == 204
    db_session.expire_all()
    assert message_quota.broadcasts_left(db_session, s.id) == 1                # cancelled before it went out


def test_the_owner_sees_the_month(client, db_session):
    h, s = _on(client, db_session, "small-see", "starter")
    _used(db_session, s, 123)
    usage = {u["key"]: (u["used"], u["limit"], u["remaining"]) for u in client.get("/api/modules/me/usage", headers=h).json()}
    assert usage["whatsapp"] == (123, 400, 277) and usage["broadcasts"] == (0, 10, 10)
    s.subscription_plan = "pro"
    db_session.commit()
    usage = {u["key"]: (u["used"], u["limit"]) for u in client.get("/api/modules/me/usage", headers=h).json()}
    assert usage["whatsapp"] == (123, 1500) and "broadcasts" not in usage     # pro: broadcasts unlimited
