from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.message_job import MessageJob

def enqueue_push_to_studio_admins(db: Session, studio_id: UUID, title: str, body: str,
                                   deep_link: str | None = None, reminder_type: str | None = None) -> None:
    """Queues a push notification (channel='push') to every active owner/admin user of the studio.
    Drained by the same message_jobs worker as WhatsApp/email — see process_due_jobs()."""
    recipients = db.execute(
        select(User).where(User.studio_id == studio_id, User.role.in_(("owner", "admin")), User.is_active == True)
    ).scalars().all()
    if not recipients:
        return
    now = datetime.now(timezone.utc)
    for u in recipients:
        db.add(MessageJob(
            studio_id=studio_id,
            recipient_user_id=u.id,
            channel="push",
            subject=title,
            body=body,
            deep_link=deep_link,
            reminder_type=reminder_type,
            scheduled_at=now,
            status="pending",
        ))
    db.commit()


def enqueue_push_to_customer(db: Session, studio_id: UUID, customer_id: UUID, title: str, body: str,
                              deep_link: str | None = None, reminder_type: str | None = None) -> None:
    """Queues a push notification (channel='push') to a single BizFind
    marketplace customer's device(s) — drained by the same message_jobs
    worker as everything else. See enqueue_push_to_studio_admins for the
    studio-owner-facing equivalent."""
    db.add(MessageJob(
        studio_id=studio_id,
        recipient_customer_id=customer_id,
        channel="push",
        subject=title,
        body=body,
        deep_link=deep_link,
        reminder_type=reminder_type,
        scheduled_at=datetime.now(timezone.utc),
        status="pending",
    ))
    db.commit()


def enqueue_push_to_customer_by_phone(db: Session, studio_id: UUID, phone: str | None, title: str, body: str,
                                       deep_link: str | None = None, reminder_type: str | None = None) -> None:
    """Same as enqueue_push_to_customer, but for the common case at the call
    sites in app/crud/automation.py: they only have the studio client's
    phone, not a marketplace_customers.id. No-op if that phone was never
    used to sign up for a BizFind account (marketplace_customers has no ORM
    model — matched with the same plain phone equality already used
    elsewhere for this table, e.g. marketplace_customer_routes.py)."""
    if not phone:
        return
    row = db.execute(text("SELECT id FROM marketplace_customers WHERE phone = :phone"), {"phone": phone}).fetchone()
    if not row:
        return
    enqueue_push_to_customer(db, studio_id, row[0], title, body, deep_link=deep_link, reminder_type=reminder_type)
