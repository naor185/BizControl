"""
Universal Migration Engine — the tables every import goes through, whatever the source.

A Migration is one import session (one source, one studio). Its rows are first staged in
migration_rows (raw → normalized → matched), shown to the user as a preview, and only written
into BizControl's own tables after the user confirms. external_records links every imported
record to its (source, external_id), which is what makes re-imports idempotent and rollback
possible. See app/migration/engine.py for the flow.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# draft → scanning → preview → importing → completed | partial | failed; completed/partial → rolled_back
MIGRATION_STATUSES = ("draft", "scanning", "preview", "importing", "completed", "partial", "failed", "rolled_back")


class Migration(Base):
    __tablename__ = "migrations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)          # MIG-2026-00042
    source: Mapped[str] = mapped_column(String(32), nullable=False)                     # connector slug
    connector_version: Mapped[str] = mapped_column(String(16), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(24), nullable=False)                # clients | services
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # columns, mapping, options, dropped (sensitive) columns — everything the user chose
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # final summary, frozen when the import ends (the live numbers are counted from migration_rows)
    summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    raw_purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class MigrationRow(Base):
    """One source record in staging. raw is what the source sent (sensitive columns already
    dropped), data is the normalized universal record, and the rest records what happened to it."""
    __tablename__ = "migration_rows"
    __table_args__ = (UniqueConstraint("migration_id", "row_number", name="uq_migration_row"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    migration_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("migrations.id", ondelete="CASCADE"), nullable=False, index=True)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    raw: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    issues: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    phone_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email_key: Mapped[str | None] = mapped_column(String(254), nullable=True)
    name_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    scanned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # new | existing | possible_duplicate | conflict | invalid
    match_status: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    match_target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    match_reason: Mapped[str | None] = mapped_column(String(48), nullable=True)
    # create | merge | skip
    decision: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # pending | imported | skipped | failed | rolled_back | kept
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending", index=True)
    # created | updated | unchanged
    action: Mapped[str | None] = mapped_column(String(10), nullable=True)
    local_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # created: the values written; updated: {field: {"before": .., "after": ..}} — what rollback checks and restores
    applied: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    link_created: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ExternalRecord(Base):
    """(studio, source, entity, external_id) → the BizControl record it became. One per external
    record, whichever migration touched it last."""
    __tablename__ = "external_records"
    __table_args__ = (UniqueConstraint("studio_id", "source", "entity_type", "external_id", name="uq_external_record"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(24), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    local_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    migration_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("migrations.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_migration: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class MigrationEvent(Base):
    """What happened in a migration and who did it (created, mapped, confirmed, finished, rolled back, errors)."""
    __tablename__ = "migration_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    migration_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("migrations.id", ondelete="CASCADE"), nullable=False, index=True)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    level: Mapped[str] = mapped_column(String(8), nullable=False, default="info")   # info | warning | error
    code: Mapped[str] = mapped_column(String(48), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
