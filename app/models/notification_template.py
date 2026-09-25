from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class NotificationTemplate(Base):
    """A business's own choice for one class/membership notification and channel: on or off, and its
    wording. No row = the defaults of the event catalog (app/services/notifications.EVENTS)."""
    __tablename__ = "notification_templates"
    __table_args__ = (UniqueConstraint("studio_id", "event", "channel", name="uq_notification_template"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"),
                                                 nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)          # whatsapp | email | bell
    enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)     # None = the event's default
    body: Mapped[str | None] = mapped_column(Text, nullable=True)            # None = the event's default text
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                 server_default=func.now(), onupdate=func.now())
