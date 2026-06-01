"""
Public Online Booking API — Phase 3B.
No auth required (public endpoints). Studio must have self_booking_enabled=True.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from fastapi import Depends

router = APIRouter(prefix="/book", tags=["PublicBooking"])


# ── Public studio info ────────────────────────────────────────────────────────

@router.get("/{slug}/info")
def get_booking_info(slug: str, db: Session = Depends(get_db)):
    """Public studio info for the booking page."""
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    from app.models.service import Service
    from app.models.user import User

    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa
    if not studio:
        raise HTTPException(404, "Studio not found")

    settings = db.get(StudioSettings, studio.id)
    if not settings or not getattr(settings, "self_booking_enabled", False):
        raise HTTPException(403, "Online booking is not enabled for this studio")

    services = db.scalars(
        select(Service).where(
            Service.studio_id == studio.id,
            Service.is_active == True,  # noqa
            Service.is_bookable_online == True,  # noqa
        ).order_by(Service.sort_order)
    ).all()

    artists = db.scalars(
        select(User).where(
            User.studio_id == studio.id,
            User.is_active == True,  # noqa
            User.role.in_(["artist", "owner", "admin"]),
        )
    ).all()

    return {
        "studio_id": str(studio.id),
        "studio_name": studio.name,
        "logo_url": studio.logo_url,
        "primary_color": studio.primary_color or "#7c3aed",
        "timezone": getattr(settings, "timezone", "Asia/Jerusalem") or "Asia/Jerusalem",
        "calendar_start_hour": getattr(settings, "calendar_start_hour", "09") or "09",
        "calendar_end_hour": getattr(settings, "calendar_end_hour", "21") or "21",
        "services": [
            {
                "id": str(s.id), "name": s.name,
                "duration_minutes": s.duration_minutes,
                "price_ils": s.price_cents / 100,
                "color": s.color,
                "description": s.description,
                "requires_consultation": s.requires_consultation,
                "staff_ids": [str(ss.user_id) for ss in s.staff],
            }
            for s in services
        ],
        "artists": [
            {"id": str(a.id), "name": a.display_name or a.email}
            for a in artists
        ],
    }


# ── Available slots ───────────────────────────────────────────────────────────

@router.get("/{slug}/slots")
def get_available_slots(
    slug: str,
    service_id: str = Query(...),
    artist_id: Optional[str] = Query(None),
    booking_date: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    """Return available time slots for a given service + date."""
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    from app.models.service import Service
    from app.models.appointment import Appointment
    import uuid as _uuid

    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa
    if not studio:
        raise HTTPException(404, "Studio not found")

    settings = db.get(StudioSettings, studio.id)
    if not settings or not getattr(settings, "self_booking_enabled", False):
        raise HTTPException(403, "Online booking not enabled")

    service = db.get(Service, _uuid.UUID(service_id))
    if not service or service.studio_id != studio.id:
        raise HTTPException(404, "Service not found")

    # Parse date
    try:
        target_date = date.fromisoformat(booking_date)
    except ValueError:
        raise HTTPException(400, "Invalid date format")

    # Don't allow past dates
    today = datetime.now(timezone.utc).date()
    if target_date < today:
        return {"slots": [], "date": booking_date}

    tz_str = getattr(settings, "timezone", "Asia/Jerusalem") or "Asia/Jerusalem"
    try:
        tz = ZoneInfo(tz_str)
    except Exception:
        import pytz
        tz = pytz.timezone(tz_str)

    start_hour = int((getattr(settings, "calendar_start_hour", "09") or "09").split(":")[0])
    end_hour = int((getattr(settings, "calendar_end_hour", "21") or "21").split(":")[0])
    slot_duration = service.duration_minutes
    slot_step = min(slot_duration, 30)  # step by 30min or less

    # Load existing appointments for that day
    day_start = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    existing_q = select(Appointment).where(
        Appointment.studio_id == studio.id,
        Appointment.status.in_(["scheduled", "done"]),
        Appointment.starts_at >= day_start.astimezone(timezone.utc),
        Appointment.starts_at < day_end.astimezone(timezone.utc),
    )
    if artist_id:
        existing_q = existing_q.where(Appointment.artist_id == _uuid.UUID(artist_id))
    existing = db.scalars(existing_q).all()

    # Build busy intervals
    busy: list[tuple[datetime, datetime]] = [
        (a.starts_at.replace(tzinfo=timezone.utc), a.ends_at.replace(tzinfo=timezone.utc))
        for a in existing
        if a.ends_at
    ]

    # Generate slots
    slots = []
    current = datetime(target_date.year, target_date.month, target_date.day,
                       start_hour, 0, 0, tzinfo=tz).astimezone(timezone.utc)
    end_time = datetime(target_date.year, target_date.month, target_date.day,
                        end_hour, 0, 0, tzinfo=tz).astimezone(timezone.utc)

    while current + timedelta(minutes=slot_duration) <= end_time:
        slot_end = current + timedelta(minutes=slot_duration)
        # Check if free
        is_free = all(
            slot_end <= b_start or current >= b_end
            for b_start, b_end in busy
        )
        if is_free:
            local_time = current.astimezone(tz)
            slots.append({
                "starts_at": current.isoformat(),
                "ends_at": slot_end.isoformat(),
                "label": local_time.strftime("%H:%M"),
            })
        current += timedelta(minutes=slot_step)

    return {"slots": slots, "date": booking_date, "service_duration": slot_duration}


# ── Create booking ────────────────────────────────────────────────────────────

class BookingRequest(BaseModel):
    service_id: str
    artist_id: Optional[str] = None
    starts_at: str           # ISO datetime
    ends_at: str             # ISO datetime
    client_name: str
    client_phone: str
    client_email: Optional[str] = None
    notes: Optional[str] = None


@router.post("/{slug}/book")
def create_booking(slug: str, payload: BookingRequest, db: Session = Depends(get_db)):
    """Create an appointment from a public booking request."""
    import uuid as _uuid
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    from app.models.service import Service
    from app.models.client import Client
    from app.models.appointment import Appointment
    from app.models.message_job import MessageJob

    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa
    if not studio:
        raise HTTPException(404, "Studio not found")

    settings = db.get(StudioSettings, studio.id)
    if not settings or not getattr(settings, "self_booking_enabled", False):
        raise HTTPException(403, "Online booking not enabled")

    service = db.get(Service, _uuid.UUID(payload.service_id))
    if not service or service.studio_id != studio.id:
        raise HTTPException(404, "Service not found")

    # Find or create client by phone
    client = db.scalar(
        select(Client).where(
            Client.studio_id == studio.id,
            Client.phone == payload.client_phone,
        )
    )
    if not client:
        client = Client(
            studio_id=studio.id,
            full_name=payload.client_name,
            phone=payload.client_phone,
            email=payload.client_email,
        )
        db.add(client)
        db.flush()

    starts = datetime.fromisoformat(payload.starts_at)
    ends = datetime.fromisoformat(payload.ends_at)

    # Check not already booked (double-booking protection)
    conflict = db.scalar(
        select(Appointment).where(
            Appointment.studio_id == studio.id,
            Appointment.status == "scheduled",
            Appointment.starts_at < ends,
            Appointment.ends_at > starts,
        )
    )
    if conflict:
        raise HTTPException(409, "זמן זה כבר תפוס. אנא בחר זמן אחר.")

    appt = Appointment(
        studio_id=studio.id,
        client_id=client.id,
        client_name=payload.client_name,
        client_phone=payload.client_phone,
        service_id=service.id,
        title=service.name,
        starts_at=starts,
        ends_at=ends,
        status="scheduled",
        notes=payload.notes or f"קביעה אונליין",
        artist_id=_uuid.UUID(payload.artist_id) if payload.artist_id else None,
        color=service.color,
    )
    db.add(appt)
    db.flush()

    # Send confirmation to client
    if client.phone:
        tz_str = getattr(settings, "timezone", "Asia/Jerusalem") or "Asia/Jerusalem"
        import pytz
        tz = pytz.timezone(tz_str)
        local_start = starts.astimezone(tz)
        body = (
            f"שלום {payload.client_name}! ✅\n\n"
            f"התור שלך נקבע בהצלחה!\n\n"
            f"📋 שירות: {service.name}\n"
            f"📅 תאריך: {local_start.strftime('%d/%m/%Y')}\n"
            f"⏰ שעה: {local_start.strftime('%H:%M')}\n\n"
            f"ב{studio.name} 🙏"
        )
        db.add(MessageJob(
            studio_id=studio.id, client_id=client.id,
            appointment_id=appt.id,
            channel="whatsapp", to_phone=client.phone,
            body=body, scheduled_at=datetime.now(timezone.utc),
            status="pending", reminder_type="booking_confirmation",
        ))

    # Notify studio (owner/admin)
    if getattr(settings, "notification_phone", None):
        tz_str = getattr(settings, "timezone", "Asia/Jerusalem") or "Asia/Jerusalem"
        import pytz
        tz = pytz.timezone(tz_str)
        local_start = starts.astimezone(tz)
        body = (
            f"📅 קביעה חדשה אונליין!\n\n"
            f"לקוח: {payload.client_name} ({payload.client_phone})\n"
            f"שירות: {service.name}\n"
            f"תאריך: {local_start.strftime('%d/%m/%Y %H:%M')}"
        )
        db.add(MessageJob(
            studio_id=studio.id,
            channel="whatsapp", to_phone=settings.notification_phone,
            body=body, scheduled_at=datetime.now(timezone.utc),
            status="pending", reminder_type="booking_new_notification",
        ))

    db.commit()
    return {
        "appointment_id": str(appt.id),
        "status": "confirmed",
        "message": f"התור נקבע בהצלחה ל-{service.name}",
    }


# ── Public wait-list join ─────────────────────────────────────────────────────

class WaitListJoinIn(BaseModel):
    client_name: str
    client_phone: str
    service_id: Optional[str] = None
    notes: Optional[str] = None


@router.post("/{slug}/wait-list", status_code=201)
def public_join_wait_list(slug: str, payload: WaitListJoinIn, db: Session = Depends(get_db)):
    """Public endpoint — client self-joins the wait list for a studio."""
    from app.models.studio import Studio
    import uuid as _uuid2

    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa
    if not studio:
        raise HTTPException(404, "Studio not found")

    from app.models.wait_list import WaitListEntry
    entry = WaitListEntry(
        studio_id=studio.id,
        client_name=payload.client_name.strip(),
        client_phone=payload.client_phone.strip(),
        service_id=_uuid2.UUID(payload.service_id) if payload.service_id else None,
        notes=payload.notes,
        status="waiting",
    )
    db.add(entry)
    db.commit()
    return {"message": "נוספת לרשימת ההמתנה! נודיע לך בWhatsApp כשיתפנה מקום 📅"}
