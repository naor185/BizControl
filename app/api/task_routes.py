from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import date
import calendar as cal_module

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.task import Task
from app.schemas.task import TaskCreate, TaskUpdate, TaskOut, TaskInstance

router = APIRouter(prefix="/tasks", tags=["Tasks"])


def _expand_tasks(tasks: list[Task], from_date: date, to_date: date) -> list[TaskInstance]:
    """Expand recurring tasks into individual occurrences within the date range."""
    result: list[TaskInstance] = []

    for t in tasks:
        rid = str(t.id)

        if t.recurrence_type == "none":
            if t.task_date and from_date <= t.task_date <= to_date:
                result.append(TaskInstance(
                    id=rid, title=t.title, date=t.task_date.isoformat(),
                    start_time=t.start_time, end_time=t.end_time,
                    notes=t.notes, color=t.color,
                    recurrence_type=t.recurrence_type, is_recurring=False,
                ))

        elif t.recurrence_type == "monthly":
            if not t.recurrence_day:
                continue
            # Walk through each month in the range
            cur = date(from_date.year, from_date.month, 1)
            end_month = date(to_date.year, to_date.month, 1)
            while cur <= end_month:
                max_day = cal_module.monthrange(cur.year, cur.month)[1]
                day = min(t.recurrence_day, max_day)
                occurrence = date(cur.year, cur.month, day)
                if from_date <= occurrence <= to_date:
                    if t.recurrence_end_date is None or occurrence <= t.recurrence_end_date:
                        result.append(TaskInstance(
                            id=rid, title=t.title, date=occurrence.isoformat(),
                            start_time=t.start_time, end_time=t.end_time,
                            notes=t.notes, color=t.color,
                            recurrence_type=t.recurrence_type, is_recurring=True,
                        ))
                # next month
                if cur.month == 12:
                    cur = date(cur.year + 1, 1, 1)
                else:
                    cur = date(cur.year, cur.month + 1, 1)

        elif t.recurrence_type == "yearly":
            if not t.recurrence_day or not t.recurrence_month:
                continue
            for year in range(from_date.year, to_date.year + 1):
                max_day = cal_module.monthrange(year, t.recurrence_month)[1]
                day = min(t.recurrence_day, max_day)
                occurrence = date(year, t.recurrence_month, day)
                if from_date <= occurrence <= to_date:
                    if t.recurrence_end_date is None or occurrence <= t.recurrence_end_date:
                        result.append(TaskInstance(
                            id=rid, title=t.title, date=occurrence.isoformat(),
                            start_time=t.start_time, end_time=t.end_time,
                            notes=t.notes, color=t.color,
                            recurrence_type=t.recurrence_type, is_recurring=True,
                        ))

    result.sort(key=lambda x: x.date)
    return result


@router.get("", response_model=list[TaskInstance])
def list_tasks(
    from_date: date,
    to_date: date,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    tasks = db.scalars(
        select(Task).where(Task.studio_id == ctx.studio_id)
    ).all()
    return _expand_tasks(list(tasks), from_date, to_date)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from uuid import UUID
    try:
        uid = UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task id")
    task = db.get(Task, uid)
    if not task or task.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(
    payload: TaskCreate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    task = Task(studio_id=ctx.studio_id, **payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.put("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: str,
    payload: TaskUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from uuid import UUID
    try:
        uid = UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task id")

    task = db.get(Task, uid)
    if not task or task.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Task not found")

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(task, k, v)

    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from uuid import UUID
    try:
        uid = UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid task id")

    task = db.get(Task, uid)
    if not task or task.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(task)
    db.commit()
