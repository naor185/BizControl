from __future__ import annotations

import uuid
from datetime import datetime, date

from sqlalchemy import DateTime, Date, ForeignKey, String, Text, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    task_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_time: Mapped[str | None] = mapped_column(String(5), nullable=True)   # HH:MM
    end_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#8b5cf6", server_default="#8b5cf6")

    # none | monthly | yearly
    recurrence_type: Mapped[str] = mapped_column(String(20), nullable=False, default="none", server_default="none")
    recurrence_day: Mapped[int | None] = mapped_column(Integer, nullable=True)    # 1–31
    recurrence_month: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1–12 (yearly only)
    recurrence_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
