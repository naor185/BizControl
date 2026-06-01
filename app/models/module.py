"""
Module system — Phase 0 modular platform architecture.

Three tables:
  modules               — registry of all available modules
  studio_modules        — per-studio overrides (ON/OFF), overrides plan defaults
  plan_modules          — which modules each subscription plan includes by default
  business_type_templates — default module list + service templates per business type
"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Module(Base):
    __tablename__ = "modules"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)          # e.g. "crm", "ocr"
    name: Mapped[str] = mapped_column(String(128), nullable=False)          # "CRM & לקוחות"
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="core")
    # categories: core | communication | ai | marketplace | finance | advanced
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StudioModule(Base):
    """Explicit per-studio module override. Overrides plan defaults."""
    __tablename__ = "studio_modules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    module_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("modules.id", ondelete="CASCADE"), nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    enabled_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        __import__("sqlalchemy").UniqueConstraint("studio_id", "module_id", name="uq_studio_module"),
    )


class PlanModule(Base):
    """Defines which modules are included in each subscription plan by default."""
    __tablename__ = "plan_modules"

    plan: Mapped[str] = mapped_column(String(32), nullable=False, primary_key=True)
    module_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("modules.id", ondelete="CASCADE"),
        nullable=False, primary_key=True
    )


class BusinessTypeTemplate(Base):
    """Default configuration (modules + sample services) per business type."""
    __tablename__ = "business_type_templates"

    business_type: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    default_modules: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    default_services: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    # default_services: [{name, duration_minutes, price, color}]
