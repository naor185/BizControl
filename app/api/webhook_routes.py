"""
Webhook endpoint for incoming messages.
Supports: Meta Cloud API (WhatsApp), Green API (WhatsApp), Instagram DMs, Facebook Messenger.
"""
from __future__ import annotations
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.models.incoming_message import IncomingMessage
from app.models.studio_settings import StudioSettings
from app.models.client import Client

router = APIRouter(prefix="/webhook", tags=["Webhook"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _find_by_phone_id(db: Session, phone_id: str) -> StudioSettings | None:
    return db.scalar(select(StudioSettings).where(StudioSettings.whatsapp_phone_id == phone_id))

def _find_by_instance(db: Session, instance_id: str) -> StudioSettings | None:
    return db.scalar(select(StudioSettings).where(StudioSettings.whatsapp_instance_id == instance_id))

def _find_by_page_id(db: Session, page_id: str) -> StudioSettings | None:
    return db.scalar(select(StudioSettings).where(StudioSettings.facebook_page_id == page_id))

def _find_by_ig_account(db: Session, ig_id: str) -> StudioSettings | None:
    return db.scalar(select(StudioSettings).where(StudioSettings.instagram_account_id == ig_id))

def _match_client(db: Session, studio_id, phone: str) -> Client | None:
    clean = phone.replace("+", "").replace(" ", "").replace("-", "")
    return db.scalar(
        select(Client).where(
            Client.studio_id == studio_id,
            Client.phone.in_([phone, f"+{clean}", clean])
        )
    )

def _save(db: Session, studio_id, from_phone: str, from_name: str | None, body: str, channel: str, client_id=None):
    msg = IncomingMessage(
        studio_id=studio_id,
        client_id=client_id,
        from_phone=from_phone,
        from_name=from_name,
        body=body,
        channel=channel,
        received_at=datetime.now(timezone.utc),
    )
    db.add(msg)
    db.commit()


# ── Meta Unified Webhook ──────────────────────────────────────────────────────

@router.get("/meta")
def meta_verify(request: Request):
    verify_token = os.getenv("META_WEBHOOK_VERIFY_TOKEN", "bizcontrol_verify")
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    if mode == "subscribe" and token == verify_token:
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/meta")
async def meta_incoming(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        obj = data.get("object", "")

        if obj == "whatsapp_business_account":
            _handle_whatsapp(db, data)
        elif obj == "instagram":
            _handle_instagram(db, data)
        elif obj == "page":
            _handle_facebook(db, data)

    except Exception as e:
        print(f"[meta_webhook] error: {e}")
    return {"status": "ok"}


def _handle_whatsapp(db: Session, data: dict):
    for entry in data.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            phone_id = value.get("metadata", {}).get("phone_number_id", "")
            settings = _find_by_phone_id(db, phone_id)
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
                _save(db, settings.studio_id, from_phone, from_name, body, "whatsapp", client.id if client else None)


def _handle_instagram(db: Session, data: dict):
    for entry in data.get("entry", []):
        ig_id = str(entry.get("id", ""))
        settings = _find_by_ig_account(db, ig_id)
        if not settings:
            continue
        for event in entry.get("messaging", []):
            sender_id = event.get("sender", {}).get("id", "")
            # Ignore messages sent by ourselves (the IG account)
            if sender_id == ig_id:
                continue
            msg = event.get("message", {})
            body = msg.get("text", "")
            if not body or msg.get("is_echo"):
                continue
            _save(db, settings.studio_id, sender_id, None, body, "instagram")


def _handle_facebook(db: Session, data: dict):
    for entry in data.get("entry", []):
        page_id = str(entry.get("id", ""))
        settings = _find_by_page_id(db, page_id)
        if not settings:
            continue
        for event in entry.get("messaging", []):
            sender_id = event.get("sender", {}).get("id", "")
            if sender_id == page_id:
                continue
            msg = event.get("message", {})
            body = msg.get("text", "")
            if not body or msg.get("is_echo"):
                continue
            _save(db, settings.studio_id, sender_id, None, body, "facebook")


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
        raw_phone = sender_data.get("chatId", "").replace("@c.us", "")
        from_name = sender_data.get("senderName")
        body = data.get("messageData", {}).get("textMessageData", {}).get("textMessage", "")

        if not body or not raw_phone:
            return {"status": "ignored"}

        client = _match_client(db, settings.studio_id, raw_phone)
        _save(db, settings.studio_id, raw_phone, from_name, body, "whatsapp", client.id if client else None)
    except Exception as e:
        print(f"[green_webhook] error: {e}")
    return {"status": "ok"}
