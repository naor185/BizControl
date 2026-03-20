from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import String, Boolean, Date, DateTime, Integer, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), index=True, nullable=False)

    full_name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True, index=True)

    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    loyalty_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    marketing_consent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    is_club_member: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    cancellation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    no_show_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_walk_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
