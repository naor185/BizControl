from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, CheckConstraint, func, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("type IN ('deposit','payment','refund')", name="ck_payments_type"),
        CheckConstraint("status IN ('pending','paid','void')", name="ck_payments_status"),
        CheckConstraint(
            "method IN ('cash','bit','credit','paypal','bank','paybox','installment','other')",
            name="ck_payments_method",
        ),
        CheckConstraint("amount_cents >= 0", name="ck_payments_amount_nonneg"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    appointment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False, index=True)

    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="ILS")

    type: Mapped[str] = mapped_column(String(16), nullable=False)       # deposit/payment/refund
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="paid")  # pending/paid/void
    method: Mapped[str] = mapped_column(String(16), nullable=False, default="cash") # cash/bit/credit/...

    external_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    appointment = relationship("Appointment")
    client = relationship("Client")
