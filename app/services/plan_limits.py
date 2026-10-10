"""
A plan's count limits (owner, 2026-10-10) — how many at most at any time, not a month:
- staff: every active user of the business, the owner included — עסק קטן 2, פרו 5, חברה גדולה no limit;
- branches: businesses linked into one organization — חברה גדולה up to 3.
The numbers are the plan's (plan_modules, period 'lifetime'); a superadmin override (studio_modules) wins.
Only adding is stopped — nobody already in is ever removed. The superadmin adding by hand isn't stopped.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

STAFF_ROLES = ("owner", "admin", "artist", "staff")


def _limit(db: Session, studio_id, key: str) -> int | None:
    from app.core.features import effective_quota
    from app.models.studio import Studio
    studio = db.get(Studio, studio_id)
    return effective_quota(db, studio_id, (studio.subscription_plan if studio else None) or "free", key)["limit"]


def staff_seats(db: Session, studio_id) -> dict:
    """{used, limit (None — no limit), left}."""
    from app.models.user import User
    used = db.scalar(select(func.count()).select_from(User).where(
        User.studio_id == studio_id, User.is_active.is_(True), User.role.in_(STAFF_ROLES))) or 0
    limit = _limit(db, studio_id, "staff_seats")
    return {"used": used, "limit": limit, "left": None if limit is None else max(0, limit - used)}


def check_staff_seat(db: Session, studio_id) -> None:
    """Before someone joins the business's staff (or comes back to it)."""
    seats = staff_seats(db, studio_id)
    if seats["limit"] is not None and seats["used"] >= seats["limit"]:
        raise HTTPException(403, f"המסלול שלך כולל עד {seats['limit']} אנשי צוות, כולל בעל העסק. "
                                 "כדי להוסיף עוד — משדרגים מסלול בדף המנוי.")


def check_branches(db: Session, main_studio_id, count: int) -> None:
    """Before linking `count` businesses into one organization — by the main business's plan."""
    limit = _limit(db, main_studio_id, "multi_location")
    if limit is not None and count > limit:
        raise HTTPException(400, f"המסלול של העסק הראשי כולל עד {limit} סניפים — ביקשת לחבר {count}.")
