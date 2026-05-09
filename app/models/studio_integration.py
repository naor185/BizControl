from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class StudioIntegration(Base):
    __tablename__ = "studio_integrations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # platform: whatsapp | instagram | facebook | lead_ads
    platform: Mapped[str] = mapped_column(String(32), nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # None = permanent access
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Credentials stored per-integration (for platforms that need them)
    phone_number_id: Mapped[str | None] = mapped_column(String(255), nullable=True)   # WhatsApp
    access_token: Mapped[str | None] = mapped_column(String(1024), nullable=True)     # WhatsApp / Meta
    page_id: Mapped[str | None] = mapped_column(String(128), nullable=True)           # Facebook
    instagram_account_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
