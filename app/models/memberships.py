"""
Memberships for group classes — what a business sells (membership types), what a client bought
(memberships), the entry log of a punch card, the owner's late-cancel / no-show rules, and the fees
those rules record (as a debt, not collected).

- A membership type is one of: unlimited for a period, a weekly limit for a period, or a punch card
  (a number of entries, valid up to a number of days). It covers every class or chosen classes.
- A membership keeps a copy of its type's rules from the moment it was sold (rules) — editing the
  type later does not change memberships already sold.
- The entry log (membership_entry_ledger) is append-only and makes a double deduction impossible: a
  booking has at most one reserve and one close (unique booking_id + stage). The close does not take
  another entry — it decides whether the reserved one is consumed or returned; a later change of that
  decision is a correction (adjust ±1), written only when the booking's entry state really changes.
  The balance is derived from the log (app/services/memberships.balance).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

KINDS = ("unlimited", "weekly", "punch")
STATUSES = ("pending", "active", "frozen", "ending", "expired", "canceled")


class MembershipType(Base):
    __tablename__ = "membership_types"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)                 # unlimited | weekly | punch
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")   # for the record
    duration_days: Mapped[int | None] = mapped_column(Integer, nullable=True)     # validity; empty = no end (punch only)
    entries: Mapped[int | None] = mapped_column(Integer, nullable=True)           # punch: entries; weekly: per week
    covers_all: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    covered_templates: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default="{}")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")   # on sale
    # freezing (stage 5): allowed at all; most days in the membership's period, shortest single freeze,
    # most freezes (empty = no limit); a fee recorded on the membership, never collected
    freeze_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    freeze_max_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    freeze_min_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    freeze_max_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    freeze_fee_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # a family / shared membership (app/services/membership_family.py) — every choice the owner's; the defaults
    # keep a personal membership (one person) exactly as before
    max_members: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1, server_default="1")   # empty = no limit
    entries_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="shared", server_default="shared")   # shared | each | shared_capped
    member_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)            # shared_capped: each person at most
    pricing: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed", server_default="fixed")   # fixed | per_member | first_plus_extra | first_plus_discount
    extra_member_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")    # first_plus_extra
    extra_member_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")  # first_plus_discount
    booking_by: Mapped[str] = mapped_column(String(10), nullable=False, default="each", server_default="each")   # each | holder
    members_change: Mapped[str] = mapped_column(String(10), nullable=False, default="free", server_default="free")   # free | priced | locked
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user", server_default="user")
    source_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class Membership(Base):
    __tablename__ = "memberships"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    type_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("membership_types.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    rules: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)       # the type's rules when sold
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    renewal_expected_on: Mapped[date | None] = mapped_column(Date, nullable=True)  # for automatic renewal, later
    # the current (or coming) freeze: frozen from freeze_from, back on freeze_until
    freeze_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    freeze_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user", server_default="user")
    source_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class MembershipEvent(Base):
    """Every change to a membership: sold, frozen, back from a freeze, stopped, stop undone, cancelled,
    started, ended — who, when, from which status to which, from which date, how many days, why."""
    __tablename__ = "membership_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    membership_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    effective_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fee_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    by_user: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user", server_default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MembershipEntry(Base):
    """One line of a punch card's entry log. stage: opening (+N) | adjust (±N, a correction) |
    reserve (a booking holds one) | close (that booking's entry: consume or return)."""
    __tablename__ = "membership_entry_ledger"
    # a booking has at most one reserve and one close; corrections (adjust) may follow a later change
    __table_args__ = (Index("uq_membership_entry_booking_stage", "booking_id", "stage", unique=True,
                            postgresql_where=text("booking_id IS NOT NULL AND stage IN ('reserve', 'close')")),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    membership_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False, index=True)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("class_bookings.id", ondelete="SET NULL"), nullable=True)
    stage: Mapped[str] = mapped_column(String(10), nullable=False)
    outcome: Mapped[str | None] = mapped_column(String(10), nullable=True)        # close: consume | return
    amount: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reason: Mapped[str | None] = mapped_column(String(160), nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user", server_default="user")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class PenaltyRule(Base):
    """One of the owner's rules for a late cancellation or a no-show: from the Nth time within X days,
    do this. Rules live at a level — the business, a class template, a membership type — and the most
    specific level that has rules for the event wins (as with app/services/policies)."""
    __tablename__ = "booking_policy_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)           # studio | class_template | membership_type
    scope_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    event: Mapped[str] = mapped_column(String(16), nullable=False)                # late_cancel | no_show
    from_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    within_days: Mapped[int | None] = mapped_column(Integer, nullable=True)       # empty = ever
    action: Mapped[str] = mapped_column(String(10), nullable=False)               # nothing | warn | consume | fixed | percent | full
    amount_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)      # fixed
    percent: Mapped[int | None] = mapped_column(Integer, nullable=True)           # percent
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ClassFee(Base):
    """A fee a rule recorded on a client — a debt, until paid or waived. One per booking."""
    __tablename__ = "class_fees"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("class_bookings.id", ondelete="CASCADE"), nullable=False, unique=True)
    rule_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("booking_policy_rules.id", ondelete="SET NULL"), nullable=True)
    event: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending", server_default="pending")   # pending | paid | waived
    waived_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    waived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    waive_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MembershipRequest(Base):
    """A client's request from BizFind about their membership — a freeze, from a date to a return date, and why
    (app/services/membership_requests.py). pending → approved (the freeze is made, by the owner or — the
    owner's choice — by itself when it is inside the membership's rules) / rejected (with the business's
    reason) / withdrawn by the client. One pending request per membership."""
    __tablename__ = "membership_requests"
    __table_args__ = (Index("uq_membership_request_pending", "membership_id", unique=True,
                            postgresql_where=text("status = 'pending'")),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    membership_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="freeze", server_default="freeze")
    from_on: Mapped[date] = mapped_column(Date, nullable=False)
    until_on: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MembershipMember(Base):
    """Another person on a family / shared membership — besides its holder (memberships.client_id), who is always
    on it. Removed = removed_at (the history stays). One active row per person and membership."""
    __tablename__ = "membership_members"
    __table_args__ = (Index("uq_membership_member_active", "membership_id", "client_id", unique=True,
                            postgresql_where=text("removed_at IS NULL")),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    membership_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    added_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
