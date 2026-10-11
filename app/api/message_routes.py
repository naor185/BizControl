from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.message_job import MessageJob

router = APIRouter(prefix="/messages", tags=["messages"])
# The queue itself (list / retry / cancel) is the superadmin's — app/api/admin_message_routes.py (owner, 2026-10-11).


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
    from app.services import message_quota
    if not message_quota.can_send(db, ctx.studio_id):
        raise HTTPException(status_code=429, detail=f"{message_quota.OUT}. אפשר לשלוח מהוואטסאפ שלך.")

    try:
        send_whatsapp_message(client.phone, payload.body, settings, db)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"שגיאה בשליחת ההודעה: {e}")
    message_quota.count_sent(db, ctx.studio_id)

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

