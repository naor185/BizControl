"""
The health declaration (owner, 2026-10-10): the business writes its form — text and questions — and/or attaches a
file of its own; a client fills it and signs with a finger (on the studio's iPad/iPhone, or from a link on WhatsApp)
and the one giving the service signs after. A signed declaration keeps its own copy of the form as it was signed, so
editing the form later never changes what someone signed. Medical information: kept in the database, shown only to
the business's staff and to the client through the link's token — never at an open address.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class HealthFormFile(Base):
    """A file the business attached to its form (PDF or image). Never deleted — a signed declaration points to the
    file it was signed with."""
    __tablename__ = "health_form_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    content_type: Mapped[str] = mapped_column(String(80), nullable=False)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class HealthForm(Base):
    """The business's form — one per business. Questions: [{id, text, kind: 'yes_no' | 'text'}]."""
    __tablename__ = "health_forms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    intro: Mapped[str] = mapped_column(Text, nullable=False, default="")
    questions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    closing: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ask_id_number: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    file_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("health_form_files.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class HealthDeclaration(Base):
    """One client's declaration — for an appointment, or from the client's file.
    status: waiting_client (not filled yet) → waiting_performer (the client signed) → signed."""
    __tablename__ = "health_declarations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="waiting_client")

    # the form as it was when this declaration was opened
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    intro: Mapped[str] = mapped_column(Text, nullable=False, default="")
    questions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    closing: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ask_id_number: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    file_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("health_form_files.id"), nullable=True)

    # the client's part: {question_id: {"answer": "yes" | "no", "details": str} | {"text": str}}
    answers: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    id_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    client_signature: Mapped[str | None] = mapped_column(Text, nullable=True)        # PNG data URL
    client_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    client_signed_via: Mapped[str | None] = mapped_column(String(10), nullable=True)  # studio | link
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_device: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # the one giving the service
    performer_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    performer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    performer_signature: Mapped[str | None] = mapped_column(Text, nullable=True)
    performer_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # the link the client fills it from (stage 2)
    token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    link_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
