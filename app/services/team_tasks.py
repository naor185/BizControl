"""A task for a worker (the owner, 2026-10-15) — the owner or a manager gives a calendar task to one worker (or to the
whole team, as tasks always were):

- The worker hears at once — a push on their phone; without the app, a WhatsApp to their number.
- In their calendar, "בוצע"; a recurring task is done occurrence by occurrence (TaskCompletion).
- Not marked done: when its time passes the worker is reminded, then every morning at 9:00, until it's marked (for
  FOLLOW_DAYS at most). A task without hours is due by the end of its day — the mornings after.
- The worker marked it done: the owner and the managers hear (the bell and a push).
A task for the whole team has no one to chase — it keeps the calendar reminders (staff_reminder_rules) only."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import pytz
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device_token import DeviceToken
from app.models.message_job import MessageJob
from app.models.task import Task
from app.models.task_completion import TaskCompletion
from app.models.user import User

log = logging.getLogger(__name__)
IL = pytz.timezone("Asia/Jerusalem")
FOLLOW_DAYS = 30
MORNING_HOUR = 9
WORKERS = ("artist", "staff")


def _when(task: Task) -> str:
    """When the task is — for the worker's message."""
    hours = f" {task.start_time}" + (f"–{task.end_time}" if task.end_time else "") if task.start_time else ""
    if task.recurrence_type == "none":
        if not task.task_date:
            return hours.strip()
        today = datetime.now(IL).date()
        day = ("היום" if task.task_date == today else "מחר" if task.task_date == today + timedelta(days=1)
               else task.task_date.strftime("%d/%m"))
        return day + hours
    names = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "שבת"]
    if task.recurrence_type == "weekly" and task.recurrence_days_of_week:
        days = ", ".join(names[int(d)] for d in task.recurrence_days_of_week.split(",") if d.strip().isdigit())
        return f"כל שבוע ב{days}{hours}"
    if task.recurrence_type == "monthly" and task.recurrence_day:
        return f"כל חודש ב־{task.recurrence_day}{hours}"
    if task.recurrence_type == "yearly" and task.recurrence_day and task.recurrence_month:
        return f"כל שנה ב־{task.recurrence_day}/{task.recurrence_month}{hours}"
    return hours.strip()


def _to_worker(db: Session, studio_id, worker: User, title: str, body: str, kind: str, key: str | None,
               link: str = "/calendar") -> bool:
    """A push to the worker's phone (opening `link`) — or, without the app, a WhatsApp to their number. Once per key."""
    if key and db.scalar(select(MessageJob.id).where(MessageJob.studio_id == studio_id, MessageJob.dedup_key == key)):
        return False
    has_app = db.scalar(select(DeviceToken.id).where(DeviceToken.user_id == worker.id, DeviceToken.is_active == True)  # noqa: E712
                        .limit(1))
    now = datetime.now(timezone.utc)
    if has_app:
        db.add(MessageJob(studio_id=studio_id, recipient_user_id=worker.id, channel="push", subject=title, body=body,
                          deep_link=link, reminder_type=kind, dedup_key=key, scheduled_at=now, status="pending"))
    elif worker.phone:
        db.add(MessageJob(studio_id=studio_id, recipient_user_id=worker.id, channel="whatsapp", to_phone=worker.phone,
                          body=f"{title}: {body}", reminder_type=kind, dedup_key=key, scheduled_at=now, status="pending"))
    else:
        return False
    db.commit()
    return True


def notify_assigned(db: Session, task: Task) -> None:
    """The worker hears of the task given to them."""
    worker = db.get(User, task.assignee_id) if task.assignee_id else None
    if worker is None or not worker.is_active:
        return
    when = _when(task)
    _to_worker(db, task.studio_id, worker, "משימה חדשה", task.title + (f" — {when}" if when else ""), "task_assigned", None)


