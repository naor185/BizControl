"""A worker's month — their sales against their goal, their tasks, their appointments — and ויקי's words about it (the
owner, 2026-10-27: "a sales goal for each worker, and ויקי gives the worker an analysis of their progress — the goal,
the tasks, the appointments").

Their sales: the payments on their appointments (a deposit too) and what they sold at the till (the till's "מי מכר"),
less what a credit note gave back — the same money the business counts (crud/payment.net_cents). The month's working
days are the business's (settings.work_days). Worked out from the data every time it's shown; a worker sees their own,
the owner and the managers who manage the team see everyone's (api/worker_goal_routes)."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

import pytz
from sqlalchemy import func, select
from sqlalchemy.orm import Session

IL = pytz.timezone("Asia/Jerusalem")


def _ils(amount: float) -> str:
    return f"₪{round(amount):,}"


def _at(d: date) -> datetime:
    return IL.localize(datetime.combine(d, time(0))).astimezone(timezone.utc)


def _month(year: int, month: int) -> tuple[date, date]:
    first = date(year, month, 1)
    return first, (first + timedelta(days=32)).replace(day=1)


def sales_cents(db: Session, studio_id, user_id, start: date, end: date) -> int:
    """What this worker brought in from `start` up to (not including) `end`."""
    from app.crud.payment import money_received, net_cents
    from app.models.appointment import Appointment
    from app.models.payment import Payment
    from app.models.pos_transaction import PosTransaction
    paid = db.scalar(select(func.coalesce(func.sum(net_cents()), 0))
                     .join(Appointment, Appointment.id == Payment.appointment_id)
                     .where(Payment.studio_id == studio_id, Payment.status == "paid", money_received(),
                            Appointment.artist_id == user_id,
                            Payment.created_at >= _at(start), Payment.created_at < _at(end))) or 0
    sold = db.scalar(select(func.coalesce(func.sum(PosTransaction.total_cents), 0))
                     .where(PosTransaction.studio_id == studio_id, PosTransaction.status == "paid",
                            PosTransaction.performer_id == user_id,
                            PosTransaction.created_at >= _at(start), PosTransaction.created_at < _at(end))) or 0
    return int(paid) + int(sold)


def goal_cents(db: Session, studio_id, user_id, year: int, month: int) -> int:
    from app.models.worker_goal import WorkerGoal
    g = db.scalar(select(WorkerGoal).where(WorkerGoal.studio_id == studio_id, WorkerGoal.user_id == user_id,
                                           WorkerGoal.year == year, WorkerGoal.month == month))
    return g.target_cents if g else 0


def set_goal(db: Session, studio_id, user_id, year: int, month: int, cents: int) -> None:
    from app.models.worker_goal import WorkerGoal
    g = db.scalar(select(WorkerGoal).where(WorkerGoal.user_id == user_id, WorkerGoal.year == year, WorkerGoal.month == month))
    if g is None:
        db.add(WorkerGoal(studio_id=studio_id, user_id=user_id, year=year, month=month, target_cents=max(0, cents)))
    else:
        g.target_cents = max(0, cents)
    db.commit()


def progress(db: Session, studio_id, user_id, now: datetime | None = None) -> dict:
    """The month so far: sales, the goal, the pace and what's needed a day; the month's tasks; this week's appointments."""
    from app.api.task_routes import _expand_tasks
    from app.models.appointment import Appointment
    from app.models.studio_settings import StudioSettings
    from app.models.task import Task
    from app.models.task_completion import TaskCompletion
    from app.models.user import User
    from app.services.team_tasks import due_at
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(IL).date()
    first, nxt = _month(today.year, today.month)
    user = db.get(User, user_id)

    sales = sales_cents(db, studio_id, user_id, first, nxt) / 100
    goal = goal_cents(db, studio_id, user_id, today.year, today.month) / 100
    settings = db.get(StudioSettings, studio_id)
    work_days = set(settings.work_days) if settings is not None and settings.work_days is not None else {0, 1, 2, 3, 4, 5}
    working = [first + timedelta(days=i) for i in range((nxt - first).days)
               if ((first + timedelta(days=i)).weekday() + 1) % 7 in work_days]
    worked_today = sales_cents(db, studio_id, user_id, today, today + timedelta(days=1)) > 0
    elapsed = sum(1 for d in working if d < today or (d == today and worked_today))
    left = len(working) - elapsed
    projected = sales / elapsed * len(working) if elapsed >= 3 else None

    # the month's tasks given to them — done, done in time, late
    tasks = list(db.scalars(select(Task).where(Task.studio_id == studio_id, Task.assignee_id == user_id, Task.kind == "task")).all())
    occurrences = [o for o in _expand_tasks(tasks, first, today)] if tasks else []
    done_at = {(str(c.task_id), c.occurrence_date): c.done_at for c in db.scalars(select(TaskCompletion).where(
        TaskCompletion.studio_id == studio_id, TaskCompletion.occurrence_date >= first,
        TaskCompletion.occurrence_date <= today)).all()}
    total = done = on_time = late = 0
    for o in occurrences:
        occ = date.fromisoformat(o.date)
        due = due_at(occ, o.start_time, o.end_time)
        when = done_at.get((o.id, occ))
        if when is None and now < due:
            continue                                          # not due yet
        total += 1
        if when is not None:
            done += 1
            on_time += 1 if when <= due else 0
        else:
            late += 1

    # this week's appointments — Sunday on
    sunday = today - timedelta(days=(today.weekday() + 1) % 7)
    live = Appointment.status.notin_(("canceled", "no_show"))
    week_done = db.scalar(select(func.count(Appointment.id)).where(
        Appointment.studio_id == studio_id, Appointment.artist_id == user_id, live,
        Appointment.starts_at >= _at(sunday), Appointment.starts_at < now)) or 0
    week_ahead = db.scalar(select(func.count(Appointment.id)).where(
        Appointment.studio_id == studio_id, Appointment.artist_id == user_id, Appointment.status == "scheduled",
        Appointment.starts_at >= now, Appointment.starts_at < _at(sunday + timedelta(days=7)))) or 0

    return {
        "user_id": str(user_id), "name": (user.display_name or user.email) if user else "",
        "year": today.year, "month": today.month,
        "sales": sales, "goal": goal, "percent": round(sales / goal * 100) if goal > 0 else None,
        "projected": projected, "days_left": left,
        "per_day": (goal - sales) / left if goal > sales and left > 0 else None,
        "tasks": {"total": total, "done": done, "on_time": on_time, "late": late},
        "week": {"done": week_done, "ahead": week_ahead},
    }


