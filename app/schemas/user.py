from __future__ import annotations
from datetime import datetime
from typing import Literal
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
    global_salary: float = 0.0
    class_pay_mode: str = "none"          # teaching group classes (app/services/class_payroll.py)
    class_pay_per_class: float = 0.0
    class_pay_per_participant: float = 0.0
    class_pay_minimum: float = 0.0
    class_pay_percent: float = 0.0
    class_pay_counts: str = "attended"

ClassPayMode = Literal["none", "per_class", "per_participant", "both", "percent"]
ClassPayCounts = Literal["attended", "booked"]


class ClassPayFields(BaseModel):
    """The owner's pay for teaching group classes — on a new or an edited staff member."""
    class_pay_mode: ClassPayMode | None = None
    class_pay_per_class: float | None = Field(default=None, ge=0)
    class_pay_per_participant: float | None = Field(default=None, ge=0)
    class_pay_minimum: float | None = Field(default=None, ge=0)
    class_pay_percent: float | None = Field(default=None, ge=0, le=100)
    class_pay_counts: ClassPayCounts | None = None

class ArtistCreate(ClassPayFields):
    email: EmailStr
    password: str = Field(min_length=6)
    display_name: str = Field(..., min_length=1, max_length=120)
    role: Literal["artist", "admin", "staff"] = "artist"
    calendar_color: str | None = Field(default=None, max_length=16)
    pay_type: str | None = "none"
    hourly_rate: float | None = 0.0
    commission_rate: float | None = 0.0
    global_salary: float | None = 0.0

class ArtistUpdate(ClassPayFields):
    is_active: bool | None = None
    display_name: str | None = None
    role: Literal["artist", "admin", "staff"] | None = None
    calendar_color: str | None = Field(default=None, max_length=16)
    pay_type: str | None = None
    hourly_rate: float | None = None
    commission_rate: float | None = None
    global_salary: float | None = None
    password: str | None = Field(default=None, min_length=6)

class UserOut(UserBase):
    id: UUID
    studio_id: UUID
    created_at: datetime

    model_config = {"from_attributes": True}
