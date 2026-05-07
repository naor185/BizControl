from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, desc
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.incoming_message import IncomingMessage
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio_settings import StudioSettings
from app.services.message_worker import send_whatsapp_message

router = APIRouter(prefix="/inbox", tags=["Inbox"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ConversationOut(BaseModel):
    phone: str
    channel: str
    name: str | None
    client_id: str | None
    client_name: str | None
    last_message: str
    last_received_at: datetime
    unread_count: int


class MessageOut(BaseModel):
    id: str
    body: str
    direction: str   # "in" | "out"
    sent_at: datetime
    is_read: bool
    channel: str


class ReplyIn(BaseModel):
    phone: str
    body: str
    channel: str = "whatsapp"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    channel: Optional[str] = None,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Return one row per unique (sender, channel) pair, newest first."""
    q = select(IncomingMessage).where(IncomingMessage.studio_id == ctx.studio_id)
    if channel:
        q = q.where(IncomingMessage.channel == channel)

    # Group by (from_phone, channel) to get latest per conversation thread
    subq = (
        select(
            IncomingMessage.from_phone,
            IncomingMessage.channel,
            func.max(IncomingMessage.received_at).label("last_received_at"),
            func.count().filter(IncomingMessage.is_read == False).label("unread_count"),  # noqa: E712
        )
        .where(IncomingMessage.studio_id == ctx.studio_id)
    )
    if channel:
        subq = subq.where(IncomingMessage.channel == channel)
    subq = subq.group_by(IncomingMessage.from_phone, IncomingMessage.channel).subquery()

    rows = db.execute(
        select(subq, IncomingMessage.body, IncomingMessage.from_name, IncomingMessage.client_id)
        .join(
            IncomingMessage,
            (IncomingMessage.from_phone == subq.c.from_phone) &
            (IncomingMessage.channel == subq.c.channel) &
            (IncomingMessage.received_at == subq.c.last_received_at) &
            (IncomingMessage.studio_id == ctx.studio_id)
        )
        .order_by(desc(subq.c.last_received_at))
    ).all()

    result = []
    for row in rows:
        client_name = None
        if row.client_id:
            c = db.get(Client, row.client_id)
            client_name = c.full_name if c else None
        result.append(ConversationOut(
            phone=row.from_phone,
            channel=row.channel,
            name=row.from_name,
            client_id=str(row.client_id) if row.client_id else None,
            client_name=client_name,
            last_message=row.body,
            last_received_at=row.last_received_at,
            unread_count=row.unread_count,
        ))
    return result


@router.get("/messages/{phone}", response_model=list[MessageOut])
def get_conversation(
    phone: str,
    channel: str = "whatsapp",
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Return full thread for a (phone, channel) pair."""
    incoming = db.scalars(
        select(IncomingMessage)
        .where(
            IncomingMessage.studio_id == ctx.studio_id,
            IncomingMessage.from_phone == phone,
            IncomingMessage.channel == channel,
        )
        .order_by(IncomingMessage.received_at)
    ).all()

    for m in incoming:
        if not m.is_read:
            m.is_read = True
    db.commit()

    outgoing = db.scalars(
        select(MessageJob)
        .where(
            MessageJob.studio_id == ctx.studio_id,
            MessageJob.to_phone == phone,
            MessageJob.status == "sent",
        )
        .order_by(MessageJob.sent_at)
    ).all()

    msgs: list[MessageOut] = []
    for m in incoming:
        msgs.append(MessageOut(id=str(m.id), body=m.body, direction="in", sent_at=m.received_at, is_read=m.is_read, channel=channel))
    for m in outgoing:
        msgs.append(MessageOut(id=str(m.id), body=m.body, direction="out", sent_at=m.sent_at or m.scheduled_at, is_read=True, channel=channel))

    msgs.sort(key=lambda x: x.sent_at)
    return msgs


@router.post("/reply")
def reply_to_message(
    payload: ReplyIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Studio settings not found")

    now = datetime.now(timezone.utc)

    if payload.channel == "whatsapp":
        try:
            send_whatsapp_message(payload.phone, payload.body, settings)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"שגיאה בשליחה: {str(e)}")

        db.add(MessageJob(
            studio_id=ctx.studio_id,
            channel="whatsapp",
            to_phone=payload.phone,
            body=payload.body,
            scheduled_at=now,
            sent_at=now,
            status="sent",
        ))
        db.commit()

    elif payload.channel in ("instagram", "facebook"):
        if not settings.meta_page_access_token:
            raise HTTPException(status_code=400, detail="Meta page access token not configured")

        token = settings.meta_page_access_token
        recipient_id = payload.phone  # stores IGSID / PSID

        try:
            resp = httpx.post(
                "https://graph.facebook.com/v19.0/me/messages",
                params={"access_token": token},
                json={"recipient": {"id": recipient_id}, "message": {"text": payload.body}},
                timeout=10,
            )
            resp.raise_for_status()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Meta API error: {str(e)}")

        db.add(MessageJob(
            studio_id=ctx.studio_id,
            channel=payload.channel,
            to_phone=recipient_id,
            body=payload.body,
            scheduled_at=now,
            sent_at=now,
            status="sent",
        ))
        db.commit()

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported channel: {payload.channel}")

    return {"status": "sent"}


@router.get("/unread-count")
def unread_count(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    count = db.scalar(
        select(func.count()).where(
            IncomingMessage.studio_id == ctx.studio_id,
            IncomingMessage.is_read == False  # noqa: E712
        )
    )
    return {"unread": count or 0}
