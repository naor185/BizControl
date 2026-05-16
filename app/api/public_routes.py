import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, select
from datetime import datetime, date, timedelta, timezone
from typing import Optional

from app.core.database import get_db
from app.models.studio import Studio
from app.models.user import User
from app.models.client import Client
from app.models.appointment import Appointment
from app.models.studio_settings import StudioSettings
from app.models.booking_request import BookingRequest
from app.models.lead import Lead
from app.crud.client import _handle_new_club_member
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/public", tags=["Public"])

class PublicLandingInfo(BaseModel):
    studio_id: str
    studio_name: str
    theme_primary_color: str
    theme_secondary_color: str
    logo_filename: str | None = None
    landing_page_active_template: int
    landing_page_title: str | None = None
    landing_page_description: str | None = None
    landing_page_bg_image: str | None = None
    landing_page_title_font: str = "Heebo"
    landing_page_desc_font: str = "Assistant"
    landing_page_image_1: str | None = None
    landing_page_image_2: str | None = None
    landing_page_image_3: str | None = None
    points_on_signup: int = 0

class PublicStudioInfo(BaseModel):
    id: str
    name: str
    theme_primary_color: str
    theme_secondary_color: str
    logo_filename: str | None
    landing_page_active_template: int
    landing_page_title: str | None
    landing_page_description: str | None
    landing_page_bg_image: str | None = None
    landing_page_title_font: str = "Heebo"
    landing_page_desc_font: str = "Assistant"
    landing_page_image_1: str | None = None
    landing_page_image_2: str | None = None
    landing_page_image_3: str | None = None

class PublicPaymentInfo(BaseModel):
    id: str
    client_name: str
    appointment_title: str
    starts_at: datetime
    deposit_amount_cents: int
    bit_link: str | None
    paybox_link: str | None
    theme_primary_color: str
    theme_secondary_color: str
    logo_filename: str | None

class PaymentConfirmRequest(BaseModel):
    notes: str | None = None

class ClientJoinRequest(BaseModel):
    full_name: str
    phone: str
    email: EmailStr | None = None
    birth_date: date | None = None
    marketing_consent: bool = True
    utm_source: str | None = None
    utm_campaign: str | None = None
    utm_medium: str | None = None
    service_interest: str | None = None