def lines(p: dict, lang: str = "he") -> list[dict]:
    """ויקי's words to the worker about their month — {tone: good | warn | tip, text}."""
    en = lang == "en"
    out: list[dict] = []
    sales, goal = p["sales"], p["goal"]
    if goal > 0 and sales >= goal:
        out.append({"tone": "good", "text": f"Well done — you passed your monthly goal! {_ils(sales)} of {_ils(goal)}." if en
                    else f"כל הכבוד — עברת את היעד החודשי שלך! {_ils(sales)} מתוך {_ils(goal)}."})
    elif goal > 0:
        pct = p["percent"]
        cheer_he = "כבר שלושה רבעים מהיעד! " if pct >= 75 else "עברת חצי מהיעד! " if pct >= 50 else ""
        cheer_en = "Three quarters of the goal already! " if pct >= 75 else "You passed half the goal! " if pct >= 50 else ""
        text = (f"{cheer_en}This month: {_ils(sales)} of your {_ils(goal)} goal ({pct}%)." if en
                else f"{cheer_he}החודש: {_ils(sales)} מתוך היעד שלך, {_ils(goal)} ({pct}%).")
        tone = "good" if pct >= 50 else "tip"
        if p["projected"] is not None:
            behind = p["projected"] < goal * 0.95
            pp = round(p["projected"] / goal * 100)
            if behind:
                tone = "warn" if pct < 50 else tone
                text += (f" At this pace you'll reach about {_ils(p['projected'])} ({pp}%)." if en
                         else f" בקצב הזה תגיע/י בערך ל-{_ils(p['projected'])} ({pp}%).")
            else:
                text += " At this pace you'll reach it." if en else " בקצב הזה תגיע/י אליו."
        out.append({"tone": tone, "text": text})
        if p["per_day"] is not None:
            out.append({"tone": "tip", "text":
                        f"To get there step by step: {_ils(goal - sales)} more in {p['days_left']} working days — about {_ils(p['per_day'])} a day." if en
                        else f"כדי להגיע ליעד בהדרגה: עוד {_ils(goal - sales)} ב-{p['days_left']} ימי עבודה — בערך {_ils(p['per_day'])} ליום."})
    else:
        out.append({"tone": "tip", "text": f"This month so far: {_ils(sales)} in sales. No monthly goal set for you yet." if en
                    else f"החודש עד עכשיו: {_ils(sales)} מכירות. עוד לא נקבע לך יעד חודשי."})

    t = p["tasks"]
    if t["total"]:
        if en:
            text = f"This month's tasks: {t['done']} of {t['total']} done, {t['on_time']} on time."
            text += f" {t['late']} still waiting — worth closing them today." if t["late"] else " All in order."
        else:
            text = f"המשימות החודש: {t['done']} מתוך {t['total']} בוצעו, {t['on_time']} מהן בזמן."
            text += f" {t['late']} עוד מחכות — שווה לסגור אותן היום." if t["late"] else " הכול מסודר."
        out.append({"tone": "warn" if t["late"] else "good", "text": text})

    w = p["week"]
    if w["done"] or w["ahead"]:
        def he(n: int) -> str:
            return "תור אחד" if n == 1 else f"{n} תורים"

        def en_(n: int) -> str:
            return f"{n} appointment{'' if n == 1 else 's'}"
        out.append({"tone": "tip", "text": f"This week: {en_(w['done'])} so far, {w['ahead']} more by the week's end." if en
                    else f"השבוע: {he(w['done'])} עד עכשיו" + (f", ועוד {he(w['ahead'])} עד סוף השבוע." if w["ahead"] else ".")})
    return out
