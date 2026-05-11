"""
Webhook endpoint for incoming messages.
Supports: Meta Cloud API (WhatsApp), Green API (WhatsApp), Instagram DMs,
          Facebook Messenger, Facebook/Instagram Lead Ads.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.database import get_db
from app.models.incoming_message import IncomingMessage
from app.models.studio_settings import StudioSettings
from app.models.client import Client
from app.models.lead import Lead

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

def _match_lead(db: Session, studio_id, phone: str | None, external_id: str | None = None) -> Lead | None:
    """Find existing open lead so we don't create duplicates."""
    if external_id:
        existing = db.scalar(select(Lead).where(
            Lead.studio_id == studio_id,
            Lead.external_id == external_id,
        ))
        if existing:
            return existing
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
    campaign_name: str | None = None,
    ad_id: str | None = None,
    external_id: str | None = None,
) -> None:
    """Create a lead from an inbound message if person is not already a client/lead."""
    # Skip if existing client
    if phone and _match_client(db, studio_id, phone):
        return
    # Skip if already an open lead
    if _match_lead(db, studio_id, phone, external_id):
        return

    lead = Lead(
        id=uuid.uuid4(),
        studio_id=studio_id,
        name=name or phone or "לא ידוע",
        phone=phone,
        source=source,
        status="new",
        notes=body[:500] if body else None,
        campaign_name=campaign_name,
        ad_id=ad_id,
        external_id=external_id,
    )
    db.add(lead)
    db.commit()

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
    mode      = request.query_params.get("hub.mode")
    token     = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    if mode == "subscribe" and token == verify_token:
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/meta")
async def meta_incoming(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        obj  = data.get("object", "")

        if obj == "whatsapp_business_account":
            _handle_whatsapp(db, data)
        elif obj == "instagram":
            _handle_instagram(db, data)
        elif obj == "page":
            _handle_facebook(db, data)

    except Exception as e:
        print(f"[meta_webhook] error: {e}")
    return {"status": "ok"}


PLATFORM_STUDIO_ID = os.getenv("PLATFORM_STUDIO_ID", "46b85021-8eb4-4e63-a2e1-638dbb3e58fb")


def _find_settings_for_phone_id(db: Session, phone_id: str) -> StudioSettings | None:
    """Find studio settings by phone_id — falls back to platform studio settings."""
    settings = _find_by_phone_id(db, phone_id)
    if settings:
        return settings
    # If it's the platform's own number, route to platform studio
    platform = db.get(StudioSettings, PLATFORM_STUDIO_ID)
    if platform and platform.whatsapp_phone_id == phone_id:
        return platform
    return None


def _handle_whatsapp(db: Session, data: dict):
    for entry in data.get("entry", []):
        for change in entry.get("changes", []):
            value    = change.get("value", {})
            phone_id = value.get("metadata", {}).get("phone_number_id", "")
            settings = _find_settings_for_phone_id(db, phone_id)
            if not settings:
                continue

            # ── Lead Ads form submitted via WhatsApp ──────────────────────────
            # (leadgen object arrives inside whatsapp_business_account too)
            for leadgen in value.get("leads", []):
                _handle_leadgen_entry(db, settings.studio_id, leadgen, source="whatsapp")

            for msg in value.get("messages", []):
                if msg.get("type") not in ("text", "button"):
                    continue
                from_phone = msg.get("from", "")
                body       = (msg.get("text") or msg.get("button") or {}).get("body", "")
                profile    = next(
                    (c.get("profile", {}) for c in value.get("contacts", []) if c.get("wa_id") == from_phone),
                    {}
                )
                from_name = profile.get("name")

                # Referral = message came from clicking a WhatsApp ad
                referral      = msg.get("referral", {})
                campaign_name = referral.get("headline") or referral.get("source_url")
                ad_id         = referral.get("source_id")

                client = _match_client(db, settings.studio_id, from_phone)
                _save(db, settings.studio_id, from_phone, from_name, body, "whatsapp",
                      client.id if client else None)

                # Auto-create lead for unknowns
                _auto_lead(db, settings.studio_id, "whatsapp", from_phone, from_name,
                           body, campaign_name=campaign_name, ad_id=ad_id)


def _handle_instagram(db: Session, data: dict):
    for entry in data.get("entry", []):
        ig_id    = str(entry.get("id", ""))
        settings = _find_by_ig_account(db, ig_id)

        # Lead Ads submitted via Instagram
        for leadgen in entry.get("changes", []):
            if leadgen.get("field") == "leadgen":
                _handle_leadgen_entry(db, settings.studio_id if settings else None,
                                      leadgen.get("value", {}), source="instagram")

        if not settings:
            continue
        for event in entry.get("messaging", []):
            sender_id = event.get("sender", {}).get("id", "")
            if sender_id == ig_id:
                continue
            msg  = event.get("message", {})
            body = msg.get("text", "")
            if not body or msg.get("is_echo"):
                continue
            _save(db, settings.studio_id, sender_id, None, body, "instagram")
            _auto_lead(db, settings.studio_id, "instagram", None, None, body)


def _handle_facebook(db: Session, data: dict):
    for entry in data.get("entry", []):
        page_id  = str(entry.get("id", ""))
        settings = _find_by_page_id(db, page_id)

        # Lead Ads submitted via Facebook page
        for change in entry.get("changes", []):
            if change.get("field") == "leadgen":
                _handle_leadgen_entry(db, settings.studio_id if settings else None,
                                      change.get("value", {}), source="facebook")

        if not settings:
            continue
        for event in entry.get("messaging", []):
            sender_id = event.get("sender", {}).get("id", "")
            if sender_id == page_id:
                continue
            msg  = event.get("message", {})
            body = msg.get("text", "")
            if not body or msg.get("is_echo"):
                continue
            _save(db, settings.studio_id, sender_id, None, body, "facebook")
            _auto_lead(db, settings.studio_id, "facebook", None, None, body)


def _handle_leadgen_entry(db: Session, studio_id, payload: dict, source: str):
    """
    Process a Meta Lead Ads submission.
    payload keys: lead_id, form_id, ad_id, adgroup_id, page_id, campaign_name, ad_name, form_name, field_data
    field_data: [{"name": "full_name", "values": ["John"]}, {"name": "phone_number", "values": ["+972..."]}]
    """
    if not studio_id:
        return

    external_id   = str(payload.get("lead_id", ""))
    campaign_name = payload.get("campaign_name") or payload.get("ad_name") or payload.get("form_name")
    ad_id         = str(payload.get("ad_id", "") or payload.get("adgroup_id", ""))

    # Parse field_data into a dict
    fields: dict[str, str] = {}
    for f in payload.get("field_data", []):
        key    = f.get("name", "").lower()
        values = f.get("values", [])
        if values:
            fields[key] = values[0]

    name  = fields.get("full_name") or fields.get("name") or fields.get("שם") or "ליד חדש"
    phone = fields.get("phone_number") or fields.get("phone") or fields.get("טלפון")
    email = fields.get("email") or fields.get("אימייל")
    notes_parts = [f"{k}: {v}" for k, v in fields.items()
                   if k not in ("full_name", "name", "phone_number", "phone", "email")]
    notes = "\n".join(notes_parts) if notes_parts else None

    # Skip duplicate
    if _match_lead(db, studio_id, phone, external_id):
        return

    lead = Lead(
        id=uuid.uuid4(),
        studio_id=studio_id,
        name=name,
        phone=phone,
        email=email,
        source=source,
        status="new",
        notes=notes,
        campaign_name=campaign_name,
        ad_id=ad_id or None,
        external_id=external_id or None,
    )
    db.add(lead)
    db.commit()


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
        body        = data.get("messageData", {}).get("textMessageData", {}).get("textMessage", "")

        if not body or not raw_phone:
            return {"status": "ignored"}

        client = _match_client(db, settings.studio_id, raw_phone)
        _save(db, settings.studio_id, raw_phone, from_name, body, "whatsapp",
              client.id if client else None)
        _auto_lead(db, settings.studio_id, "whatsapp", raw_phone, from_name, body)

    except Exception as e:
        print(f"[green_webhook] error: {e}")
    return {"status": "ok"}
