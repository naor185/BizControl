"""
Internal API for managing booking requests (pending approval).
Accessible to authenticated studio staff (owner, admin, artist).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from app.utils.logger import get_logger

log = get_logger(__name__)
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth_deps import get_current_user
from app.models.user import User
from app.models.booking_request import BookingRequest
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.studio_settings import StudioSettings
from app.models.message_job import MessageJob

router = APIRouter(prefix="/booking-requests", tags=["BookingRequests"])


class BookingRequestOut(BaseModel):
    id: str
    artist_id: Optional[str]
    artist_name: Optional[str]
    client_name: str
    client_phone: str
    client_email: Optional[str]
    service_note: Optional[str]
    requested_at: datetime
    requested_at_local: str
    status: str
    rejection_reason: Optional[str]
    reviewed_at: Optional[datetime]
    appointment_id: Optional[str]
    created_at: datetime


def _fmt_local(dt: datetime, tz_str: str) -> str:
    from zoneinfo import ZoneInfo
    return dt.astimezone(ZoneInfo(tz_str or "Asia/Jerusalem")).strftime("%d/%m/%Y %H:%M")


def _out(req: BookingRequest, settings: StudioSettings) -> BookingRequestOut:
    artist_name = None
    if req.artist:
        artist_name = req.artist.display_name or req.artist.email
    return BookingRequestOut(
        id=str(req.id),
        artist_id=str(req.artist_id) if req.artist_id else None,
        artist_name=artist_name,
        client_name=req.client_name,
        client_phone=req.client_phone,
        client_email=req.client_email,
        service_note=req.service_note,
        requested_at=req.requested_at,
        requested_at_local=_fmt_local(req.requested_at, settings.timezone or "Asia/Jerusalem"),
        status=req.status,
        rejection_reason=req.rejection_reason,
        reviewed_at=req.reviewed_at,
        appointment_id=str(req.appointment_id) if req.appointment_id else None,
        created_at=req.created_at,
    )


@router.get("", response_model=list[BookingRequestOut])
def list_requests(
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(BookingRequest).where(BookingRequest.studio_id == current_user.studio_id)
    if status:
        q = q.where(BookingRequest.status == status)
    else:
        # Default: show pending first, then recent others
        q = q.order_by(
            BookingRequest.status.desc(),  # 'pending' > 'approved'/'rejected' alphabetically
            BookingRequest.created_at.desc()
        )
    reqs = db.scalars(q).all()
    settings = db.get(StudioSettings, current_user.studio_id)
    return [_out(r, settings) for r in reqs]


class ApproveIn(BaseModel):
    pass


class RejectIn(BaseModel):
    reason: Optional[str] = None


@router.patch("/{request_id}/approve")
def approve_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    req = db.scalar(select(BookingRequest).where(
        BookingRequest.id == request_id,
        BookingRequest.studio_id == current_user.studio_id,
    ))
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")

    settings = db.get(StudioSettings, current_user.studio_id)
    slot_min = settings.self_booking_slot_minutes or 60

    # Check slot still free
    conflict = db.scalar(
        select(Appointment).where(
            Appointment.studio_id == current_user.studio_id,
            Appointment.artist_id == req.artist_id,
            Appointment.starts_at == req.requested_at,
            Appointment.status != "canceled",
        )
    )
    if conflict:
        raise HTTPException(status_code=409, detail="Slot no longer available — choose another time")

    # Find or create client
    client = db.scalar(select(Client).where(
        Client.studio_id == current_user.studio_id,
        Client.phone == req.client_phone,
    ))
    if not client and req.client_email:
        client = db.scalar(select(Client).where(
            Client.studio_id == current_user.studio_id,
            Client.email == req.client_email,
        ))
    if not client:
        client = Client(
            id=uuid.uuid4(),
            studio_id=current_user.studio_id,
            full_name=req.client_name,
            phone=req.client_phone,
            email=req.client_email,
            notes="נרשם דרך דף ההזמנה המקוון",
        )
        db.add(client)
        db.flush()

    ends_at = req.requested_at + timedelta(minutes=slot_min)
    appt = Appointment(
        id=uuid.uuid4(),
        studio_id=current_user.studio_id,
        client_id=client.id,
        artist_id=req.artist_id,
        title=f"הזמנה מקוונת — {req.client_name}",
        starts_at=req.requested_at,
        ends_at=ends_at,
        status="scheduled",
        notes=req.service_note or "",
    )
    db.add(appt)
    db.flush()

    # Update request
    now = datetime.now(timezone.utc)
    req.status = "approved"
    req.reviewed_by_id = current_user.id
    req.reviewed_at = now
    req.appointment_id = appt.id

    # Send confirmation to client
    local_time = _fmt_local(req.requested_at, settings.timezone or "Asia/Jerusalem")
    artist_name = req.artist.display_name if req.artist else "הצוות"
    confirm_msg = (
        f"✅ התור שלך אושר!\n"
        f"👤 {req.client_name}, התור שלך עם {artist_name} אושר.\n"
        f"📅 {local_time}\n"
        f"📝 {req.service_note or ''}\n\n"
        f"מחכים לך! 🙏"
    )
    if req.client_phone:
        db.add(MessageJob(
            studio_id=current_user.studio_id,
            channel="whatsapp",
            to_phone=req.client_phone,
            body=confirm_msg,
            scheduled_at=now,
            status="pending",
        ))

    # Enqueue confirmation automation
    try:
        from app.crud.automation import enqueue_confirmation_message
        enqueue_confirmation_message(db, appt, artist_name=artist_name)
    except Exception as e:
        log.error("[booking-approve] automation failed: %s", e)

    db.commit()
    return {"status": "approved", "appointment_id": str(appt.id)}


@router.patch("/{request_id}/reject")
def reject_request(
    request_id: uuid.UUID,
    payload: RejectIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    req = db.scalar(select(BookingRequest).where(
        BookingRequest.id == request_id,
        BookingRequest.studio_id == current_user.studio_id,
    ))
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req.status}")

    settings = db.get(StudioSettings, current_user.studio_id)
    now = datetime.now(timezone.utc)
    req.status = "rejected"
    req.rejection_reason = payload.reason or None
    req.reviewed_by_id = current_user.id
    req.reviewed_at = now

    # Notify client
    local_time = _fmt_local(req.requested_at, settings.timezone or "Asia/Jerusalem")
    reason_line = f"\nסיבה: {payload.reason}" if payload.reason else ""
    reject_msg = (
        f"❌ בקשת התור שלך ל-{local_time} לא אושרה.{reason_line}\n\n"
        f"ניתן לשריין זמן אחר דרך האתר שלנו. 🙏"
    )
    if req.client_phone:
        db.add(MessageJob(
            studio_id=current_user.studio_id,
            channel="whatsapp",
            to_phone=req.client_phone,
            body=reject_msg,
            scheduled_at=now,
            status="pending",
        ))

    db.commit()
    return {"status": "rejected"}
