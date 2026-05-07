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
    db.commit()
    db.refresh(new_client)

    return {"message": "Successfully joined", "client_id": new_client.id}

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
    studio, settings = _get_booking_studio(slug, db)

    if not settings.self_booking_enabled:
        raise HTTPException(status_code=403, detail="Self-booking not enabled")

    # Validate artist belongs to this studio
    artist = db.scalar(
        select(User).where(User.id == payload.artist_id, User.studio_id == studio.id, User.is_active == True)  # noqa: E712
    )
    if not artist:
        raise HTTPException(status_code=404, detail="Artist not found")

    slot_min = settings.self_booking_slot_minutes or 60

    # Build datetime objects
    try:
        h, m = map(int, payload.time.split(":"))
        starts_at = datetime(payload.date.year, payload.date.month, payload.date.day, h, m, tzinfo=timezone.utc)
        ends_at = starts_at + timedelta(minutes=slot_min)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid time format")

    if starts_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Cannot book in the past")

    # Find or create client
    client = None
    phone_clean = payload.phone.strip()
    if phone_clean:
        client = db.scalar(select(Client).where(Client.studio_id == studio.id, Client.phone == phone_clean))
    if not client and payload.email:
        client = db.scalar(select(Client).where(Client.studio_id == studio.id, Client.email == str(payload.email)))

    if not client:
        client = Client(
            id=uuid.uuid4(),
            studio_id=studio.id,
            full_name=payload.name.strip(),
            phone=phone_clean or None,
            email=str(payload.email) if payload.email else None,
            notes="נרשם דרך דף ההזמנה המקוון",
        )
        db.add(client)
        db.flush()

    # Check slot still available
    conflict = db.scalar(
        select(Appointment).where(
            Appointment.studio_id == studio.id,
            Appointment.artist_id == payload.artist_id,
            Appointment.starts_at == starts_at,
            Appointment.status != "canceled",
        )
    )
    if conflict:
        raise HTTPException(status_code=409, detail="Slot no longer available")

    appt = Appointment(
        id=uuid.uuid4(),
        studio_id=studio.id,
        client_id=client.id,
        artist_id=uuid.UUID(payload.artist_id),
        title=f"הזמנה מקוונת — {payload.name.strip()}",
        starts_at=starts_at,
        ends_at=ends_at,
        status="scheduled",
        notes=payload.notes or "",
    )
    db.add(appt)
    db.commit()

    return {
        "appointment_id": str(appt.id),
        "starts_at": starts_at.isoformat(),
        "artist_name": artist.display_name or artist.email,
        "studio_name": studio.name,
    }
