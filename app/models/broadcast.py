from __future__ import annotations
from uuid import uuid4
from sqlalchemy import Column, String, Text, Integer, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    studio_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)

    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    # all | club | non_club
    audience = Column(String(50), nullable=False, default="all")

    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(30), nullable=False, default="scheduled")
    # scheduled → processing → sent / canceled

    media_url = Column(Text, nullable=True)

    recipient_count = Column(Integer, default=0)
    sent_count = Column(Integer, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
