"""A link to pay, sent to a client on WhatsApp (the owner, 2026-10-24: "the card terminal isn't connected — send the
client a link"): from the till (the cart's items) or from an appointment (what is left to pay). The client opens
/pay/r/<id>, pays with the business's Bit / PayBox / bank transfer and taps "שילמתי" (with a picture if they like); the
business approves and the sale is recorded — in the till, or as the appointment's payment — with its receipt.
services/payment_requests."""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PaymentRequest(Base):
    __tablename__ = "payment_requests"
    __table_args__ = (
        CheckConstraint("status IN ('waiting','reported','paid','canceled')", name="ck_payment_requests_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    # from an appointment: what is left to pay for it; from the till: the cart's items
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True)
    items: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    discount_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    performer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    status: Mapped[str] = mapped_column(String(10), nullable=False, default="waiting", server_default="'waiting'")
    reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    client_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    proof_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pos_transaction_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
