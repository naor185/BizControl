from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("studio_id", "platform", "external_id", name="uq_conversation"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    lead_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)

    # Platform identity
    platform: Mapped[str] = mapped_column(String(20), nullable=False)          # whatsapp | instagram | facebook
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)      # phone / IGSID / PSID
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Attribution
    source_type: Mapped[str | None] = mapped_column(String(32), nullable=True)     # organic | paid_ad | story_reply | comment | lead_form
    campaign_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    campaign_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ad_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ad_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    post_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reel_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    referral_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="open")   # open | resolved | spam
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tags: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Metrics
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    unread_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