@router.get("/landing/{slug}", response_model=PublicLandingInfo)
def get_landing_by_slug(slug: str, db: Session = Depends(get_db)):
    studio = db.query(Studio).filter(Studio.slug == slug, Studio.is_active == True).first()  # noqa: E712
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    settings = db.get(StudioSettings, studio.id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")
    return PublicLandingInfo(
        studio_id=str(studio.id),
        studio_name=studio.name,
        theme_primary_color=settings.theme_primary_color or "#000000",
        theme_secondary_color=settings.theme_secondary_color or "#ffffff",
        logo_filename=settings.logo_filename,
        landing_page_active_template=settings.landing_page_active_template or 1,
        landing_page_title=settings.landing_page_title,
        landing_page_description=settings.landing_page_description,
        landing_page_bg_image=settings.landing_page_bg_image,
        landing_page_title_font=settings.landing_page_title_font or "Heebo",
        landing_page_desc_font=settings.landing_page_desc_font or "Assistant",
        landing_page_image_1=settings.landing_page_image_1,
        landing_page_image_2=settings.landing_page_image_2,
        landing_page_image_3=settings.landing_page_image_3,
        points_on_signup=settings.points_on_signup or 0,
    )

@router.get("/studio/{studio_id}", response_model=PublicStudioInfo)
def get_public_studio_info(studio_id: str, db: Session = Depends(get_db)):
    studio = db.query(Studio).filter(Studio.id == studio_id).first()
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    
    settings = db.get(StudioSettings, studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    return PublicStudioInfo(
        id=studio.id,
        name=studio.name,
        theme_primary_color=settings.theme_primary_color,
        theme_secondary_color=settings.theme_secondary_color,
        logo_filename=settings.logo_filename,
        landing_page_active_template=settings.landing_page_active_template,
        landing_page_title=settings.landing_page_title,
        landing_page_description=settings.landing_page_description,
        landing_page_bg_image=settings.landing_page_bg_image,
        landing_page_title_font=settings.landing_page_title_font or "Heebo",
        landing_page_desc_font=settings.landing_page_desc_font or "Assistant",
        landing_page_image_1=settings.landing_page_image_1,
        landing_page_image_2=settings.landing_page_image_2,
        landing_page_image_3=settings.landing_page_image_3
    )

@router.post("/studio/{studio_id}/join")
def join_studio(studio_id: str, payload: ClientJoinRequest, db: Session = Depends(get_db)):
    studio = db.query(Studio).filter(Studio.id == studio_id).first()
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")

    full_name_clean = payload.full_name.strip()
    phone_clean = payload.phone.strip() if payload.phone else None
    email_clean = str(payload.email).lower().strip() if payload.email else None

    conditions = [func.lower(Client.full_name) == full_name_clean.lower()]
    if phone_clean:
        conditions.append(Client.phone == phone_clean)
    if email_clean:
        conditions.append(Client.email == email_clean)

    existing = db.query(Client).filter(
        Client.studio_id == studio_id, 
        or_(*conditions)
    ).first()
    
    if existing:
        _maybe_create_lead(db, studio_id, existing.full_name, existing.phone, payload)
        return {"message": "Client already exists", "client_id": existing.id}

    new_client = Client(
        studio_id=studio_id,
        full_name=payload.full_name,
        phone=payload.phone,
        email=payload.email,
        birth_date=payload.birth_date,
        loyalty_points=0,
        marketing_consent=payload.marketing_consent,
        is_club_member=True,
        notes="הצטרף דרך דף נחיתה / מועדון לקוחות"
    )
    db.add(new_client)
    db.commit()
    db.refresh(new_client)

    _handle_new_club_member(db, studio_id, new_client)
    _maybe_create_lead(db, studio_id, new_client.full_name, new_client.phone, payload)
    db.commit()
    db.refresh(new_client)

    return {"message": "Successfully joined", "client_id": new_client.id, "loyalty_points": new_client.loyalty_points}


def _maybe_create_lead(db: Session, studio_id: str, name: str, phone: str | None, payload: ClientJoinRequest) -> None:
    """Create a lead from landing page signup only when a UTM source is present."""
    source = (payload.utm_source or "").strip().lower()
    if not source:
        return
    # Avoid duplicate leads for same phone in same studio
    if phone:
        exists = db.query(Lead).filter(
            Lead.studio_id == studio_id,
            Lead.phone == phone,
        ).first()
        if exists:
            return
    db.add(Lead(
        studio_id=studio_id,
        name=name,
        phone=phone,
        email=str(payload.email) if payload.email else None,
        source=source,
        campaign_name=payload.utm_campaign or payload.utm_medium or None,
        service_interest=payload.service_interest or None,
        status="new",
        notes=f"הגיע דרך דף נחיתה — {source}" + (f" / {payload.utm_campaign}" if payload.utm_campaign else ""),
    ))

@router.get("/payment/{appointment_id}", response_model=PublicPaymentInfo)
def get_public_payment_info(appointment_id: str, db: Session = Depends(get_db)):
    from app.models.appointment import Appointment

    row = db.execute(
        select(Appointment, Client, StudioSettings)
        .join(Client, Client.id == Appointment.client_id)
        .join(StudioSettings, StudioSettings.studio_id == Appointment.studio_id)
        .where(Appointment.id == appointment_id)
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Appointment not found")

    appt, client, settings = row

    return PublicPaymentInfo(
        id=str(appt.id),
        client_name=client.full_name,
        appointment_title=appt.title,
        starts_at=appt.starts_at,
        deposit_amount_cents=appt.deposit_amount_cents,
        bit_link=settings.bit_link,
        paybox_link=settings.paybox_link,
        theme_primary_color=settings.theme_primary_color or "#000000",
        theme_secondary_color=settings.theme_secondary_color or "#ffffff",
        logo_filename=settings.logo_filename
    )

@router.post("/payment/{appointment_id}/confirm")
def confirm_payment_sent(appointment_id: str, payload: PaymentConfirmRequest, db: Session = Depends(get_db)):
    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    if appt.payment_sent_at:
        return {"message": "Payment already reported as sent"}

    appt.payment_sent_at = func.now()
    if payload.notes:
        appt.notes = (appt.notes or "") + f"\n[הודעת לקוח לגבי תשלום]: {payload.notes}"

    db.commit()
    return {"message": "Payment confirmation received"}


# ── Self-Booking ──────────────────────────────────────────────────────────────

class BookingArtist(BaseModel):
    id: str
    display_name: str
    calendar_color: Optional[str] = None


class BookingStudioInfo(BaseModel):
    studio_name: str
    primary_color: str
    logo_filename: Optional[str] = None
    start_hour: str
    end_hour: str
    slot_minutes: int
    artists: list[BookingArtist]
    self_booking_enabled: bool


class BookingCreateRequest(BaseModel):
    artist_id: str
    date: date          # YYYY-MM-DD
    time: str           # HH:MM
    name: str
    phone: str
    email: Optional[EmailStr] = None
    notes: Optional[str] = None


def _get_booking_studio(slug: str, db: Session):
    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa: E712
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    settings = db.get(StudioSettings, studio.id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")
    return studio, settings


@router.get("/book/{slug}", response_model=BookingStudioInfo)
def booking_info(slug: str, db: Session = Depends(get_db)):
    studio, settings = _get_booking_studio(slug, db)

    artists = db.scalars(
        select(User).where(
            User.studio_id == studio.id,
            User.is_active == True,  # noqa: E712
            User.role.in_(["owner", "admin", "artist"]),
        )
    ).all()

    return BookingStudioInfo(
        studio_name=studio.name,
        primary_color=settings.theme_primary_color or "#000000",
        logo_filename=settings.logo_filename,
        start_hour=settings.calendar_start_hour or "08:00",
        end_hour=settings.calendar_end_hour or "22:00",
        slot_minutes=settings.self_booking_slot_minutes or 60,
        artists=[BookingArtist(id=str(u.id), display_name=u.display_name or u.email, calendar_color=u.calendar_color) for u in artists],
        self_booking_enabled=settings.self_booking_enabled,
    )


@router.get("/book/{slug}/slots")
def booking_slots(
    slug: str,
    artist_id: str,
    booking_date: str = Query(..., alias="date"),
    db: Session = Depends(get_db),
):
    """Return list of available HH:MM slots for a given artist + date."""
    studio, settings = _get_booking_studio(slug, db)

    if not settings.self_booking_enabled:
        raise HTTPException(status_code=403, detail="Self-booking not enabled")

    try:
        day = date.fromisoformat(booking_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    # Reject past dates
    if day < datetime.now(timezone.utc).date():
        return []

    slot_min = settings.self_booking_slot_minutes or 60

    # Parse working hours
    def parse_hour(s: str):
        h, m = map(int, s.split(":"))
        return h * 60 + m

    start_min = parse_hour(settings.calendar_start_hour or "08:00")
    end_min = parse_hour(settings.calendar_end_hour or "22:00")

    # Generate all candidate slots
    slots = []
    t = start_min
    while t + slot_min <= end_min:
        slots.append(t)
        t += slot_min

    # Get existing appointments for this artist on this day
    day_start = datetime(day.year, day.month, day.day, 0, 0, 0, tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    booked = db.scalars(
        select(Appointment).where(
            Appointment.studio_id == studio.id,
            Appointment.artist_id == artist_id,
            Appointment.starts_at >= day_start,
            Appointment.starts_at < day_end,
            Appointment.status != "canceled",
        )
    ).all()

    occupied: set[int] = set()
    for appt in booked:
        appt_start = int(appt.starts_at.hour * 60 + appt.starts_at.minute)
        appt_end = int(appt.ends_at.hour * 60 + appt.ends_at.minute)
        s = appt_start
        while s < appt_end:
            occupied.add(s)
            s += slot_min

    available = [f"{m // 60:02d}:{m % 60:02d}" for m in slots if m not in occupied]
    return available


@router.post("/book/{slug}", status_code=201)
def create_booking(slug: str, payload: BookingCreateRequest, db: Session = Depends(get_db)):
    """
    Creates a BookingRequest (pending approval).
    The studio staff approves/rejects via the internal booking-requests API.
    """
    studio, settings = _get_booking_studio(slug, db)

    if not settings.self_booking_enabled:
        raise HTTPException(status_code=403, detail="Self-booking not enabled")

    artist = db.scalar(
        select(User).where(User.id == payload.artist_id, User.studio_id == studio.id, User.is_active == True)  # noqa: E712
    )
    if not artist:
        raise HTTPException(status_code=404, detail="Artist not found")

    try:
        h, m = map(int, payload.time.split(":"))
        requested_at = datetime(payload.date.year, payload.date.month, payload.date.day, h, m, tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid time format")

    if requested_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Cannot book in the past")

    # Check slot not already taken or pending
    conflict = db.scalar(
        select(Appointment).where(
            Appointment.studio_id == studio.id,
            Appointment.artist_id == payload.artist_id,
            Appointment.starts_at == requested_at,
            Appointment.status != "canceled",
        )
    )
    if conflict:
        raise HTTPException(status_code=409, detail="Slot no longer available")

    pending_conflict = db.scalar(
        select(BookingRequest).where(
            BookingRequest.studio_id == studio.id,
            BookingRequest.artist_id == uuid.UUID(payload.artist_id),
            BookingRequest.requested_at == requested_at,
            BookingRequest.status == "pending",
        )
    )
    if pending_conflict:
        raise HTTPException(status_code=409, detail="Slot already requested")

    req = BookingRequest(
        id=uuid.uuid4(),
        studio_id=studio.id,
        artist_id=uuid.UUID(payload.artist_id),
        client_name=payload.name.strip(),
        client_phone=payload.phone.strip(),
        client_email=str(payload.email) if payload.email else None,
        service_note=payload.notes or None,
        requested_at=requested_at,
        status="pending",
    )
    db.add(req)
    db.flush()

    # Notify artist + owner via WhatsApp
    _notify_booking_request(db, req, studio, settings, artist)

    db.commit()

    from zoneinfo import ZoneInfo
    tz = ZoneInfo(settings.timezone or "Asia/Jerusalem")
    local_time = requested_at.astimezone(tz).strftime("%d/%m/%Y %H:%M")

    return {
        "request_id": str(req.id),
        "status": "pending",
        "requested_at": local_time,
        "artist_name": artist.display_name or artist.email,
        "studio_name": studio.name,
        "message": "בקשתך נשלחה! תקבל עדכון לאחר אישור הצוות.",
    }


def _notify_booking_request(db, req: BookingRequest, studio, settings, artist) -> None:
    from app.models.message_job import MessageJob
    from app.models.user import User as UserModel

    from zoneinfo import ZoneInfo
    tz = ZoneInfo(settings.timezone or "Asia/Jerusalem")
    local_time = req.requested_at.astimezone(tz).strftime("%d/%m/%Y %H:%M")
    now = datetime.now(timezone.utc)

    msg = (
        f"🔔 בקשת תור חדשה!\n"
        f"👤 {req.client_name} ({req.client_phone})\n"
        f"📅 {local_time}\n"
        f"🎨 אמן: {artist.display_name or artist.email}\n"
        f"📝 {req.service_note or 'ללא הערות'}\n\n"
        f"כנס למערכת לאשר או לדחות."
    )

    # Notify artist
    if artist.phone:
        db.add(MessageJob(
            studio_id=studio.id, channel="whatsapp",
            to_phone=artist.phone, body=msg,
            scheduled_at=now, status="pending",
        ))

    # Notify owner (if different from artist)
    owner = db.scalar(select(UserModel).where(
        UserModel.studio_id == studio.id,
        UserModel.role == "owner",
        UserModel.is_active == True,  # noqa: E712
    ))
    if owner and owner.id != artist.id and owner.phone:
        db.add(MessageJob(
            studio_id=studio.id, channel="whatsapp",
            to_phone=owner.phone, body=msg,
            scheduled_at=now, status="pending",
        ))
