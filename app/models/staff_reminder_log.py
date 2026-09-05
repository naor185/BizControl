from __future__ import annotations
import uuid
from datetime import date, datetime
from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class StaffReminderSentLog(Base):
    """Dedup record: one row per (rule, target, occurrence) that's already
    been pushed, so the sweep never double-sends. occurrence_date matters
    for recurring tasks — the same task row is reused for every occurrence
    (see app/api/task_routes.py's _expand_tasks), so target_id alone isn't
    enough to tell "already reminded for today's occurrence" apart from
    "already reminded, ever" — that would silently kill reminders for every
    occurrence after the first."""
    __tablename__ = "staff_reminder_sent_log"
    __table_args__ = (
        UniqueConstraint("rule_id", "target_type", "target_id", "occurrence_date", name="uq_staff_reminder_sent"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("staff_reminder_rules.id", ondelete="CASCADE"), nullable=False, index=True)

    target_type: Mapped[str] = mapped_column(String(20), nullable=False)  # appointment | task
    # No ForeignKey() — target_id points at appointments.id or tasks.id depending
    # on target_type, and SQLAlchemy can't conditionally FK a single column.
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    occurrence_date: Mapped[date] = mapped_column(Date, nullable=False)

    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
