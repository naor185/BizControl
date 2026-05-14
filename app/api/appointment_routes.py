from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
from app.utils.logger import get_logger

log = get_logger(__name__)

from app.db.deps import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.permissions import require_roles, Perms
from app.schemas.appointment import AppointmentCreate, AppointmentUpdate, AppointmentOut
from app.crud.appointment import (
    create_appointment, list_appointments, get_appointment, get_appointment_out, update_appointment, cancel_appointment, hard_delete_appointment
)
from app.models.studio_settings import StudioSettings
from app.utils.google_calendar import get_google_calendar_service, create_google_event, update_google_event, delete_google_event

router = APIRouter(prefix="/appointments", tags=["Appointments"])

ALLOWED_ARTIST_FIELDS = {"status", "notes"}

@router.post(
    "",
    response_model=AppointmentOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN, Perms.RECEPTIONIST, Perms.MANAGER))]
)
def create(payload: AppointmentCreate, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        created = create_appointment(db, ctx.studio_id, payload)
        
        # Sync to Google Calendar
        settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
        if settings and settings.google_calendar_refresh_token and settings.google_calendar_client_id and settings.google_calendar_client_secret:
            try:
                service = get_google_calendar_service(
                    settings.google_calendar_client_id, 
                    settings.google_calendar_client_secret, 
                    settings.google_calendar_refresh_token
                )
                
                out_dict = get_appointment_out(db, ctx.studio_id, created["id"])
                title = f"{out_dict['title']} - {out_dict['client_name']}"
                desc = out_dict['notes'] or ""
                
                google_id = create_google_event(
                    service, 
                    title=title, 
                    start_time=payload.starts_at, 
                    end_time=payload.ends_at, 
                    description=desc
                )
                
                appt_obj = get_appointment(db, ctx.studio_id, created["id"])
                if appt_obj:
                    appt_obj.google_event_id = google_id
                    db.commit()
            except Exception as e:
                log.warning("Failed to create Google event: %s", e)

        return get_appointment_out(db, ctx.studio_id, created["id"])
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

from app.utils.google_calendar import get_google_calendar_service, create_google_event, update_google_event, delete_google_event, list_google_events
import pytz

@router.get("", response_model=list[AppointmentOut])
def list_(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    artist_id: UUID | None = Query(default=None),
    client_id: UUID | None = Query(default=None),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    db_events = list_appointments(db, ctx.studio_id, start=start, end=end, artist_id=artist_id, client_id=client_id)
    
    # Optional: Merge external Google events natively into the calendar
    # We only do this if they connected a calendar, AND they are querying a time range (standard calendar views)
    settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
    if settings and settings.google_calendar_refresh_token and settings.google_calendar_client_id and settings.google_calendar_client_secret and start and end:
        try:
            service = get_google_calendar_service(
                settings.google_calendar_client_id, 
                settings.google_calendar_client_secret, 
                settings.google_calendar_refresh_token
            )
            
            google_events = list_google_events(service, start, end)
            
            # Get a set of already synced google_event_ids in this time range to avoid duplicates
            existing_google_ids = {e.get('google_event_id') for e in db_events if e.get('google_event_id')}
            
            for g_event in google_events:
                g_id = g_event.get('id')
                # Skip if already in DB (synced from BizControl to Google)
                # or if it's purely a Google event that happens to have the exact ID.
                if g_id in existing_google_ids:
                    continue
                    
                g_start = g_event.get('start', {}).get('dateTime') or g_event.get('start', {}).get('date')
                g_end = g_event.get('end', {}).get('dateTime') or g_event.get('end', {}).get('date')
                
                if g_start and g_end:
                    # Parse ISO strings to datetime
                    from dateutil import parser
                    start_dt = parser.isoparse(g_start)
                    end_dt = parser.isoparse(g_end)
                    
                    # Ensure start_dt and end_dt have timezone info, otherwise assume UTC
                    if start_dt.tzinfo is None:
                        start_dt = start_dt.replace(tzinfo=pytz.UTC)
                    if end_dt.tzinfo is None:
                        end_dt = end_dt.replace(tzinfo=pytz.UTC)
                        
                    db_events.append({
                        # Generate a mock UUID for the key mapping in UI since it's external
                        "id": str(UUID(int=0)), # Dummy ID, or just random
                        "studio_id": ctx.studio_id,
                        "client_id": str(UUID(int=0)), # Dummy client
                        "artist_id": str(UUID(int=0)), # Mock artist or default
                        "title": g_event.get('summary', 'Google Event'),
                        "starts_at": start_dt,
                        "ends_at": end_dt,
                        "status": "scheduled",
                        "notes": g_event.get('description', ''),
                        "created_at": datetime.now(pytz.UTC),
                        "client_name": "Google Event",
                        "artist_email": "",
                        "artist_name": "Google",
                        "artist_color": "#4285F4", # Signature Google Calendar Blue
                        "google_event_id": g_id
                    })
        except Exception as e:
            log.warning("Failed to fetch Google Calendar events: %s", e)

    return db_events

@router.get("/{appointment_id}", response_model=AppointmentOut)
def get_one(appointment_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    obj = get_appointment_out(db, ctx.studio_id, appointment_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return obj

@router.patch("/{appointment_id}", response_model=AppointmentOut)
def patch(appointment_id: UUID, payload: AppointmentUpdate, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if ctx.role == Perms.ARTIST:
        incoming_fields = {k for k, v in payload.model_dump(exclude_unset=True).items()}
        illegal = incoming_fields - ALLOWED_ARTIST_FIELDS
        if illegal:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Artist cannot modify fields: {sorted(illegal)}"
            )
        
        # Verify the appointment belongs to the artist
        existing_appt = get_appointment(db, ctx.studio_id, appointment_id)
        if not existing_appt:
            raise HTTPException(status_code=404, detail="Appointment not found")
        if str(existing_appt.artist_id) != str(ctx.user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify another artist's appointment")

    try:
        obj = update_appointment(db, ctx.studio_id, appointment_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not obj:
        raise HTTPException(status_code=404, detail="Appointment not found")
        
    # Sync to Google Calendar
    appt_obj = get_appointment(db, ctx.studio_id, appointment_id)
    if appt_obj and appt_obj.google_event_id:
        settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
        if settings and settings.google_calendar_refresh_token and settings.google_calendar_client_id and settings.google_calendar_client_secret:
            try:
                service = get_google_calendar_service(
                    settings.google_calendar_client_id, 
                    settings.google_calendar_client_secret, 
                    settings.google_calendar_refresh_token
                )
                
                out_dict = get_appointment_out(db, ctx.studio_id, appointment_id)
                title = f"{obj['title']} - {out_dict['client_name']}" if 'title' in obj else None
                desc = payload.notes if payload.notes is not None else None
                
                update_google_event(
                    service, 
                    appt_obj.google_event_id,
                    title=title, 
                    start_time=payload.starts_at, 
                    end_time=payload.ends_at, 
                    description=desc
                )
            except Exception as e:
                log.warning("Failed to update Google event: %s", e)
    
    return get_appointment_out(db, ctx.studio_id, appointment_id)

@router.delete("/{appointment_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel(appointment_id: UUID, reason: str | None = Query(default=None), hard_delete: bool = Query(default=False), ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    # Grab event before canceling to get google_event_id
    appt_obj = get_appointment(db, ctx.studio_id, appointment_id)
    
    if hard_delete:
        ok = hard_delete_appointment(db, ctx.studio_id, appointment_id)
    else:
        ok = cancel_appointment(db, ctx.studio_id, appointment_id, reason=reason)
        
    if not ok:
        raise HTTPException(status_code=404, detail="Appointment not found")
        
    if appt_obj and appt_obj.google_event_id:
        settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
        if settings and settings.google_calendar_refresh_token and settings.google_calendar_client_id and settings.google_calendar_client_secret:
            try:
                service = get_google_calendar_service(
                    settings.google_calendar_client_id, 
                    settings.google_calendar_client_secret, 
                    settings.google_calendar_refresh_token
                )
                delete_google_event(service, appt_obj.google_event_id)
            except Exception as e:
                log.warning("Failed to delete Google event: %s", e)
                
    return None

@router.post("/{appointment_id}/verify-payment")
def verify_sent_payment(appointment_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Studio confirms they received the payment reported by client."""
    from app.models.payment import Payment
    from app.models.appointment import Appointment
    
    appt = db.get(Appointment, appointment_id)
    if not appt or appt.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Appointment not found")

    if not appt.payment_sent_at:
        raise HTTPException(status_code=400, detail="No payment was reported as sent for this appointment")
    
    if appt.payment_verified_at:
        return {"message": "Payment already verified"}

    # Mark as verified
    appt.payment_verified_at = func.now()

    # Create the actual Payment record
    new_payment = Payment(
        studio_id=ctx.studio_id,
        appointment_id=appt.id,
        client_id=appt.client_id,
        amount_cents=appt.deposit_amount_cents,
        method="bit", # placeholder, assume bit/paybox digital
        status="paid",
        type="deposit",
        notes="אומת אוטומטית לאחר דיווח לקוח"
    )
    db.add(new_payment)
    db.commit()

    # שלח הודעת אישור מקדמה עם פרטים מלאים (כתובת, מפה, תיק עבודות, מדיניות ביטולים)
    from app.crud.automation import enqueue_deposit_approved_message
    try:
        enqueue_deposit_approved_message(db, appt)
    except Exception as e:
        log.error("[deposit_approved_msg] failed: %s", e)

    return {"message": "Payment verified and recorded"}
