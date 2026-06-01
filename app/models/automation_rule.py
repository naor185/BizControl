"""
Automation Rule Engine — Phase 2.

Each rule: WHEN <trigger_event> [IF conditions] THEN [actions...]

Trigger events:
  appointment_done       — appointment marked as done
  appointment_created    — new appointment booked (after confirmation)
  appointment_canceled   — appointment canceled
  payment_received       — final payment (type=payment) marked paid
  deposit_paid           — deposit payment marked paid
  client_birthday        — client's birthday (runs daily at 09:00)
  client_joined_club     — client enrolled in loyalty program

Action types:
  send_whatsapp          — sends WhatsApp message via queue
  send_email             — sends email via queue
  add_points             — adds loyalty points to client
  generate_coupon        — generates a coupon code and sends it
  request_review         — sends review links (google/instagram/etc)
  send_aftercare         — sends aftercare instructions template
"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, String, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


# ── Trigger events ────────────────────────────────────────────────────────────
TRIGGER_EVENTS = [
    "appointment_done",
    "appointment_created",
    "appointment_canceled",
    "payment_received",
    "deposit_paid",
    "client_birthday",
    "client_joined_club",
]

# ── Action types ──────────────────────────────────────────────────────────────
ACTION_TYPES = [
    "send_whatsapp",
    "send_email",
    "add_points",
    "generate_coupon",
    "request_review",
    "send_aftercare",
]


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # WHEN
    trigger_event: Mapped[str] = mapped_column(String(64), nullable=False)
    # Optional conditions: {"service_id": "...", "category": "..."}
    trigger_conditions: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    # THEN — ordered list of actions
    # e.g. [{"type": "send_whatsapp", "template": "...", "delay_minutes": 0},
    #        {"type": "add_points", "amount": 50},
    #        {"type": "request_review"}]
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)

    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AutomationExecution(Base):
    """Log of automation rule executions for debugging."""
    __tablename__ = "automation_executions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("automation_rules.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    trigger_event: Mapped[str] = mapped_column(String(64), nullable=False)
    context_data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")  # ok / error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
