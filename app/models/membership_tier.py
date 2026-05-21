from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class MembershipTier(Base):
    __tablename__ = "membership_tiers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#C0C0C0")
    icon: Mapped[str] = mapped_column(String(10), nullable=False, default="⭐")
    rank_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Threshold — client must meet this to qualify
    threshold_type: Mapped[str] = mapped_column(String(30), nullable=False, default="visits")  # visits | spend_ils | points_earned
    threshold_value: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Benefits
    points_multiplier: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)  # e.g. 1.5 = 50% more cashback
    birthday_gift_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=10)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
