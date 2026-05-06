"""
Webhook endpoint for incoming WhatsApp messages.
Supports both Meta Cloud API and Green API.
"""
from __future__ import annotations
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Request, Response, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from fastapi import Depends
from app.models.incoming_message import IncomingMessage
from app.models.studio_settings import StudioSettings
from app.models.client import Client

router = APIRouter(prefix="/webhook", tags=["Webhook"])


def _find_studio_by_phone_id(db: Session, phone_id: str):
    """Find studio whose whatsapp_phone_id matches."""
    return db.scalar(
        select(StudioSettings).where(StudioSettings.whatsapp_phone_id == phone_id)
    )


def _find_studio_by_instance(db: Session, instance_id: str):
    """Find studio whose whatsapp_instance_id matches."""
    return db.scalar(
        select(StudioSettings).where(StudioSettings.whatsapp_instance_id == instance_id)
    )


def _match_client(db: Session, studio_id, phone: str):
    """Try to match incoming phone to a known client."""
    clean = phone.replace("+", "").replace(" ", "").replace("-", "")
    row = db.scalar(
        select(Client).where(
            Client.studio_id == studio_id,
            Client.phone.in_([phone, f"+{clean}", clean])
        )
    )
    return row


def _save_message(db: Session, studio_id, from_phone: str, from_name: str | None, body: str, client_id=None):
    msg = IncomingMessage(
        studio_id=studio_id,
        client_id=client_id,
        from_phone=from_phone,
        from_name=from_name,
        body=body,
        channel="whatsapp",
        received_at=datetime.now(timezone.utc),
    )
    db.add(msg)
    db.commit()


# ─── Meta Cloud API Webhook ───────────────────────────────────────────────────

@router.get("/meta")
def meta_verify(request: Request):
    """Webhook verification handshake required by Meta."""
    verify_token = os.getenv("META_WEBHOOK_VERIFY_TOKEN", "bizcontrol_verify")
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    if mode == "subscribe" and token == verify_token:
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/meta")
async def meta_incoming(request: Request, db: Session = Depends(get_db)):
    """Receive incoming messages from Meta Cloud API."""
    try:
        data = await request.json()
        for entry in data.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                phone_id = value.get("metadata", {}).get("phone_number_id", "")
                settings = _find_studio_by_phone_id(db, phone_id)
                if not settings:
                    continue
                for msg in value.get("messages", []):
                    if msg.get("type") != "text":
                        continue
                    from_phone = msg.get("from", "")
                    body = msg.get("text", {}).get("body", "")
                    profile = next(
                        (c.get("profile", {}) for c in value.get("contacts", []) if c.get("wa_id") == from_phone),
                        {}
                    )
                    from_name = profile.get("name")
                    client = _match_client(db, settings.studio_id, from_phone)
                    _save_message(db, settings.studio_id, from_phone, from_name, body, client.id if client else None)
    except Exception as e:
        print(f"[meta_webhook] error: {e}")
    return {"status": "ok"}


# ─── Green API Webhook ────────────────────────────────────────────────────────

@router.post("/green/{instance_id}")
async def green_incoming(instance_id: str, request: Request, db: Session = Depends(get_db)):
    """Receive incoming messages from Green API."""
    try:
        data = await request.json()
        msg_type = data.get("typeWebhook")
        if msg_type != "incomingMessageReceived":
            return {"status": "ignored"}

        settings = _find_studio_by_instance(db, instance_id)
        if not settings:
            return {"status": "no_studio"}

        sender_data = data.get("senderData", {})
        raw_phone = sender_data.get("chatId", "").replace("@c.us", "")
        from_name = sender_data.get("senderName")
        body = data.get("messageData", {}).get("textMessageData", {}).get("textMessage", "")

        if not body or not raw_phone:
            return {"status": "ignored"}

        client = _match_client(db, settings.studio_id, raw_phone)
        _save_message(db, settings.studio_id, raw_phone, from_name, body, client.id if client else None)
    except Exception as e:
        print(f"[green_webhook] error: {e}")
    return {"status": "ok"}
