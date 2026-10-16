"""The guided tours' state for the signed-in user (web: components/tour) — the owner, 2026-10-15: "a new business owner
learns the system step by step, inside it, with each step checked".

GET /api/tutorial            — {tour_id: {state, skipped}} — what this user has, nothing for a tour never started
GET /api/tutorial/checks     — {name, checks: {check: {applies, done}}} — each step's check, live against the real data
PUT /api/tutorial/{tour_id}  — {state?, skipped?} — started, closed, finished; the steps skipped (or, for a step that
                               only shows something, seen)

Whether a step was really done is not kept here: it is checked live against the data (the setup checklist, a sale at
the till, a deposit approved, a task given, a shift clocked, a task marked done), so a step can't be "done" without the
thing existing."""
from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.tutorial_progress import TutorialProgress

router = APIRouter(prefix="/tutorial", tags=["Tutorial"])

# web/src/lib/tours.ts — the owner's first steps, the owner's working day (2026-10-15), the messages to clients
# (2026-10-16), a worker's first steps
STEPS = {
    "owner_start": ("business", "service", "client", "appointment", "payment"),
    "owner_workday": ("pos_sale", "deposit", "worker_task"),
    "owner_messages": ("messages_where", "messages_off", "messages_text", "messages_optout"),   # 2026-10-16
    "worker_start": ("calendar", "clock", "task_done"),
}
TOURS = tuple(STEPS)
WORKERS = ("artist", "staff")


class TutorialIn(BaseModel):
    state: Literal["active", "dismissed", "done"] | None = None
    skipped: list[str] | None = Field(default=None, max_length=20)


def _out(row: TutorialProgress) -> dict:
    try:
        skipped = json.loads(row.skipped or "[]")
    except ValueError:
        skipped = []
    return {"state": row.state, "skipped": skipped}


@router.get("/checks")
def get_checks(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Each step's check for this user: whether it applies (in the plan, not "not relevant", someone to give a task
    to…) and whether it's done — live against the real data."""
    from app.models.appointment import Appointment
    from app.models.task import Task
    from app.models.task_completion import TaskCompletion
    from app.models.user import User
    from app.models.work_session import WorkSession
    from app.services import nfc_clock

    def exists(q) -> bool:
        return db.scalar(q.limit(1)) is not None

    me = db.get(User, ctx.user_id)
    name = ((me.display_name or "").strip().split(" ")[0] or None) if me else None
    if ctx.role in WORKERS:
        has_task = exists(select(Task.id).where(Task.studio_id == ctx.studio_id, Task.kind == "task",
                                                (Task.assignee_id.is_(None)) | (Task.assignee_id == ctx.user_id)))
        return {"name": name, "checks": {
            # every worker clocks, whatever their pay, where the plan has the clock (services/nfc_clock.clocks)
            "clock_in": {"applies": nfc_clock.clocks(db, ctx.studio_id, ctx.role),
                         "done": exists(select(WorkSession.id).where(WorkSession.user_id == ctx.user_id))},
            "task_done": {"applies": has_task,
                          "done": exists(select(TaskCompletion.id).where(TaskCompletion.done_by == ctx.user_id))},
        }}

    from app.api.dashboard_routes import _build_setup_items, _dismissed_ids
    from app.core.features import has_module
    from app.models.pos_transaction import PosTransaction
    items, meta = _build_setup_items(db, ctx)
    dismissed = _dismissed_ids(meta["settings"])
    out = {it["id"]: {"applies": it["id"] not in dismissed, "done": bool(it["done"])} for it in items}
    has_worker = exists(select(User.id).where(User.studio_id == ctx.studio_id, User.role.in_(("admin", "artist", "staff")),
                                              User.is_active == True))  # noqa: E712
    out["pos_sale"] = {"applies": has_module(db, ctx.studio_id, "pos"),
                       "done": exists(select(PosTransaction.id).where(PosTransaction.studio_id == ctx.studio_id))}
    out["deposit_approved"] = {"applies": True, "done": exists(select(Appointment.id).where(
        Appointment.studio_id == ctx.studio_id, Appointment.deposit_amount_cents > 0,
        Appointment.payment_verified_at.isnot(None)))}
    out["task_assigned"] = {"applies": has_worker, "done": exists(select(Task.id).where(
        Task.studio_id == ctx.studio_id, Task.kind == "task", Task.assignee_id.isnot(None)))}
    return {"name": name, "checks": out}


@router.get("")
def get_tutorial(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    rows = db.scalars(select(TutorialProgress).where(TutorialProgress.user_id == ctx.user_id)).all()
    return {r.tour_id: _out(r) for r in rows}


@router.put("/{tour_id}")
def set_tutorial(tour_id: str, body: TutorialIn, ctx: AuthContext = Depends(require_studio_ctx),
                 db: Session = Depends(get_db)):
    if tour_id not in TOURS:
        raise HTTPException(status_code=404, detail="אין הדרכה כזו")
    row = db.scalar(select(TutorialProgress).where(TutorialProgress.user_id == ctx.user_id,
                                                   TutorialProgress.tour_id == tour_id))
    if row is None:
        row = TutorialProgress(studio_id=ctx.studio_id, user_id=ctx.user_id, tour_id=tour_id, state="active", skipped="[]")
        db.add(row)
    if body.state is not None:
        row.state = body.state
    if body.skipped is not None:
        row.skipped = json.dumps([s for s in dict.fromkeys(body.skipped) if s in STEPS[tour_id]])
    db.commit()
    return _out(row)
