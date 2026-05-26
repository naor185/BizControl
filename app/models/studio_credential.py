from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class StudioCredential(Base):
    __tablename__ = "studio_credentials"
    __table_args__ = (UniqueConstraint("studio_id", "platform", "key_name", name="uq_studio_credential"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    key_name: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_value: Mapped[str] = mapped_column(Text, nullable=False)
    injected_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    injected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
