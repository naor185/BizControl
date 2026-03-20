from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field

class UserBase(BaseModel):
    email: EmailStr
    role: str
    is_active: bool = True
    display_name: str | None = Field(default=None, max_length=120)
    calendar_color: str | None = Field(default=None, max_length=16)
    pay_type: str = "none"
    hourly_rate: float = 0.0
    commission_rate: float = 0.0

class ArtistCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    display_name: str = Field(..., min_length=1, max_length=120)
    calendar_color: str | None = Field(default=None, max_length=16)
    pay_type: str | None = "none"
    hourly_rate: float | None = 0.0
    commission_rate: float | None = 0.0

class ArtistUpdate(BaseModel):
    is_active: bool | None = None
    display_name: str | None = None
    calendar_color: str | None = Field(default=None, max_length=16)
    pay_type: str | None = None
    hourly_rate: float | None = None
    commission_rate: float | None = None
    password: str | None = Field(default=None, min_length=6)

class UserOut(UserBase):
    id: UUID
    studio_id: UUID
    created_at: datetime

    model_config = {"from_attributes": True}
