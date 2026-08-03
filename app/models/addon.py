"""
Add-ons — Generic Plans Engine step 6. An add-on is a standalone, priced
entity (not tied to one plan) that grants extra modules/permissions and/or
extra quota on top of whatever a studio's plan already includes. Add-ons
only ever ADD — see app/core/features.py's is_module_enabled()/
effective_quota() for the precedence policy against plan defaults and
per-studio overrides (StudioModule.is_locked).
"""
from __future__ import annotations
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Addon(Base):
    """The add-on definition itself — independent of any plan. Same
    lifecycle shape as Plan (app/models/module.py): is_visible/is_purchasable/
    is_active, admin CRUD via app/api/superadmin_routes.py."""
    __tablename__ = "addons"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price_cents: Mapped[int] = mapped_column(nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="ILS")
    billing_type: Mapped[str] = mapped_column(String(16), nullable=False, default="monthly")
    # one_time | monthly | yearly
    # True = available to every plan without a plan_addons row; False =
    # availability is whatever plan_addons lists for this addon_id.
    applies_to_all_plans: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_purchasable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PlanAddon(Base):
    """Which plans an add-on is offered on (ignored when
    Addon.applies_to_all_plans is true)."""
    __tablename__ = "plan_addons"

    plan_id: Mapped[str] = mapped_column(String(32), ForeignKey("plans.id", ondelete="CASCADE"), primary_key=True)
    addon_id: Mapped[str] = mapped_column(String(32), ForeignKey("addons.id", ondelete="CASCADE"), primary_key=True)


class AddonModule(Base):
    """
    What an add-on grants. A row's mere existence grants module_id (turns it
    on even if the base plan doesn't include it — resolved through the exact
    same modules/parent_module_id tree as plans, so any future Feature that
    registers itself as a modules row — AI, integrations, workflows,
    widgets, automations — becomes grantable by an add-on with zero schema
    change). limit_delta, if set, additionally adds that many units to
    module_id's quota — never an absolute/replacing value.
    """
    __tablename__ = "addon_modules"

    addon_id: Mapped[str] = mapped_column(String(32), ForeignKey("addons.id", ondelete="CASCADE"), primary_key=True)
    module_id: Mapped[str] = mapped_column(String(64), ForeignKey("modules.id", ondelete="CASCADE"), primary_key=True)
    limit_delta: Mapped[int | None] = mapped_column(nullable=True)


class StudioAddon(Base):
    """
    An add-on active for a specific studio. Deliberately NOT unique on
    (studio_id, addon_id) — the resolution engine already sums limit_delta
    across every active row for a studio, so allowing multiple rows per
    addon later (repeat/stacked purchases) needs no schema or engine change;
    step 6's own UI is what currently limits a studio to one active
    instance per add-on, as a product decision, not a data constraint.
    """
    __tablename__ = "studio_addons"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    addon_id: Mapped[str] = mapped_column(String(32), ForeignKey("addons.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # active | canceled | expired
    # Who created this row — distinguishes a Super Admin manual assignment
    # from a future self-service purchase without needing a different table
    # or a different resolution path (see project_generic_plans_engine memory).
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="admin_assigned")
    # admin_assigned | self_service
    purchased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # NULL for one_time
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    price_cents_at_purchase: Mapped[int] = mapped_column(nullable=False, default=0)
