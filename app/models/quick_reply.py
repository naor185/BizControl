from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class QuickReply(Base):
    __tablename__ = "quick_replies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(100), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    shortcut: Mapped[str | None] = mapped_column(String(30), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
