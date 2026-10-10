"""
WhatsApp messages a month — the plan's quota (the whatsapp module's limit: עסק קטן 400, פרו 1,500, חברה גדולה 8,000;
owner, 2026-10-10), and עסק קטן's broadcasts a month (10). The one place that counts and decides.

Every WhatsApp a business sends counts — confirmations, reminders, receipts, broadcasts, a message from the client
card — except a test message. Push is never counted. When the month's messages run out:
- marketing (broadcasts, club invitations, birthday) is not sent;
- a service message (a confirmation, a reminder, a receipt…) goes by e-mail instead when the client has one;
and the owner hears of it at 80% and at 100% (the bell). The month is Israel's calendar month.
"""
from __future__ import annotations

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.features import _get_usage, _period_key, effective_quota, increment_usage

WHATSAPP = "whatsapp"
BROADCASTS = "broadcasts"
OUT = "נגמרו הודעות ה-WhatsApp של החודש במסלול"


def _plan(db: Session, studio_id) -> str:
    from app.models.studio import Studio
    studio = db.get(Studio, studio_id)
    return (studio.subscription_plan if studio else None) or "free"


def balance(db: Session, studio_id, key: str = WHATSAPP) -> dict:
    """This month: used, the plan's limit (None — no limit) and what is left."""
    config = effective_quota(db, studio_id, _plan(db, studio_id), key)
    month = _period_key("monthly")
    used = _get_usage(db, studio_id, key, month)
    limit = config["limit"] if config["period_type"] == "monthly" else None
    return {"used": used, "limit": limit, "remaining": None if limit is None else max(0, limit - used), "month": month}


def can_send(db: Session, studio_id, n: int = 1) -> bool:
    left = balance(db, studio_id)["remaining"]
    return left is None or left >= n


def count_sent(db: Session, studio_id, n: int = 1) -> None:
    """After a WhatsApp went out — counted, and the owner told when the month reaches 80% and 100%."""
    month = _period_key("monthly")
    increment_usage(db, studio_id, WHATSAPP, month, n)
    db.flush()
    b = balance(db, studio_id)
    if b["limit"]:
        for share in (80, 100):
            mark = math.ceil(b["limit"] * share / 100)
            if b["used"] >= mark > b["used"] - n:
                _tell_owner(db, studio_id, share, b["limit"], month)


def _tell_owner(db: Session, studio_id, share: int, limit: int, month: str) -> None:
    from app.models.notification import Notification
    key = f"whatsapp-quota-{month}-{share}"
    if db.scalar(select(Notification.id).where(Notification.studio_id == studio_id, Notification.dedup_key == key)):
        return
    if share == 100:
        title = "נגמרו הודעות ה-WhatsApp של החודש"
        body = (f"נשלחו {limit} הודעות — כל המכסה של המסלול לחודש. עד תחילת החודש הבא תזכורות ואישורים יוצאים במייל "
                f"ללקוחות שיש להם מייל, ותפוצות לא יוצאות.")
    else:
        title = f"נוצלו {share}% מהודעות ה-WhatsApp של החודש"
        body = f"נשלחו {math.ceil(limit * share / 100)} מתוך {limit} הודעות במסלול החודש."
    db.add(Notification(studio_id=studio_id, type="whatsapp_quota", title=title, body=body,
                        action_url="/overview?billing=plans", dedup_key=key))


def out_of_messages(db: Session, job) -> None:
    """A queued WhatsApp with no messages left this month: marketing is cancelled; a service message becomes an
    e-mail when the client has one (or is cancelled when its e-mail twin already went out). The job's note says so."""
    from app.models.client import Client
    from app.models.message_job import MessageJob
    from app.models.studio import Studio
    from app.services.marketing import is_marketing

    kind = getattr(job, "reminder_type", None)
    if is_marketing(kind):
        job.status, job.last_error = "canceled", f"{OUT} — הודעה שיווקית לא נשלחה"
        return
    if kind and job.appointment_id and db.scalar(select(MessageJob.id).where(
            MessageJob.appointment_id == job.appointment_id, MessageJob.reminder_type == f"{kind}_email").limit(1)):
        job.status, job.last_error = "canceled", f"{OUT} — הלקוח מקבל אותה במייל"
        return
    client = db.get(Client, job.client_id) if job.client_id else None
    if client and client.email:
        studio = db.get(Studio, job.studio_id)
        job.channel, job.to_phone = "email", client.email
        job.subject = job.subject or f"הודעה מ{studio.name if studio else 'העסק'}"
        return
    job.status, job.last_error = "canceled", f"{OUT} — ללקוח אין מייל"


def broadcasts_left(db: Session, studio_id) -> int | None:
    """עסק קטן's broadcasts this month (a test send is not one) — None when the plan has no limit."""
    return balance(db, studio_id, BROADCASTS)["remaining"]


def count_broadcast(db: Session, studio_id, created_at=None, by: int = 1) -> None:
    """A broadcast created (by=1) or cancelled before it went out (by=-1) — counted in the month it was created."""
    month = _period_key("monthly", created_at)
    if by < 0 and _get_usage(db, studio_id, BROADCASTS, month) <= 0:
        return
    increment_usage(db, studio_id, BROADCASTS, month, by)
