from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.message_job import MessageJob
from app.schemas.message_job import MessageJobOut

router = APIRouter(prefix="/messages", tags=["messages"])

@router.get("", response_model=list[MessageJobOut])
def list_messages(
    status: str | None = None,         # pending/sent/failed/canceled
    limit: int = 100,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    q = select(MessageJob).where(MessageJob.studio_id == ctx.studio_id)

    if status:
        q = q.where(MessageJob.status == status)

    q = q.order_by(MessageJob.created_at.desc()).limit(min(int(limit), 200))
    return list(db.scalars(q).all())

@router.post("/{job_id}/retry", response_model=MessageJobOut)
def retry_message(
    job_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    job = db.scalar(select(MessageJob).where(MessageJob.id == job_id, MessageJob.studio_id == ctx.studio_id))
    if not job:
        raise HTTPException(status_code=404, detail="Message job not found")

    # לא מריצים retry על sent/canceled
    if job.status in ("sent", "canceled"):
        raise HTTPException(status_code=400, detail=f"Cannot retry status={job.status}")

    job.status = "pending"
    job.scheduled_at = datetime.now(timezone.utc)
    job.last_error = None
    db.commit()
    db.refresh(job)
    return job

@router.post("/{job_id}/cancel", response_model=MessageJobOut)
def cancel_message(
    job_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    job = db.scalar(select(MessageJob).where(MessageJob.id == job_id, MessageJob.studio_id == ctx.studio_id))
    if not job:
        raise HTTPException(status_code=404, detail="Message job not found")

    if job.status == "sent":
        raise HTTPException(status_code=400, detail="Cannot cancel sent message")

    job.status = "canceled"
    db.commit()
    db.refresh(job)
    return job
