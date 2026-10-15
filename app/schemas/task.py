from pydantic import BaseModel, Field, field_validator
from datetime import date
from typing import Literal
from uuid import UUID


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    task_date: date | None = None
    start_time: str | None = None
    end_time: str | None = None
    notes: str | None = None
    color: str = "#8b5cf6"
    recurrence_type: Literal["none", "weekly", "monthly", "yearly"] = "none"
    recurrence_day: int | None = Field(default=None, ge=1, le=31)
    recurrence_month: int | None = Field(default=None, ge=1, le=12)
    recurrence_days_of_week: str | None = None  # weekly only — "0,3" (Sun,Wed), 0=Sunday
    recurrence_end_date: date | None = None
    assignee_id: UUID | None = None             # the worker it's for; None — the whole team


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    task_date: date | None = None
    start_time: str | None = None
    end_time: str | None = None
    notes: str | None = None
    color: str | None = None
    recurrence_type: Literal["none", "weekly", "monthly", "yearly"] | None = None
    recurrence_day: int | None = Field(default=None, ge=1, le=31)
    recurrence_month: int | None = Field(default=None, ge=1, le=12)
    recurrence_days_of_week: str | None = None
    recurrence_end_date: date | None = None
    assignee_id: UUID | None = None


class TaskOut(BaseModel):
    id: str
    title: str
    task_date: date | None
    start_time: str | None
    end_time: str | None
    notes: str | None
    color: str
    recurrence_type: str
    recurrence_day: int | None
    recurrence_month: int | None
    recurrence_days_of_week: str | None
    recurrence_end_date: date | None
    assignee_id: UUID | None = None

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v):
        return str(v)

    class Config:
        from_attributes = True


class TaskInstance(BaseModel):
    """A single occurrence of a task (possibly from a recurring task)."""
    id: str

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, v):
        return str(v)
    title: str
    date: str          # YYYY-MM-DD — the specific occurrence date
    start_time: str | None
    end_time: str | None
    notes: str | None
    color: str
    recurrence_type: str
    is_recurring: bool
    # for a worker (services/team_tasks): who, and this occurrence's state
    assignee_id: str | None = None
    assignee_name: str | None = None
    done: bool = False
    overdue: bool = False


class TaskDoneIn(BaseModel):
    date: date        # the occurrence — a recurring task is done one by one
