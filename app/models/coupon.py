"""
A business's own coupons — a code the owner writes (SUMMER10), a discount percent, a category and a source (where it
was handed out: Instagram, a flyer, an influencer…), how many times it can be used, until when. Every use is one
CouponUse row: the price before, the discount and who paid — the report adds them up. A birthday coupon
(birthday_coupon.py, one per client, made by the system) is used through the same code field and its uses are
recorded here too. app/services/coupons.py does the work.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint,
                        func)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Coupon(Base):
    __tablename__ = "coupons"
    __table_args__ = (
        UniqueConstraint("studio_id", "code", name="uq_coupons_studio_code"),
        CheckConstraint("discount_percent BETWEEN 1 AND 100", name="ck_coupons_percent"),
        CheckConstraint("max_uses IS NULL OR max_uses > 0", name="ck_coupons_max_uses"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    discount_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    source: Mapped[str | None] = mapped_column(String(60), nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)                 # None = no limit
    once_per_client: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)                 # the last day it works
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    link_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CouponUse(Base):
    __tablename__ = "coupon_uses"
    __table_args__ = (
        CheckConstraint("coupon_id IS NOT NULL OR birthday_coupon_id IS NOT NULL", name="ck_coupon_uses_coupon"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    coupon_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("coupons.id", ondelete="CASCADE"), nullable=True, index=True)
    birthday_coupon_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("birthday_coupons.id", ondelete="CASCADE"), nullable=True, index=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    # what it was used on — a payment (an appointment) or a till sale; deleting that removes the use
    payment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("payments.id", ondelete="CASCADE"), nullable=True, index=True)
    pos_transaction_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("pos_transactions.id", ondelete="CASCADE"), nullable=True, index=True)
    before_cents: Mapped[int] = mapped_column(Integer, nullable=False)                  # the price the percent was taken from
    discount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    used_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
