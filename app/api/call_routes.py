"""
BizControl Voice — Phase 1 call log API.

No live telephony provider is connected yet. Calls are logged manually by
staff after the fact (phone number, direction, duration, notes); the record
shape already includes recording_url/transcript/ai_summary (all null for now)
so Phase 2 (a real provider webhook) can fill them in without a schema change.

Every route requires the "voice" studio feature flag, toggled per studio by
superadmin only (app/api/superadmin_features_routes.py).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.features import require_feature
from app.models.call import Call
from app.models.client import Client
from app.models.user import User

router = APIRouter(prefix="/calls", tags=["Voice"], dependencies=[Depends(require_feature("voice"))])


def _call_out(c: Call, client: Client | None, answered_by: User | None) -> dict:
    return {
        "id": str(c.id),
        "direction": c.direction,
        "from_number": c.from_number,
        "to_number": c.to_number,
        "client_id": str(c.client_id) if c.client_id else None,
        "client_name": client.full_name if client else None,
        "user_id": str(c.user_id) if c.user_id else None,
        "answered_by_name": (answered_by.display_name or answered_by.email) if answered_by else None,
        "started_at": c.started_at.isoformat(),
        "ended_at": c.ended_at.isoformat() if c.ended_at else None,
        "duration_seconds": c.duration_seconds,
        "status": c.status,
        "recording_url": c.recording_url,
        "transcript": c.transcript,
        "ai_summary": c.ai_summary,
        "quoted_price_cents": c.quoted_price_cents,
        "notes": c.notes,
        "created_at": c.created_at.isoformat(),
    }


@router.get("")
def list_calls(
    direction: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    client_id: Optional[str] = Query(None),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    q = select(Call).where(Call.studio_id == ctx.studio_id)
    if direction:
        q = q.where(Call.direction == direction)
    if status_filter:
        q = q.where(Call.status == status_filter)
    if client_id:
        q = q.where(Call.client_id == uuid.UUID(client_id))
    q = q.order_by(Call.started_at.desc()).limit(200)

    calls = db.scalars(q).all()
    client_ids = {c.client_id for c in calls if c.client_id}
    user_ids = {c.user_id for c in calls if c.user_id}
    clients = {c.id: c for c in db.scalars(select(Client).where(Client.id.in_(client_ids)))} if client_ids else {}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids)))} if user_ids else {}

    return [_call_out(c, clients.get(c.client_id), users.get(c.user_id)) for c in calls]


@router.get("/{call_id}")
def get_call(call_id: str, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    call = db.get(Call, uuid.UUID(call_id))
    if not call or call.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="שיחה לא נמצאה")
    client = db.get(Client, call.client_id) if call.client_id else None
    user = db.get(User, call.user_id) if call.user_id else None
    return _call_out(call, client, user)


class CallLogIn(BaseModel):
    direction: str  # inbound | outbound
    phone: str
    started_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    status: str = "answered"
    notes: Optional[str] = None
    quoted_price_cents: Optional[int] = None


@router.post("", status_code=201)
def log_call(payload: CallLogIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if payload.direction not in ("inbound", "outbound"):
        raise HTTPException(status_code=400, detail="direction חייב להיות inbound או outbound")
    if payload.status not in ("answered", "missed", "voicemail"):
        raise HTTPException(status_code=400, detail="status לא תקין")

    phone = payload.phone.strip().replace("-", "").replace(" ", "")
    if not phone:
        raise HTTPException(status_code=400, detail="נדרש מספר טלפון")

    client = db.scalar(select(Client).where(Client.studio_id == ctx.studio_id, Client.phone == phone))

    studio_number = "" # studio's own number isn't tracked yet in Phase 1
    call = Call(
        studio_id=ctx.studio_id,
        direction=payload.direction,
        from_number=phone if payload.direction == "inbound" else studio_number,
        to_number=studio_number if payload.direction == "inbound" else phone,
        client_id=client.id if client else None,
        user_id=ctx.user_id,
        started_at=payload.started_at or datetime.now(timezone.utc),
        duration_seconds=payload.duration_seconds,
        status=payload.status,
        notes=payload.notes,
        quoted_price_cents=payload.quoted_price_cents,
    )
    db.add(call)
    db.commit()
    db.refresh(call)

    user = db.get(User, ctx.user_id)
    return _call_out(call, client, user)


class CallPatchIn(BaseModel):
    notes: Optional[str] = None
    status: Optional[str] = None
    quoted_price_cents: Optional[int] = None
    client_id: Optional[str] = None


@router.patch("/{call_id}")
def patch_call(call_id: str, payload: CallPatchIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    call = db.get(Call, uuid.UUID(call_id))
    if not call or call.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="שיחה לא נמצאה")

    if payload.notes is not None:
        call.notes = payload.notes
    if payload.status is not None:
        if payload.status not in ("answered", "missed", "voicemail"):
            raise HTTPException(status_code=400, detail="status לא תקין")
        call.status = payload.status
    if payload.quoted_price_cents is not None:
        call.quoted_price_cents = payload.quoted_price_cents
    if payload.client_id is not None:
        client = db.get(Client, uuid.UUID(payload.client_id))
        if not client or client.studio_id != ctx.studio_id:
            raise HTTPException(status_code=404, detail="לקוח לא נמצא")
        call.client_id = client.id

    db.commit()
    db.refresh(call)
    client = db.get(Client, call.client_id) if call.client_id else None
    user = db.get(User, call.user_id) if call.user_id else None
    return _call_out(call, client, user)


@router.post("/{call_id}/create-appointment")
def create_appointment_from_call(call_id: str, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Doesn't create the appointment itself — the calendar already has that
    flow. Just resolves (and creates if missing) the client so the frontend
    can deep-link into /calendar with them pre-selected."""
    call = db.get(Call, uuid.UUID(call_id))
    if not call or call.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="שיחה לא נמצאה")

    client = db.get(Client, call.client_id) if call.client_id else None
    if not client:
        phone = call.from_number if call.direction == "inbound" else call.to_number
        client = Client(studio_id=ctx.studio_id, full_name=phone, phone=phone)
        db.add(client)
        db.flush()
        call.client_id = client.id
        db.commit()

    return {"client_id": str(client.id), "client_name": client.full_name, "client_phone": client.phone}
