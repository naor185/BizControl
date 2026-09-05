from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Literal


class StaffReminderRuleCreate(BaseModel):
    applies_to: Literal["appointment", "task", "both"] = "both"
    lead_minutes: int = Field(..., gt=0, le=43200)  # up to 30 days ahead
    enabled: bool = True


class StaffReminderRuleUpdate(BaseModel):
    applies_to: Literal["appointment", "task", "both"] | None = None
    lead_minutes: int | None = Field(default=None, gt=0, le=43200)
    enabled: bool | None = None


class StaffReminderRuleOut(BaseModel):
    id: str
    applies_to: str
    lead_minutes: int
    enabled: bool
    created_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v):
        return str(v)

    class Config:
        from_attributes = True
