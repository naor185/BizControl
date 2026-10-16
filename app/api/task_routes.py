from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from datetime import date
from uuid import UUID
import calendar as cal_module

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.permissions import require_management
from app.models.task import Task
from app.schemas.task import TaskCreate, TaskUpdate, TaskOut, TaskInstance, TaskDoneIn

# Tasks are set by the owner and the managers; a worker sees the team's and their own, and marks them done
# (services/team_tasks — the owner, 2026-10-15).
WORKERS = ("artist", "staff")

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

        elif t.recurrence_type == "weekly":
            if not t.recurrence_days_of_week:
                continue
            try:
                days = {int(d) for d in t.recurrence_days_of_week.split(",") if d.strip() != ""}
            except ValueError:
                continue
            cur = from_date
            while cur <= to_date:
                # JS Date.getDay() convention (0=Sunday..6=Saturday), matching how
                # the frontend day-picker stores recurrence_days_of_week — Python's
                # date.weekday() is Monday=0, so shift by one.
                js_day = (cur.weekday() + 1) % 7
                if js_day in days:
                    if t.recurrence_end_date is None or cur <= t.recurrence_end_date:
                        result.append(TaskInstance(
                            id=rid, title=t.title, date=cur.isoformat(),
                            start_time=t.start_time, end_time=t.end_time,
                            notes=t.notes, color=t.color,
                            recurrence_type=t.recurrence_type, is_recurring=True,
                        ))
                cur = date.fromordinal(cur.toordinal() + 1)

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
    from datetime import datetime, timezone
    from app.models.task_completion import TaskCompletion
    from app.models.user import User
    from app.services.team_tasks import due_at
    q = select(Task).where(Task.studio_id == ctx.studio_id)
    if ctx.role in WORKERS:                                   # the team's and their own — not another worker's
        q = q.where((Task.assignee_id.is_(None)) | (Task.assignee_id == ctx.user_id))
    tasks = list(db.scalars(q).all())
    instances = _expand_tasks(tasks, from_date, to_date)
    by_id = {str(t.id): t for t in tasks}
    names = {u.id: (u.display_name or u.email) for u in db.scalars(
        select(User).where(User.id.in_({t.assignee_id for t in tasks if t.assignee_id}))).all()} if tasks else {}
    done = {(str(c.task_id), c.occurrence_date) for c in db.scalars(select(TaskCompletion).where(
        TaskCompletion.studio_id == ctx.studio_id, TaskCompletion.occurrence_date >= from_date,
        TaskCompletion.occurrence_date <= to_date)).all()}
    now = datetime.now(timezone.utc)
    for inst in instances:
        task = by_id[inst.id]
        occurrence = date.fromisoformat(inst.date)
        inst.done = (inst.id, occurrence) in done
        inst.locks = bool(task.blocks_booking and inst.start_time and inst.end_time)
        inst.kind = task.kind
        if task.assignee_id:
            inst.assignee_id = str(task.assignee_id)
            inst.assignee_name = names.get(task.assignee_id)
            inst.overdue = task.kind == "task" and not inst.done and now >= due_at(occurrence, inst.start_time, inst.end_time)
    return instances


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
    ctx: AuthContext = Depends(require_management("משימות")),
    db: Session = Depends(get_db),
):
    _check_assignee(db, ctx, payload.assignee_id)
    task = Task(studio_id=ctx.studio_id, **payload.model_dump())
    _a_break_has_hours(task)
    db.add(task)
    db.commit()
    db.refresh(task)
    if task.assignee_id and task.kind == "task":
        from app.services.team_tasks import notify_assigned
        notify_assigned(db, task)
    return task


def _a_break_has_hours(task: Task) -> None:
    """A break or a meeting is a time in the calendar: it has hours, and it always locks it."""
    if task.kind != "break":
        return
    if not (task.start_time and task.end_time):
        raise HTTPException(status_code=400, detail="להפסקה או לפגישה צריך שעת התחלה ושעת סיום")
    task.blocks_booking = True


def _check_assignee(db: Session, ctx: AuthContext, assignee_id) -> None:
    """The worker a task is for belongs to this business and is active."""
    if assignee_id is None:
        return
    from app.models.user import User
    user = db.get(User, assignee_id)
    if user is None or user.studio_id != ctx.studio_id or not user.is_active:
        raise HTTPException(status_code=400, detail="העובד לא נמצא")


@router.put("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: str,
    payload: TaskUpdate,
    ctx: AuthContext = Depends(require_management("משימות")),
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

    changes = payload.model_dump(exclude_unset=True)
    if "assignee_id" in changes:
        _check_assignee(db, ctx, changes["assignee_id"])
    given_to_someone_new = changes.get("assignee_id") is not None and changes["assignee_id"] != task.assignee_id
    for k, v in changes.items():
        setattr(task, k, v)
    _a_break_has_hours(task)

    db.commit()
    db.refresh(task)
    if given_to_someone_new and task.kind == "task":
        from app.services.team_tasks import notify_assigned
        notify_assigned(db, task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    ctx: AuthContext = Depends(require_management("משימות")),
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


def _task_for_marking(db: Session, ctx: AuthContext, task_id) -> Task:
    """A task this user may mark — the owner's and the managers' every task; a worker's the team's and their own."""
    task = db.get(Task, task_id)
    if not task or task.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="המשימה לא נמצאה")
    if ctx.role in WORKERS and task.assignee_id not in (None, ctx.user_id):
        raise HTTPException(status_code=403, detail="המשימה הזו של עובד אחר")
    if task.kind != "task":
        raise HTTPException(status_code=400, detail="הפסקה או פגישה לא מסמנים כבוצעה")
    return task


@router.post("/{task_id}/done", status_code=204)
def mark_task_done(task_id: UUID, payload: TaskDoneIn, ctx: AuthContext = Depends(require_studio_ctx),
                   db: Session = Depends(get_db)):
    """Done — this occurrence (services/team_tasks: a worker's tells the owner and the managers)."""
    from app.models.user import User
    from app.services import team_tasks
    task = _task_for_marking(db, ctx, task_id)
    team_tasks.mark_done(db, task, payload.date, db.get(User, ctx.user_id))


@router.delete("/{task_id}/done", status_code=204)
def undo_task_done(task_id: UUID, date: date, ctx: AuthContext = Depends(require_studio_ctx),
                   db: Session = Depends(get_db)):
    """Not done after all — this occurrence."""
    from app.services import team_tasks
    team_tasks.undo_done(db, _task_for_marking(db, ctx, task_id), date)
