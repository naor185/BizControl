"""
Subscription state — Generic Plans Engine step 4.

The single source of truth for "what is this studio's subscription doing
right now." Studio.subscription_plan/is_active/plan_expires_at/
stripe_customer_id/stripe_subscription_id predate this and are left in
place (deprecated, unread by new code) per the project's deprecate-before-
delete pattern — see app/core/billing.py for the only functions allowed to
read/write these tables.
"""
from __future__ import annotations
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Subscription(Base):
    """1:1 with Studio (like StudioSettings). status is the source of truth
    for access control — never inferred from a payment provider directly."""
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"),
        nullable=False, unique=True
    )
    plan_id: Mapped[str] = mapped_column(String(32), ForeignKey("plans.id"), nullable=False)
    # trial | active | past_due | grace_period | suspended | canceled | expired
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="trial")

    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auto_renew: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Payment-provider abstraction — nothing outside app/core/billing.py's
    # provider implementations should read these directly.
    payment_provider: Mapped[str] = mapped_column(String(20), nullable=False, default="stripe")
    provider_customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SubscriptionEvent(Base):
    """Append-only audit trail of every subscription state change — how a
    studio got to its current status, not just what the status is now."""
    __tablename__ = "subscription_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subscriptions.id", ondelete="SET NULL"), nullable=True
    )
    # trial_started | activated | renewed | upgraded | downgraded | payment_failed |
    # grace_period_started | suspended | canceled | reactivated | expired |
    # refunded | addon_purchased | overage_recorded
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    from_plan: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_plan: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # webhook | admin | system (cron) | customer
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_event_id: Mapped[str | None] = mapped_column(String(128), nullable=True)  # dedup, e.g. Stripe event id
    # Python attr avoids colliding with SQLAlchemy's reserved Base.metadata;
    # DB column is still named "metadata" per the approved plan's schema.
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
