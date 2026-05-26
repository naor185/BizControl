"""
ConversationService — normalises incoming webhook messages into the unified
conversations / messages tables.

Usage (in webhook_routes.py):
    from app.services.conversation_service import ConversationService
    ConversationService.upsert_inbound(db, studio_id=..., platform="whatsapp",
        external_id="+972501234567", display_name="David", body="שלום",
        client_id=..., lead_id=..., attribution={...})
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.message import Message


class ConversationService:

    @staticmethod
    def upsert_inbound(
        db: Session,
        studio_id: uuid.UUID,
        platform: str,
        external_id: str,
        body: str,
        display_name: str | None = None,
        client_id: uuid.UUID | None = None,
        lead_id: uuid.UUID | None = None,
        external_message_id: str | None = None,
        msg_type: str = "text",
        media_url: str | None = None,
        media_type: str | None = None,
        attribution: dict | None = None,
    ) -> tuple[Conversation, Message]:
        """
        Upsert conversation (keyed on studio_id + platform + external_id) and
        append a new inbound message row.  Returns (conversation, message).
        """
        now = datetime.now(timezone.utc)
        attr = attribution or {}

        # ── Find or create conversation ────────────────────────────────────────
        conv = db.scalar(
            select(Conversation).where(
                Conversation.studio_id == studio_id,
                Conversation.platform == platform,
                Conversation.external_id == external_id,
            )
        )

        if conv is None:
            conv = Conversation(
                id=uuid.uuid4(),
                studio_id=studio_id,
                platform=platform,
                external_id=external_id,
                display_name=display_name,
                client_id=client_id,
                lead_id=lead_id,
                source_type=attr.get("source_type"),
                campaign_id=attr.get("campaign_id"),
                campaign_name=attr.get("campaign_name"),
                ad_id=attr.get("ad_id"),
                ad_name=attr.get("ad_name"),
                post_id=attr.get("post_id"),
                reel_id=attr.get("reel_id"),
                referral_url=attr.get("referral_url"),
                status="open",
                unread_count=0,
                message_count=0,
            )
            db.add(conv)
        else:
            # Patch up name / client / lead if we now know them
            if display_name and not conv.display_name:
                conv.display_name = display_name
            if client_id and not conv.client_id:
                conv.client_id = client_id
            if lead_id and not conv.lead_id:
                conv.lead_id = lead_id
            # Patch attribution if not yet set
            for field in ("source_type", "campaign_id", "campaign_name", "ad_id", "ad_name", "post_id", "reel_id", "referral_url"):
                if attr.get(field) and not getattr(conv, field):
                    setattr(conv, field, attr[field])

        # ── Update conversation counters ───────────────────────────────────────
        conv.last_message_at = now
        conv.unread_count = (conv.unread_count or 0) + 1
        conv.message_count = (conv.message_count or 0) + 1
        conv.updated_at = now

        # ── Append message row ────────────────────────────────────────────────
        msg = Message(
            id=uuid.uuid4(),
            conversation_id=conv.id,
            studio_id=studio_id,
            direction="in",
            platform=platform,
            external_message_id=external_message_id,
            type=msg_type,
            body=body,
            media_url=media_url,
            media_type=media_type,
            is_read=False,
            sent_at=now,
        )
        db.add(msg)

        return conv, msg

    @staticmethod
    def record_outbound(
        db: Session,
        studio_id: uuid.UUID,
        platform: str,
        external_id: str,
        body: str,
        sent_by: uuid.UUID | None = None,
        external_message_id: str | None = None,
        msg_type: str = "text",
        delivery_status: str = "sent",
    ) -> Optional[Message]:
        """Append an outbound message and update first_response_at if needed."""
        now = datetime.now(timezone.utc)

        conv = db.scalar(
            select(Conversation).where(
                Conversation.studio_id == studio_id,
                Conversation.platform == platform,
                Conversation.external_id == external_id,
            )
        )
        if conv is None:
            return None

        if conv.first_response_at is None:
            conv.first_response_at = now

        conv.last_message_at = now
        conv.message_count = (conv.message_count or 0) + 1
        conv.updated_at = now

        msg = Message(
            id=uuid.uuid4(),
            conversation_id=conv.id,
            studio_id=studio_id,
            direction="out",
            platform=platform,
            external_message_id=external_message_id,
            type=msg_type,
            body=body,
            is_read=True,
            delivery_status=delivery_status,
            sent_by=sent_by,
            sent_at=now,
        )
        db.add(msg)
        return msg

    @staticmethod
    def mark_read(db: Session, studio_id: uuid.UUID, platform: str, external_id: str) -> int:
        """Mark all inbound messages as read and reset unread_count."""
        conv = db.scalar(
            select(Conversation).where(
                Conversation.studio_id == studio_id,
                Conversation.platform == platform,
                Conversation.external_id == external_id,
            )
        )
        if not conv:
            return 0

        unread_msgs = db.scalars(
            select(Message).where(
                Message.conversation_id == conv.id,
                Message.direction == "in",
                Message.is_read == False,  # noqa: E712
            )
        ).all()

        for m in unread_msgs:
            m.is_read = True

        conv.unread_count = 0
        return len(unread_msgs)
