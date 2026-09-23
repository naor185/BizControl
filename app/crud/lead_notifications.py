import logging
from uuid import UUID

from sqlalchemy.orm import Session

from app.crud.push import enqueue_push_to_studio_admins
from app.models.notification import Notification

log = logging.getLogger(__name__)


def notify_new_lead(db: Session, studio_id, lead_id, name: str, detail: str | None = None) -> None:
    """
    Everything the studio should see when a lead arrives: an in-app notification
    (shows in the bell) and a push to the owners/admins. The dashboard badges are
    driven by GET /api/leads/new-count. Never raises — a notification problem must
    not fail lead creation (this runs inside webhooks).
    """
    sid = studio_id if isinstance(studio_id, UUID) else UUID(str(studio_id))
    body = name + (f" — {detail}" if detail else "")
    try:
        db.add(Notification(studio_id=sid, type="new_lead", title="ליד חדש", body=body, action_url="/overview"))
        db.commit()
    except Exception as e:
        db.rollback()
        log.warning("new-lead notification failed for lead %s: %s", lead_id, e)
    try:
        enqueue_push_to_studio_admins(db, sid, title="ליד חדש", body=body, deep_link="/overview", reminder_type="new_lead")
    except Exception as e:
        log.warning("new-lead push failed for lead %s: %s", lead_id, e)
