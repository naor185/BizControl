from __future__ import annotations

import uuid
from datetime import datetime, date

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class FinancialObligation(Base):
    __tablename__ = "financial_obligations"
    __table_args__ = (
        CheckConstraint("direction IN ('incoming','outgoing')", name="ck_obligation_direction"),
        CheckConstraint("status IN ('active','paused','completed')", name="ck_obligation_status"),
        CheckConstraint("day_of_month BETWEEN 1 AND 28", name="ck_obligation_day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    counterparty: Mapped[str | None] = mapped_column(String(200), nullable=True)  # שם הצד השני
    direction: Mapped[str] = mapped_column(String(10), nullable=False)  # incoming | outgoing
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    total_amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    monthly_payment_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    day_of_month: Mapped[int] = mapped_column(Integer, nullable=False)  # 1–28
    start_date: Mapped[date] = mapped_column(Date, nullable=False)

    months_paid: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    amount_paid_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # FK to the auto-created recurring task in the calendar
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)

    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active", server_default="'active'")
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#f97316", server_default="'#f97316'")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
