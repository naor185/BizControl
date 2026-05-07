import os
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, select
from datetime import datetime, date

from app.core.database import get_db
from app.models.studio import Studio
from app.models.client import Client
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
    from app.models.appointment import Appointment
    
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
