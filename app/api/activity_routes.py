"""The business's activity log — the owner reads who did what, and when (app/services/activity_log.py)."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.audit_log import AuditLog
from app.services.activity_log import AREAS, SUPPORT

router = APIRouter(prefix="/activity", tags=["Activity log"])

_SUPPORT_KEY = "support"


@router.get("")
def activity(
    before: datetime | None = None,       # paging: the created_at of the last line shown
    person: str | None = None,            # a user's id, or "support"
    area: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """The owner only — the managers and the workers are the ones the log is about."""
    if ctx.role != "owner":
        raise HTTPException(status_code=403, detail="יומן הפעילות פתוח לבעל העסק בלבד")
    mine = (AuditLog.kind == "business", AuditLog.studio_id == str(ctx.studio_id))
    is_support = AuditLog.details["support"].astext == "true"
    q = select(AuditLog).where(*mine)
    if before is not None:
        q = q.where(AuditLog.created_at < before)
    if person == _SUPPORT_KEY:
        q = q.where(is_support)
    elif person:
        q = q.where(AuditLog.admin_id == person, ~is_support)
    if area in AREAS:
        q = q.where(AuditLog.action == area)
    rows = db.scalars(q.order_by(AuditLog.created_at.desc()).limit(limit + 1)).all()

    people = db.execute(
        select(AuditLog.admin_id, is_support.label("support"), func.max(AuditLog.details["name"].astext))
        .where(*mine).group_by(AuditLog.admin_id, is_support)
    ).all()
    return {
        "items": [{
            "id": str(r.id),
            "at": r.created_at.isoformat(),
            "person": _SUPPORT_KEY if (r.details or {}).get("support") else r.admin_id,
            "name": (r.details or {}).get("name") or r.admin_email,
            "area": r.action,
            "text": (r.details or {}).get("text") or "",
        } for r in rows[:limit]],
        "more": len(rows) > limit,
        "people": [{"id": pid, "name": name} for pid, name in sorted(
            {(_SUPPORT_KEY, SUPPORT) if sup else (pid, name or "") for pid, sup, name in people},
            key=lambda p: (p[0] == _SUPPORT_KEY, p[1]))],
        "areas": AREAS,
    }
