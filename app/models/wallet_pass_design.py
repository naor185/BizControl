from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WalletPassDesign(Base):
    __tablename__ = "wallet_pass_designs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # One design per studio
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Colors
    background_color: Mapped[str] = mapped_column(String(32), nullable=False, default="#1a1a2e", server_default="#1a1a2e")
    text_color: Mapped[str] = mapped_column(String(32), nullable=False, default="#ffffff", server_default="#ffffff")
    strip_color: Mapped[str] = mapped_column(String(32), nullable=False, default="#6366f1", server_default="#6366f1")
    label_color: Mapped[str] = mapped_column(String(32), nullable=False, default="#a5b4fc", server_default="#a5b4fc")

    # Images (stored as URLs from existing upload system)
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Fields visibility
    show_points: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    show_tier: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    show_barcode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    # Display name on card (defaults to studio name)
    card_title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    card_description: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
