from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class StaffReminderRule(Base):
    """A studio-configured push-reminder rule: 'notify staff N minutes before
    an appointment/task starts'. Unlike the fixed customer-facing reminder
    set (1day/3day/7day/same_day), the studio admin can add as many of these
    as they want with arbitrary lead times — lead_minutes has no fixed enum
    on purpose."""
    __tablename__ = "staff_reminder_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)

    applies_to: Mapped[str] = mapped_column(String(20), nullable=False, default="both", server_default="both")  # appointment | task | both
    lead_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
