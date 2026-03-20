from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, CheckConstraint, func, Numeric, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('scheduled','done','canceled','no_show')",
            name="ck_appointments_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False, index=True)

    # מקעקע (User) – נדרש בשביל יומן בצבעים לפי מקעקע
    artist_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(160), nullable=False, default="Tattoo Session")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    total_price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    deposit_amount_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    automation_enqueued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    
    payment_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payment_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    
    google_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    client = relationship("Client")
    artist = relationship("User")  # חשוב: artist_id פה לא nullable כי אתה ביקשת יומן פר סטודיו עם מקעקעים וצבעים — אז לכל תור יש מקעקע.
