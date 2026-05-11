from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    Numeric,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from decimal import Decimal

from app.models.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("studio_id", "email", name="uq_users_studio_email"),
        CheckConstraint("role IN ('owner','admin','artist','staff','superadmin')", name="ck_users_role"),
        CheckConstraint("pay_type IN ('hourly','commission','none')", name="ck_users_pay_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False)

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)

    role: Mapped[str] = mapped_column(String(16), nullable=False)  # owner / admin / artist / staff
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    calendar_color: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Payroll fields
    pay_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="none") # hourly / commission / none
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, server_default="0.00")
    commission_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, server_default="0.00")

    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    studio: Mapped["Studio"] = relationship(back_populates="users")
    work_sessions: Mapped[list["WorkSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
