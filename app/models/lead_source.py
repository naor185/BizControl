from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class LeadSource(Base):
    """Granular lead attribution — one row per attribution event."""
    __tablename__ = "lead_sources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    lead_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)  # soft FK to conversations

    # Source attribution
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)    # organic | paid_ad | story_reply | reel | post | lead_form | referral
    campaign_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    campaign_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ad_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ad_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ad_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    post_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reel_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    story_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    referral_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Conversion tracking
    converted_to_booking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revenue_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
