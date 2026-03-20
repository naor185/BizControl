from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field, EmailStr

class AppointmentCreate(BaseModel):
    client_id: UUID
    artist_id: UUID
    title: str = Field(default="Tattoo Session", max_length=160)
    starts_at: datetime
    ends_at: datetime
    notes: str | None = None
    total_price_cents: int | None = Field(default=0, ge=0)
    deposit_amount_cents: int | None = Field(default=0, ge=0)

class AppointmentUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    status: str | None = None  # scheduled/done/canceled/no_show
    notes: str | None = None
    artist_id: UUID | None = None
    client_id: UUID | None = None
    total_price_cents: int | None = Field(default=None, ge=0)
    deposit_amount_cents: int | None = Field(default=None, ge=0)

class AppointmentOut(BaseModel):
    id: UUID
    studio_id: UUID
    client_id: UUID
    artist_id: UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    status: str
    notes: str | None
    total_price_cents: int
    deposit_amount_cents: int
    created_at: datetime
    paid_cents: int = 0
    remaining_cents: int = 0
    client_loyalty_points: int = 0

    # calendar extras (ALWAYS)
    client_name: str
    artist_email: str
    artist_name: str | None
    artist_color: str | None
    google_event_id: str | None = None

    model_config = {"from_attributes": True}