def is_done(db: Session, task_id, occurrence: date) -> bool:
    return db.scalar(select(TaskCompletion.id).where(TaskCompletion.task_id == task_id,
                                                     TaskCompletion.occurrence_date == occurrence)) is not None


def mark_done(db: Session, task: Task, occurrence: date, user: User) -> None:
    """Marked done; a worker's — the owner and the managers hear."""
    if is_done(db, task.id, occurrence):
        return
    db.add(TaskCompletion(studio_id=task.studio_id, task_id=task.id, occurrence_date=occurrence, done_by=user.id))
    db.commit()
    if user.role not in WORKERS:
        return
    from app.models.notification import Notification
    from app.crud.push import enqueue_push_to_studio_admins
    body = f"{user.display_name or user.email}: {task.title}"
    key = f"task_done:{task.id}:{occurrence.isoformat()}"
    try:
        if not db.scalar(select(Notification.id).where(Notification.studio_id == task.studio_id, Notification.dedup_key == key)):
            db.add(Notification(studio_id=task.studio_id, type="task_done", title="משימה בוצעה", body=body,
                                action_url="/calendar", dedup_key=key))
            db.commit()
            enqueue_push_to_studio_admins(db, task.studio_id, title="משימה בוצעה", body=body, deep_link="/calendar",
                                          reminder_type="task_done")
    except Exception as e:
        db.rollback()
        log.warning("task-done notice failed for task %s: %s", task.id, e)


def undo_done(db: Session, task: Task, occurrence: date) -> None:
    row = db.scalar(select(TaskCompletion).where(TaskCompletion.task_id == task.id, TaskCompletion.occurrence_date == occurrence))
    if row:
        db.delete(row)
        db.commit()


def due_at(occurrence: date, start_time: str | None, end_time: str | None) -> datetime:
    """When an occurrence is due — its end, its start, or (no hours) the end of its day."""
    hhmm = end_time or start_time
    if hhmm:
        local = datetime.combine(occurrence, datetime.strptime(hhmm, "%H:%M").time())
    else:
        local = datetime.combine(occurrence + timedelta(days=1), datetime.min.time())
    return IL.localize(local).astimezone(timezone.utc)


def sweep_task_followups(db: Session, now: datetime | None = None) -> int:
    """The reminders for tasks given to a worker and not marked done — once its time passes, then every morning."""
    from app.api.task_routes import _expand_tasks
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(IL).date()
    morning = now.astimezone(IL).hour >= MORNING_HOUR
    tasks = {str(t.id): t for t in db.scalars(select(Task).where(Task.assignee_id.isnot(None),
                                                                 Task.kind == "task")).all()}   # a break: nothing to remind
    if not tasks:
        return 0
    done = {(str(c.task_id), c.occurrence_date) for c in db.scalars(
        select(TaskCompletion).where(TaskCompletion.occurrence_date >= today - timedelta(days=FOLLOW_DAYS))).all()}
    count = 0
    for inst in _expand_tasks(list(tasks.values()), today - timedelta(days=FOLLOW_DAYS), today):
        occurrence = date.fromisoformat(inst.date)
        if (inst.id, occurrence) in done or now < due_at(occurrence, inst.start_time, inst.end_time):
            continue
        task = tasks[inst.id]
        worker = db.get(User, task.assignee_id)
        if worker is None or not worker.is_active:
            continue
        when = occurrence.strftime("%d/%m") + (f" {inst.start_time}" if inst.start_time else "")
        body = f"{task.title} ({when}) — עדיין לא סומנה כבוצעה"
        if inst.start_time and occurrence == today:          # its time just passed — once
            key = f"task_due:{inst.id}:{occurrence.isoformat()}"
        elif occurrence < today and morning:                 # every morning after, until it's marked
            key = f"task_daily:{inst.id}:{occurrence.isoformat()}:{today.isoformat()}"
        else:
            continue
        if _to_worker(db, task.studio_id, worker, "תזכורת למשימה", body, "task_overdue", key):
            count += 1
    return count
