from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, EmailStr

class CalendarArtistOut(BaseModel):
    id: UUID
    email: EmailStr
    display_name: str | None
    calendar_color: str | None
    is_active: bool

    model_config = {"from_attributes": True}

class CalendarAppointmentOut(BaseModel):
    id: UUID
    studio_id: UUID
    client_id: UUID
    artist_id: UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    status: str
    notes: str | None
    created_at: datetime

    # extras ליומן
    client_name: str
    artist_email: EmailStr
    artist_name: str | None
    artist_color: str | None

class CalendarViewOut(BaseModel):
    start: datetime
    end: datetime
    artists: list[CalendarArtistOut]
    appointments: list[CalendarAppointmentOut]
