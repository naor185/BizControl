import uuid
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class MonthlyGoalBase(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    month: int = Field(..., ge=1, le=12)
    target_amount: Decimal = Field(..., ge=0)


class MonthlyGoalCreate(MonthlyGoalBase):
    pass


class MonthlyGoalUpdate(BaseModel):
    target_amount: Decimal = Field(..., ge=0)


class MonthlyGoalResponse(MonthlyGoalBase):
    id: uuid.UUID
    studio_id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class GoalProgressResponse(BaseModel):
    year: int
    month: int
    target_amount: Decimal
    current_revenue: Decimal
    remaining_amount: Decimal
    progress_percentage: float
    days_in_month: int
    days_elapsed: int
    days_remaining: int
    required_daily_avg: Decimal
    current_daily_avg: Decimal
