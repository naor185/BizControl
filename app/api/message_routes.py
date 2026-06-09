from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.message_job import MessageJob
from app.schemas.message_job import MessageJobOut

router = APIRouter(prefix="/messages", tags=["messages"])


class QuickSendIn(BaseModel):
    client_id: UUID
    body: str


@router.post("/quick-send")
def quick_send(
    payload: QuickSendIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """שליחת הודעת וואטסאפ מיידית ללקוח לפי ID."""
    from app.models.client import Client
    from app.models.studio_settings import StudioSettings
    from app.services.message_worker import send_whatsapp_message

    client = db.scalar(select(Client).where(Client.id == payload.client_id, Client.studio_id == ctx.studio_id))
    if not client:
        raise HTTPException(status_code=404, detail="לקוח לא נמצא")
    if not client.phone:
        raise HTTPException(status_code=400, detail="ללקוח זה אין מספר טלפון")

    settings = db.get(StudioSettings, ctx.studio_id)

    try:
        send_whatsapp_message(client.phone, payload.body, settings, db)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"שגיאה בשליחת ההודעה: {e}")

    now = datetime.now(timezone.utc)
    db.add(MessageJob(
        studio_id=ctx.studio_id,
        client_id=client.id,
        channel="whatsapp",
        to_phone=client.phone,
        body=payload.body,
        status="sent",
        sent_at=now,
        scheduled_at=now,
        reminder_type="manual",
    ))
    db.commit()

    return {"ok": True, "sent_to": client.phone, "client_name": client.full_name}

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

@router.post("/retry-all-failed")
def retry_all_failed(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    jobs = list(db.scalars(
        select(MessageJob).where(
            MessageJob.studio_id == ctx.studio_id,
            MessageJob.status == "failed",
        )
    ).all())
    for job in jobs:
        job.status = "pending"
        job.scheduled_at = now
        job.attempts = 0
        job.last_error = None
    db.commit()
    return {"reset": len(jobs)}


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
