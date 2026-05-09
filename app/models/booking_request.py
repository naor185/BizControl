from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class BookingRequest(Base):
    __tablename__ = "booking_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    artist_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    # Client info (not necessarily a registered client yet)
    client_name: Mapped[str] = mapped_column(String(160), nullable=False)
    client_phone: Mapped[str] = mapped_column(String(32), nullable=False)
    client_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    service_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Requested time slot
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Status: pending / approved / rejected
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Who reviewed it
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Linked appointment (set when approved)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    artist = relationship("User", foreign_keys=[artist_id])
