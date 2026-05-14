from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from uuid import UUID
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.db import get_db
from app.api.auth_routes import get_current_user
from app.models.notification import Notification

router = APIRouter(prefix="/notifications", tags=["Notifications"])


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    is_read: bool
    action_url: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=list[NotificationOut])
def list_notifications(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.scalars(
        select(Notification)
        .where(Notification.studio_id == current_user.studio_id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    ).all()
    return [NotificationOut(
        id=str(r.id),
        type=r.type,
        title=r.title,
        body=r.body,
        is_read=r.is_read,
        action_url=r.action_url,
        created_at=r.created_at,
    ) for r in rows]


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    count = db.scalar(
        select(func.count()).where(
            Notification.studio_id == current_user.studio_id,
            Notification.is_read.is_(False),
        )
    )
    return {"count": count or 0}


@router.post("/{notification_id}/read")
def mark_read(notification_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    n = db.get(Notification, UUID(notification_id))
    if not n or n.studio_id != current_user.studio_id:
        raise HTTPException(status_code=404)
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.scalars(
        select(Notification).where(
            Notification.studio_id == current_user.studio_id,
            Notification.is_read.is_(False),
        )
    ).all()
    for r in rows:
        r.is_read = True
    db.commit()
    return {"ok": True, "marked": len(rows)}


@router.delete("/{notification_id}")
def delete_notification(notification_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    n = db.get(Notification, UUID(notification_id))
    if not n or n.studio_id != current_user.studio_id:
        raise HTTPException(status_code=404)
    db.delete(n)
    db.commit()
    return {"ok": True}
