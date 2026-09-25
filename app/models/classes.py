"""
Group classes — rooms, class templates (a class that repeats every week, or a short course), the class
sessions made from them, and bookings.

A template is the rule ("Pilates, Sun and Tue at 18:00, room A, 10 spots"); a session is one occurrence
on one date, created ahead of time (app/services/classes.py) and changed or cancelled on its own. A
course is a template with an end date or a fixed number of sessions. Classes are separate from
appointments: an appointment is one client with one staff member; a session has a room and many clients.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, Time,
                        UniqueConstraint, func, text)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# origin of a row: made in the system by a person or a job, or brought in by an import (never messages)
SOURCES = ("user", "system", "migration")
SESSION_STATUSES = ("scheduled", "canceled", "auto_canceled", "done")
BOOKING_STATUSES = ("booked", "canceled", "late_canceled", "attended", "no_show")


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user", server_default="user")
    source_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)      # the record's id in the old system
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ClassTemplate(Base):
    __tablename__ = "class_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="SET NULL"), nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    room_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    instructor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    weekdays: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), nullable=False)   # 0 = Sunday … 6 = Saturday
    start_time: Mapped[time] = mapped_column(Time, nullable=False)                      # Israel time
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    # a course: an end date and/or a fixed number of sessions (both empty = repeats until stopped)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    sessions_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user", server_default="user")
    source_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ClassSession(Base):
    __tablename__ = "class_sessions"
    # one session per template and date — whatever later happens to its time (see detached)
    __table_args__ = (UniqueConstraint("template_id", "occurs_on", name="uq_class_session_template_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("class_templates.id", ondelete="SET NULL"), nullable=True, index=True)
    occurs_on: Mapped[date] = mapped_column(Date, nullable=False)          # the template's date for this occurrence
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    room_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True)
    instructor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled", server_default="scheduled")
    # changed on its own (time, room, instructor) or kept when the template changed — the template no
    # longer updates it
    detached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    canceled_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="system", server_default="system")
    source_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # background jobs, once per session: the reminder went out; the minimum-participants check ran
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    min_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ClassBooking(Base):
    """A client booked into one session (app/services/class_bookings.py). booked → attended / no_show
    (attendance), or canceled / late_canceled (inside the free-cancel window). A late-cancelled client
    who books again gets the same row back."""
    __tablename__ = "class_bookings"
    # a client is booked into a session once (a cancelled booking does not block booking again)
    __table_args__ = (Index("uq_class_booking_active", "session_id", "client_id", unique=True,
                            postgresql_where=text("status <> 'canceled'")),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    studio_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studios.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("class_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="booked", server_default="booked")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user", server_default="user")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    canceled_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # booked beyond the spots by the owner or a manager — kept on record
    over_capacity: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)   # attendance
    marked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # memberships (stage 4): the membership that covers it and what happened to its entry (reserved →
    # consumed / returned; empty for unlimited), a paid single entry instead of a membership (drop_in),
    # a late cancel or no-show the staff marked as justified, and the owner's rule that applied
    membership_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True, index=True)
    entry_state: Mapped[str | None] = mapped_column(String(10), nullable=True)
    drop_in: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    justified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    policy_action: Mapped[str | None] = mapped_column(String(10), nullable=True)
    swapped_from_booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)   # class swap, later
    # came from the waitlist (stage 6) — then it can be cancelled free of charge
    from_waitlist: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
