import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db
from app.repositories.goal_repository import GoalRepository
from app.schemas.monthly_goal import MonthlyGoalResponse, MonthlyGoalUpdate, GoalProgressResponse

router = APIRouter(prefix="/goals", tags=["Monthly Goals"])


def get_goal_repo(db: Session = Depends(get_db)) -> GoalRepository:
    return GoalRepository(db)


@router.get("/progress", response_model=GoalProgressResponse)
def get_goal_progress(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: GoalRepository = Depends(get_goal_repo),
):
    """Get the revenue progress for a specific month (defaults to current)."""
    today = date.today()
    y = year or today.year
    m = month or today.month
    
    return repo.get_progress(ctx.studio_id, y, m)


@router.post("/", response_model=MonthlyGoalResponse)
def set_monthly_goal(
    goal_data: MonthlyGoalUpdate,
    year: int = Query(...),
    month: int = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: GoalRepository = Depends(get_goal_repo),
):
    """Set or update the revenue goal for a specific month."""
    return repo.set_goal(ctx.studio_id, year, month, goal_data.target_amount)
