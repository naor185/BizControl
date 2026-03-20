from __future__ import annotations
from uuid import UUID
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.user import User

def calendar_view(
    db: Session,
    studio_id: UUID,
    start: datetime,
    end: datetime,
    artist_id: UUID | None = None,
):
    # Artists (מקעקעים) של הסטודיו בלבד
    artists_stmt = select(User).where(
        User.studio_id == studio_id,
        User.role == "artist",
        User.is_active == True,  # noqa: E712
    ).order_by(User.created_at.asc())
    artists = list(db.scalars(artists_stmt).all())

    # Appointments בטווח (Overlap rule) + join כדי להחזיר client_name + צבע מקעקע
    stmt = (
        select(
            Appointment,
            Client.full_name.label("client_name"),
            User.email.label("artist_email"),
            User.display_name.label("artist_name"),
            User.calendar_color.label("artist_color"),
        )
        .join(Client, Client.id == Appointment.client_id)
        .join(User, User.id == Appointment.artist_id)
        .where(
            Appointment.studio_id == studio_id,
            Appointment.starts_at < end,
            Appointment.ends_at > start,
        )
        .order_by(Appointment.starts_at.asc())
    )

    if artist_id:
        stmt = stmt.where(Appointment.artist_id == artist_id)

    rows = db.execute(stmt).all()

    appointments = []
    for appt, client_name, artist_email, artist_name, artist_color in rows:
        appointments.append({
            "id": appt.id,
            "studio_id": appt.studio_id,
            "client_id": appt.client_id,
            "artist_id": appt.artist_id,
            "title": appt.title,
            "starts_at": appt.starts_at,
            "ends_at": appt.ends_at,
            "status": appt.status,
            "notes": appt.notes,
            "created_at": appt.created_at,
            "client_name": client_name,
            "artist_email": artist_email,
            "artist_name": artist_name,
            "artist_color": artist_color,
        })

    return artists, appointments
