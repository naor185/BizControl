"""
Webhook endpoint for incoming WhatsApp messages — Green API (a linked device), the only WhatsApp the system uses
(the Meta connection was removed, 2026-11-07).
"""
from __future__ import annotations
import uuid
from fastapi import APIRouter, Request, Depends
from app.utils.logger import get_logger

log = get_logger(__name__)
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.models.studio_settings import StudioSettings
from app.models.client import Client
from app.models.lead import Lead

router = APIRouter(prefix="/webhook", tags=["Webhook"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _find_by_instance(db: Session, instance_id: str) -> StudioSettings | None:
    return db.scalar(select(StudioSettings).where(StudioSettings.whatsapp_instance_id == instance_id))

def _match_client(db: Session, studio_id, phone: str) -> Client | None:
    # WhatsApp sends 972501234567; clients are kept as 0501234567 (app/utils/phone.normalize_phone)
    from app.utils.phone import normalize_phone
    clean = phone.replace("+", "").replace(" ", "").replace("-", "")
    forms = {phone, f"+{clean}", clean} | ({normalize_phone(phone)} - {None})
    return db.scalar(
        select(Client).where(
            Client.studio_id == studio_id,
            Client.phone.in_(forms),
        ).order_by(Client.is_active.desc(), Client.created_at.desc()).limit(1)
    )


def _unsubscribe_reply(db: Session, studio_id, phone: str, body: str) -> bool:
    """A "הסר" reply: the client stops getting marketing and the owner is told. True when the message was one —
    it is then not a lead either (an unknown number asking to be removed is simply left alone)."""
    from app.services.marketing import is_unsubscribe_reply, record_unsubscribe
    if not is_unsubscribe_reply(body):
        return False
    client = _match_client(db, studio_id, phone)
    if client is not None and record_unsubscribe(db, client, "whatsapp"):
        db.commit()
        log.info("Client %s opted out by WhatsApp reply (studio %s)", client.id, studio_id)
    return True

def _match_lead(db: Session, studio_id, phone: str | None) -> Lead | None:
    """Find existing open lead so we don't create duplicates."""
    if phone:
        clean = phone.replace("+", "").replace(" ", "").replace("-", "")
        return db.scalar(select(Lead).where(
            Lead.studio_id == studio_id,
            Lead.phone.in_([phone, f"+{clean}", clean]),
            Lead.status.in_(["new", "contacted", "interested"]),
        ))
    return None

def _auto_lead(
    db: Session,
    studio_id,
    source: str,
    phone: str | None,
    name: str | None,
    body: str,
) -> None:
    """Create a lead from an inbound message if person is not already a client/lead."""
    # Skip if existing client
    if phone and _match_client(db, studio_id, phone):
        return
    # Skip if already an open lead
    if _match_lead(db, studio_id, phone):
        return

    lead = Lead(
        id=uuid.uuid4(),
        studio_id=studio_id,
        name=name or phone or "לא ידוע",
        phone=phone,
        source=source,
        status="new",
        notes=body[:500] if body else None,
    )
    db.add(lead)
    db.commit()

    from app.crud.lead_notifications import notify_new_lead
    notify_new_lead(db, studio_id, lead.id, lead.name)

    # Auto-tag in background (non-blocking)
    if body:
        try:
            from app.services.auto_tag_service import tag_lead
            import threading
            from app.core.database import SessionLocal
            def _tag():
                _db = SessionLocal()
                try:
                    tag_lead(_db, lead.id, body)
                finally:
                    _db.close()
            threading.Thread(target=_tag, daemon=True).start()
        except Exception:
            pass

# ── Green API (WhatsApp via linked device) ────────────────────────────────────

@router.post("/green/{instance_id}")
async def green_incoming(instance_id: str, request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        if data.get("typeWebhook") != "incomingMessageReceived":
            return {"status": "ignored"}

        settings = _find_by_instance(db, instance_id)
        if not settings:
            return {"status": "no_studio"}

        sender_data = data.get("senderData", {})
        raw_phone   = sender_data.get("chatId", "").replace("@c.us", "")
        from_name   = sender_data.get("senderName")
        message     = data.get("messageData", {})
        # a plain text, or a reply quoting our message / a text with a link (extendedTextMessageData)
        body        = (message.get("textMessageData", {}).get("textMessage")
                       or message.get("extendedTextMessageData", {}).get("text") or "")

        if not body or not raw_phone:
            return {"status": "ignored"}

        if _unsubscribe_reply(db, settings.studio_id, raw_phone, body):
            return {"status": "unsubscribed"}
        _auto_lead(db, settings.studio_id, "whatsapp", raw_phone, from_name, body)

    except Exception as e:
        log.exception("[green_webhook] error: %s", e)
    return {"status": "ok"}
