"""
Lucky Club — a raffle among the business's own clients (the owner, 2026-11-04; module lucky_club, under the club).
The clients are the existing ones (clients table) — nothing here copies them, except what a locked draw has to keep:
who took part as they were at that moment (name, phone, club membership), so the draw can be checked later even after
a client changed. app/services/lucky_draw.py does the work.

draft → locked → done (or canceled): a draft is the owner's to change; locking writes the participants down; running
picks the winners once, on the server. A done draw's winners never change — only a prize's "redeemed" mark.

A prize (the owner, 2026-11-04) is a gift (its words), points into the club card, or a percent off — a personal code
the till and the payment screen take (services/coupons) — each with days to use it in, after which it expires.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LuckyDraw(Base):
    __tablename__ = "lucky_draws"
    __table_args__ = (
        CheckConstraint("audience IN ('club','regular','all','manual')", name="ck_lucky_draws_audience"),
        CheckConstraint("status IN ('draft','locked','done','canceled')", name="ck_lucky_draws_status"),
        CheckConstraint("winners_count BETWEEN 1 AND 10", name="ck_lucky_draws_winners"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    terms: Mapped[str | None] = mapped_column(Text, nullable=True)                       # the business's own rules text
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # who takes part: club members, clients who aren't, everyone, or chosen by hand (manual_client_ids)
    audience: Mapped[str] = mapped_column(String(10), nullable=False, default="club", server_default="club")
    manual_client_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    winners_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="draft", server_default="draft")
    participants_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    drawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    drawn_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    canceled_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    # a done draw deleted from the history stays behind it — its winners keep their prizes until they expire
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LuckyDrawPrize(Base):
    """The prize for one place (1st, 2nd, 3rd)."""
    __tablename__ = "lucky_draw_prizes"
    __table_args__ = (
        UniqueConstraint("draw_id", "place", name="uq_lucky_draw_prizes_place"),
        CheckConstraint("kind IN ('gift','points','percent')", name="ck_lucky_draw_prizes_kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    draw_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lucky_draws.id", ondelete="CASCADE"), nullable=False, index=True)
    place: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="gift", server_default="gift")
    value: Mapped[int | None] = mapped_column(Integer, nullable=True)            # the points, or the percent off
    valid_days: Mapped[int | None] = mapped_column(Integer, nullable=True)       # days to use it, from the draw; None = no end


class LuckyDrawParticipant(Base):
    """One client in a locked draw, as they were when it was locked."""
    __tablename__ = "lucky_draw_participants"
    __table_args__ = (UniqueConstraint("draw_id", "client_id", name="uq_lucky_draw_participants_client"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    draw_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lucky_draws.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    was_club_member: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class LuckyDrawWinner(Base):
    """A winner — one per place, never twice in a draw — and their prize (its title kept as it was)."""
    __tablename__ = "lucky_draw_winners"
    __table_args__ = (
        UniqueConstraint("draw_id", "place", name="uq_lucky_draw_winners_place"),
        UniqueConstraint("draw_id", "participant_id", name="uq_lucky_draw_winners_participant"),
        CheckConstraint("status IN ('pending','redeemed','expired')", name="ck_lucky_draw_winners_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    draw_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lucky_draws.id", ondelete="CASCADE"), nullable=False, index=True)
    place: Mapped[int] = mapped_column(Integer, nullable=False)
    participant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("lucky_draw_participants.id", ondelete="CASCADE"), nullable=False)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    prize_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("lucky_draw_prizes.id", ondelete="SET NULL"), nullable=True)
    prize_title: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending", server_default="pending")
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    redeemed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # the prize as it was given (the owner may change the next draw's prizes, never this one's)
    prize_kind: Mapped[str] = mapped_column(String(10), nullable=False, default="gift", server_default="gift")
    prize_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)          # the last day to use it
    code: Mapped[str | None] = mapped_column(String(32), nullable=True)            # a percent prize's personal code
    points_expired: Mapped[int | None] = mapped_column(Integer, nullable=True)     # points taken back, unused, at the end
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)   # the WhatsApp to the winner
