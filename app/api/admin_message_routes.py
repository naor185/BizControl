"""
The message queue — the superadmin's (owner, 2026-10-11: "the queue shouldn't be visible to the business owner; the
superadmin's system should get it"). Every business's outgoing WhatsApp / e-mail / push, its status and error, and
retry or cancel. A business owner is told in the bell what didn't reach whom (message_worker._notify_message_failed)
and the superadmin gets an e-mail (integration_alerts.alert_account_failure).
GET  /api/admin/messages                    — ?studio_id= &status= &limit=
POST /api/admin/messages/{id}/retry
POST /api/admin/messages/{id}/cancel
POST /api/admin/messages/retry-all-failed   — ?studio_id= — only the last RETRY_ALL_HOURS: an old failure retried
                                              sends something stale (it did: June's reminders in October)
A message that belongs before an appointment that has begun is never sent (message_worker.BEFORE_APPOINTMENT).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.superadmin_routes import _audit, require_superadmin
from app.core.database import get_db
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.user import User

router = APIRouter(prefix="/admin/messages", tags=["SuperAdmin"])
RETRY_ALL_HOURS = 48


def _uuid(value: str | None, what: str):
    if value is None:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(404, f"{what} לא נמצא")


def _out(job: MessageJob, names: dict) -> dict:
    return {"id": str(job.id), "studio_id": str(job.studio_id), "studio_name": names.get(job.studio_id, ""),
            "channel": job.channel, "to": job.to_phone, "subject": job.subject, "body": job.body,
            "reminder_type": job.reminder_type, "status": job.status, "attempts": job.attempts,
            "last_error": job.last_error, "scheduled_at": job.scheduled_at.isoformat() if job.scheduled_at else None,
            "sent_at": job.sent_at.isoformat() if job.sent_at else None,
            "created_at": job.created_at.isoformat() if job.created_at else None}


@router.get("")
def list_messages(studio_id: Optional[str] = None, status: Optional[str] = None, limit: int = 200,
                  admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    q = select(MessageJob)
    sid = _uuid(studio_id, "העסק")
    if sid:
        q = q.where(MessageJob.studio_id == sid)
    if status:
        q = q.where(MessageJob.status == status)
    jobs = db.scalars(q.order_by(MessageJob.created_at.desc()).limit(min(max(int(limit), 1), 500))).all()
    names = dict(db.execute(select(Studio.id, Studio.name).where(Studio.id.in_({j.studio_id for j in jobs}))).all()) if jobs else {}
    return [_out(j, names) for j in jobs]


def _job(db: Session, job_id: str) -> MessageJob:
    job = db.get(MessageJob, _uuid(job_id, "ההודעה"))
    if job is None:
        raise HTTPException(404, "ההודעה לא נמצאה")
    return job


@router.post("/{job_id}/retry")
def retry_message(job_id: str, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    job = _job(db, job_id)
    if job.status in ("sent", "canceled"):
        raise HTTPException(400, "אפשר לנסות שוב רק הודעה שנכשלה או ממתינה")
    from app.models.appointment import Appointment
    from app.services.message_worker import BEFORE_APPOINTMENT
    appt = db.get(Appointment, job.appointment_id) if job.appointment_id else None
    if job.reminder_type in BEFORE_APPOINTMENT and appt is not None and appt.starts_at <= datetime.now(timezone.utc):
        raise HTTPException(400, "התור כבר התחיל — שליחה עכשיו רק תבלבל את הלקוח")
    job.status, job.scheduled_at, job.attempts, job.last_error = "pending", datetime.now(timezone.utc), 0, None
    _audit(db, admin, "message_retried", db.get(Studio, job.studio_id), {"message_id": job_id})
    db.commit()
    return {"retried": job_id}


@router.post("/{job_id}/cancel")
def cancel_message(job_id: str, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    job = _job(db, job_id)
    if job.status == "sent":
        raise HTTPException(400, "אי אפשר לבטל הודעה שכבר נשלחה")
    job.status = "canceled"
    _audit(db, admin, "message_canceled", db.get(Studio, job.studio_id), {"message_id": job_id})
    db.commit()
    return {"canceled": job_id}


@router.post("/retry-all-failed")
def retry_all_failed(studio_id: Optional[str] = None, admin: User = Depends(require_superadmin),
                     db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    q = select(MessageJob).where(MessageJob.status == "failed",
                                 MessageJob.created_at >= now - timedelta(hours=RETRY_ALL_HOURS))
    sid = _uuid(studio_id, "העסק")
    if sid:
        q = q.where(MessageJob.studio_id == sid)
    from app.models.appointment import Appointment
    from app.services.message_worker import BEFORE_APPOINTMENT
    jobs = [j for j in db.scalars(q).all() if not (           # not a reminder for an appointment that already began
        j.reminder_type in BEFORE_APPOINTMENT and j.appointment_id
        and (a := db.get(Appointment, j.appointment_id)) is not None and a.starts_at <= now)]
    for job in jobs:
        job.status, job.scheduled_at, job.attempts, job.last_error = "pending", now, 0, None
    _audit(db, admin, "messages_retried", db.get(Studio, sid) if sid else None, {"count": len(jobs)})
    db.commit()
    return {"reset": len(jobs)}
