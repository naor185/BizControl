"""The guided tours' state for the signed-in user (web: components/tour) — the owner, 2026-10-15: "a new business owner
learns the system step by step, inside it, with each step checked".

GET /api/tutorial            — {tour_id: {state, skipped}} — what this user has, nothing for a tour never started
PUT /api/tutorial/{tour_id}  — {state?, skipped?} — started, closed, finished; the steps skipped

Whether a step was really done is not kept here: the tour checks it live against the setup checklist
(GET /api/dashboard/setup-progress), so a step can't be "done" without the thing existing."""
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

TOURS = ("owner_start",)                      # web/src/lib/tours.ts
STEPS = {"owner_start": ("business", "service", "client", "appointment", "payment")}


class TutorialIn(BaseModel):
    state: Literal["active", "dismissed", "done"] | None = None
    skipped: list[str] | None = Field(default=None, max_length=20)


def _out(row: TutorialProgress) -> dict:
    try:
        skipped = json.loads(row.skipped or "[]")
    except ValueError:
        skipped = []
    return {"state": row.state, "skipped": skipped}


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
