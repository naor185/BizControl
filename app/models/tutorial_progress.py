from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TutorialProgress(Base):
    """Where a user is in a guided tour (api/tutorial_routes) — kept on the server so the phone, the computer and the
    app agree. Whether each step was really done is checked live elsewhere (the setup checklist); this keeps only
    the tour's own state: running, closed by the user, or finished — and the steps the user chose to skip."""
    __tablename__ = "tutorial_progress"
    __table_args__ = (UniqueConstraint("user_id", "tour_id", name="uq_tutorial_progress_user_tour"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    tour_id: Mapped[str] = mapped_column(String(40), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="active")   # active | dismissed | done
    skipped: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")   # JSON list of step ids
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
