from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select
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
