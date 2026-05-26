from __future__ import annotations
import uuid
from datetime import date, datetime
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class AdInsight(Base):
    __tablename__ = "ad_insights"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)

    date_start: Mapped[date] = mapped_column(Date, nullable=False)
    date_stop: Mapped[date] = mapped_column(Date, nullable=False)

    campaign_id: Mapped[str] = mapped_column(String(64), nullable=False)
    campaign_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    ad_set_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ad_set_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ad_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ad_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    impressions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reach: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    spend_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    leads: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    link_clicks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
