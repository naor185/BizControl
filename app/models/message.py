from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Boolean, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class Message(Base):
    """Unified message — one row per inbound/outbound message across all channels."""
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)

    direction: Mapped[str] = mapped_column(String(4), nullable=False)           # in | out
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    external_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)  # Meta message ID

    type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="text")  # text | image | video | audio | file | template
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_type: Mapped[str | None] = mapped_column(String(32), nullable=True)

    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    delivery_status: Mapped[str | None] = mapped_column(String(20), nullable=True)   # sent | delivered | read | failed

    sent_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # null = incoming
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
