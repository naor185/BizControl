from __future__ import annotations
from datetime import date, datetime
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field

class ClientBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    birth_date: date | None = None
    notes: str | None = None
    is_active: bool = True
    is_club_member: bool = False

class ClientCreate(ClientBase):
    pass

class ClientUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    birth_date: date | None = None
    notes: str | None = None
    is_active: bool | None = None
    is_club_member: bool | None = None

class ClientOut(ClientBase):
    id: UUID
    studio_id: UUID
    loyalty_points: int
    cancellation_count: int
    no_show_count: int
    is_walk_in: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}

class ClientLedgerItem(BaseModel):
    id: UUID
    appointment_id: UUID | None
    delta_points: int
    reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

class ClientMessageItem(BaseModel):
    id: UUID
    appointment_id: UUID | None
    channel: str
    to_phone: str
    body: str
    scheduled_at: datetime
    status: str
    attempts: int
    last_error: str | None
    sent_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}

class ClientProfileClient(BaseModel):
    id: UUID
    studio_id: UUID
    full_name: str
    phone: str | None
    email: EmailStr | None
    birth_date: date | None
    notes: str | None
    marketing_consent: bool
    is_active: bool
    is_club_member: bool
    loyalty_points: int
    cancellation_count: int
    no_show_count: int
    is_walk_in: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}

class ClientProfileOut(BaseModel):
    client: ClientProfileClient
    points_balance: int
    ledger: list[ClientLedgerItem]
    messages: list[ClientMessageItem]
