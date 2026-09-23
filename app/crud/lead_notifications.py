import logging
import uuid
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


def create_lead_for_booking_request(
    db: Session, studio_id, request_id, *, name: str, phone: str | None, email: str | None,
    service_note: str | None, requested_local: str | None = None,
) -> None:
    """
    An appointment request from BizFind / the public booking page is a lead: create it
    (source "bizfind", linked through booking_requests.lead_id so approve/reject can still be
    done from the lead) and fire the usual new-lead alerts. Called after the request itself is
    committed, and never raises - the public endpoint must not fail because of this.
    """
    from app.models.booking_request import BookingRequest
    from app.models.lead import Lead

    sid = studio_id if isinstance(studio_id, UUID) else UUID(str(studio_id))
    try:
        notes = "בקשת תור מ-BizFind" + (f" — {requested_local}" if requested_local else "")
        if service_note:
            notes += f"\n\n{service_note}"
        lead = Lead(
            id=uuid.uuid4(), studio_id=sid, name=name, phone=phone, email=email,
            source="bizfind", status="new",
            service_interest=service_note[:255] if service_note else None, notes=notes,
        )
        db.add(lead)
        req = db.get(BookingRequest, request_id if isinstance(request_id, UUID) else UUID(str(request_id)))
        if req:
            req.lead_id = lead.id
        db.commit()
    except Exception as e:
        db.rollback()
        log.warning("lead for booking request %s failed: %s", request_id, e)
        return
    notify_new_lead(db, sid, lead.id, name, service_note)
