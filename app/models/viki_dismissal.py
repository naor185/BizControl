from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VikiDismissal(Base):
    """A suggestion of ויקי's a user has answered — "עשיתי" (done) or "לא רלוונטי" (not_relevant) — so it doesn't come
    back to them. Its key carries its period (a month, a week, a day), so the same kind of suggestion can come back
    when it's true again later (services/viki)."""
    __tablename__ = "viki_dismissals"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_viki_dismissals_user_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)        # done | not_relevant
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
