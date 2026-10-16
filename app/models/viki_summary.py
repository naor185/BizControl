from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VikiSummary(Base):
    """ויקי's summary of a week or a month for a business (services/viki_summary): what went well, what to improve, the
    goal ahead — and the numbers it was made from. One per business and period."""
    __tablename__ = "viki_summaries"
    __table_args__ = (UniqueConstraint("studio_id", "kind", "period", name="uq_viki_summaries_period"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)          # weekly | monthly
    period: Mapped[str] = mapped_column(String(16), nullable=False)        # the week's Sunday "2026-10-11" / "2026-10"
    good: Mapped[str] = mapped_column(Text, nullable=False, default="[]")      # JSON list of lines
    improve: Mapped[str] = mapped_column(Text, nullable=False, default="[]")   # JSON list of lines
    focus: Mapped[str] = mapped_column(Text, nullable=False, default="")
    facts: Mapped[str] = mapped_column(Text, nullable=False, default="{}")     # JSON — the numbers it was made from
    by_ai: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
