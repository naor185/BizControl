"""
AI audit logging — saves every event to the ai_audit_logs table.
Non-blocking: errors here must never crash the main request.
"""
from __future__ import annotations

import uuid
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.ai_audit_log import AIAuditLog
from app.models.ai_conversation import AIConversation
from app.models.ai_message import AIMessage


def log_event(
    db: Session,
    event_type: str,
    studio_id: UUID | None = None,
    user_id: UUID | None = None,
    details: dict | None = None,
) -> None:
    try:
        entry = AIAuditLog(
            id=uuid.uuid4(),
            studio_id=studio_id,
            user_id=user_id,
            event_type=event_type,
            details=details or {},
        )
        db.add(entry)
        db.flush()
    except Exception:
        pass  # audit failures must never crash the AI endpoint


def get_or_create_conversation(
    db: Session,
    studio_id: UUID,
    user_id: UUID,
    conversation_id: UUID | None,
) -> AIConversation:
    if conversation_id:
        conv = db.get(AIConversation, conversation_id)
        if conv and conv.studio_id == studio_id:
            return conv

    conv = AIConversation(
        id=uuid.uuid4(),
        studio_id=studio_id,
        user_id=user_id,
    )
    db.add(conv)
    db.flush()
    return conv


def save_message(
    db: Session,
    conversation_id: UUID,
    role: str,
    content: str,
    tools_used: list | None = None,
    tokens_used: int = 0,
) -> AIMessage:
    msg = AIMessage(
        id=uuid.uuid4(),
        conversation_id=conversation_id,
        role=role,
        content=content,
        tools_used=tools_used,
        tokens_used=tokens_used,
    )
    db.add(msg)
    return msg


def update_conversation_stats(
    db: Session,
    conv: AIConversation,
    added_messages: int,
    added_tokens: int,
) -> None:
    try:
        conv.message_count = (conv.message_count or 0) + added_messages
        conv.total_tokens = (conv.total_tokens or 0) + added_tokens
    except Exception:
        pass
