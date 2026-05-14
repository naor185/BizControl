import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


class WorkSessionBase(BaseModel):
    user_id: uuid.UUID
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    session_pay: Decimal = Decimal("0.00")


class WorkSessionCreate(BaseModel):
    user_id: uuid.UUID


class WorkSessionResponse(WorkSessionBase):
    id: uuid.UUID
    studio_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ClockStatusResponse(BaseModel):
    is_clocked_in: bool
    active_session: Optional[WorkSessionResponse] = None
    pay_type: str = "none"


class StaffPayrollItem(BaseModel):
    user_id: uuid.UUID
    display_name: str
    pay_type: str
    hourly_rate: Decimal
    commission_rate: Decimal
    global_salary: Decimal = Decimal("0.00")

    total_hours: float = 0.0
    hourly_pay: Decimal = Decimal("0.00")
    commission_pay: Decimal = Decimal("0.00")
    total_pay: Decimal = Decimal("0.00")


class StaffPayrollSummary(BaseModel):
    items: list[StaffPayrollItem]
    grand_total: Decimal
    period_start: datetime
    period_end: datetime
