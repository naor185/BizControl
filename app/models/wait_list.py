from __future__ import annotations
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WaitListEntry(Base):
    """The waitlist — for an appointment (a service, session_id empty) or for a full group class
    (session_id set, stage 6: app/services/class_waitlist.py). Every appointment-waitlist query keeps
    session_id IS NULL, so the two never mix."""
    __tablename__ = "wait_list"
    # a client waits once per class
    __table_args__ = (Index("uq_wait_list_class_client", "session_id", "client_id", unique=True,
                            postgresql_where=text("session_id IS NOT NULL AND status IN ('waiting', 'notified')")),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    client_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # For non-registered clients
    client_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    client_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)

    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("services.id", ondelete="SET NULL"), nullable=True
    )
    preferred_artist_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status: waiting → notified → confirmed / canceled / expired
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="waiting", index=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # a group class's waitlist: the class, the place in line (the staff can move it), until when an
    # offered spot is held (status notified), and the booking it became (status confirmed)
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("class_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    offer_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("class_bookings.id", ondelete="SET NULL"), nullable=True)
