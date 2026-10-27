"""Each worker's sales goal and their month — services/worker_progress (the owner, 2026-10-27: "a sales goal for each
worker, and ויקי gives the worker an analysis of their progress").

GET /api/workers/progress          — everyone's month: the owner, and a manager the owner allowed the team
PUT /api/workers/{user_id}/goal    — a worker's goal for this month (or the year / month given) — the same
GET /api/workers/me                — my own month, and ויקי's words about it — any signed-in team member
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.permissions import require_permission
from app.services import worker_progress as wp

router = APIRouter(prefix="/workers", tags=["Workers"])


def _lang(request: Request) -> str:
    from app.core.i18n import lang_of
    return lang_of(request.headers.get("x-lang"))


class GoalIn(BaseModel):
    target: float = Field(..., ge=0, le=10_000_000)          # ₪
    year: Optional[int] = Field(default=None, ge=2020, le=2100)
    month: Optional[int] = Field(default=None, ge=1, le=12)


@router.get("/progress")
def everyone(ctx: AuthContext = Depends(require_permission("team")), db: Session = Depends(get_db)):
    """The team's month — each active member but the owner."""
    from app.models.user import User
    team = db.scalars(select(User).where(User.studio_id == ctx.studio_id, User.is_active.is_(True),
                                         User.role.in_(("admin", "artist", "staff")))
                      .order_by(User.display_name)).all()
    return [wp.progress(db, ctx.studio_id, u.id) for u in team]


@router.put("/{user_id}/goal")
def set_goal(user_id: UUID, body: GoalIn, ctx: AuthContext = Depends(require_permission("team")),
             db: Session = Depends(get_db)):
    from app.models.user import User
    from app.services.activity_log import record
    user = db.get(User, user_id)
    if user is None or user.studio_id != ctx.studio_id:          # another business's — as if it weren't there
        raise HTTPException(status_code=404, detail="איש הצוות לא נמצא")
    today = datetime.now(timezone.utc).astimezone(wp.IL).date()
    year, month = body.year or today.year, body.month or today.month
    wp.set_goal(db, ctx.studio_id, user_id, year, month, round(body.target * 100))
    record(db, ctx, "team", f"יעד מכירות ל{user.display_name or user.email}: {wp._ils(body.target)} ל-{month}/{year}")
    return wp.progress(db, ctx.studio_id, user_id)


@router.get("/me")
def mine(request: Request, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """My month — sales, my goal, my tasks, my week — and ויקי's words about it."""
    p = wp.progress(db, ctx.studio_id, ctx.user_id)
    return {**p, "lines": wp.lines(p, _lang(request))}
