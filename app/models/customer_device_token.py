from __future__ import annotations
import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class CustomerDeviceToken(Base):
    """Push device tokens for BizFind's own marketplace_customers — separate
    from DeviceToken (app/models/device_token.py), which is for BizControl's
    studio users (owner/staff). A BizFind customer's device isn't tied to any
    one studio; it receives notifications about every studio they interact
    with, same as any other app."""
    __tablename__ = "customer_device_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # marketplace_customers has no SQLAlchemy ORM model in this codebase (accessed
    # only via raw SQL) — no ForeignKey() here, or mapper configuration fails with
    # NoReferencedTableError. The real FK constraint lives in the raw SQL migration
    # in start.py; Postgres enforces it regardless of what the ORM knows about it.
    customer_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    token: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)  # ios | android
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
