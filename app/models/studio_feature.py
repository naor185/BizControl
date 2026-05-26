from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


FEATURES = frozenset([
    "meta_inbox",
    "whatsapp_cloud",
    "marketing_analytics",
    "ai_insights",
    "ai_auto_tag",
    "lead_attribution",
    "realtime_inbox",
    "quick_replies",
])


class StudioFeature(Base):
    __tablename__ = "studio_features"
    __table_args__ = (UniqueConstraint("studio_id", "feature", name="uq_studio_feature"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    feature: Mapped[str] = mapped_column(String(64), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    enabled_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
