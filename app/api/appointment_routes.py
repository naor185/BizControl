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
from app.models.message_job import MessageJob
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

        # Fire automation rules for appointment_created
        try:
            import pytz as _pytz
            from app.services.automation_engine import fire_event as _fire
            _s = db.get(StudioSettings, ctx.studio_id)
            _tz = _pytz.timezone(getattr(_s, "timezone", None) or "Asia/Jerusalem")
            _local = payload.starts_at.astimezone(_tz)
            _out = get_appointment_out(db, ctx.studio_id, created["id"])
            _fire(db, ctx.studio_id, "appointment_created", {
                "client_name": _out.get("client_name", ""),
                "client_phone": "",
                "service_name": _out.get("title", ""),
                "service_id": str(created.get("service_id") or ""),
                "appointment_date": _local.strftime("%d/%m/%Y"),
                "appointment_time": _local.strftime("%H:%M"),
                "artist_name": _out.get("artist_name", "") or "",
            }, appointment_id=created["id"], client_id=payload.client_id)
        except Exception:
            log.exception("Automation engine error for appointment_created")

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
    # Artists/staff can only see their own appointments — ignore any artist_id param
    if ctx.role in (Perms.ARTIST, "staff"):
        artist_id = ctx.user_id

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

@router.get("/pending-deposits")
def list_pending_deposits(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Return upcoming appointments with an unconfirmed deposit."""
    from app.models.appointment import Appointment
    from app.models.client import Client
    from datetime import datetime, timezone, timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    rows = (
        db.query(Appointment, Client)
        .join(Client, Client.id == Appointment.client_id)
        .filter(
            Appointment.studio_id == ctx.studio_id,
            Appointment.deposit_amount_cents > 0,
            Appointment.payment_verified_at.is_(None),
            Appointment.status != "cancelled",
            Appointment.starts_at >= cutoff,
        )
        .order_by(Appointment.starts_at)
        .all()
    )
    result = []
    for appt, client in rows:
        result.append({
            "appointment_id": str(appt.id),
            "client_name": client.full_name,
            "client_phone": client.phone or "",
            "client_id": str(client.id),
            "title": appt.title,
            "starts_at": appt.starts_at.isoformat() if appt.starts_at else None,
            "deposit_amount_cents": appt.deposit_amount_cents,
            "payment_sent_at": appt.payment_sent_at.isoformat() if appt.payment_sent_at else None,
        })
    return result


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

    # Capture state before update
    existing_appt = get_appointment(db, ctx.studio_id, appointment_id)
    prev_status = existing_appt.status if existing_appt else None
    prev_starts_at = existing_appt.starts_at if existing_appt else None

    try:
        obj = update_appointment(db, ctx.studio_id, appointment_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not obj:
        raise HTTPException(status_code=404, detail="Appointment not found")

    # If starts_at changed, cancel pending reminder jobs so rescheduled clients
    # don't receive stale reminders from the old date
    if payload.starts_at and existing_appt and payload.starts_at != prev_starts_at:
        from sqlalchemy import update as sa_update
        db.execute(
            sa_update(MessageJob)
            .where(
                MessageJob.appointment_id == appointment_id,
                MessageJob.status == "pending",
            )
            .values(status="canceled")
        )
        db.commit()
        log.info("Canceled pending message jobs for rescheduled appointment %s", appointment_id)

    # Add stamp when appointment transitions to "done"
    new_status = payload.model_dump(exclude_unset=True).get("status")
    if new_status == "done" and prev_status != "done" and existing_appt and existing_appt.client_id:
        try:
            from app.crud.stamp_card import add_stamp_for_appointment, grant_stamp_reward
            rewards = add_stamp_for_appointment(db, ctx.studio_id, existing_appt.client_id)
            for r in rewards:
                grant_stamp_reward(db, ctx.studio_id, existing_appt.client_id, r["card"])
        except Exception as e:
            log.warning("Stamp card error: %s", e)

        # Send non-member club invitation if client is not a club member
        try:
            from app.models.client import Client
            from app.models.studio import Studio
            from app.models.message_job import MessageJob
            from app.crud.automation import format_template
            from datetime import datetime, timezone, timedelta

            client = db.get(Client, existing_appt.client_id)
            settings = db.query(StudioSettings).filter(StudioSettings.studio_id == ctx.studio_id).first()
            studio = db.get(Studio, ctx.studio_id)

            if client and settings and not client.is_club_member and (client.loyalty_points or 0) == 0 and client.phone and not getattr(client, "whatsapp_opted_out", False):
                slug = studio.slug if studio else None
                join_link = f"https://www.biz-control.com/s/{slug}" if slug else ""
                points_on_signup = getattr(settings, "points_on_signup", 50) or 50

                template = getattr(settings, "non_member_wa_template", None) or (
                    "היי {client_name}! 👋\n\n"
                    "שמחים שביקרת אצלנו!\n"
                    "הצטרף/י למועדון הלקוחות שלנו וקבל/י {points_on_signup} נקודות מתנה לביקור הבא 🎉\n\n"
                    "הרשמה: {join_link}"
                )

                body = format_template(template, {
                    "client_name": client.full_name or "",
                    "points_on_signup": points_on_signup,
                    "join_link": join_link,
                })

                scheduled_at = datetime.now(timezone.utc) + timedelta(minutes=30)
                db.add(MessageJob(
                    studio_id=ctx.studio_id,
                    client_id=client.id,
                    channel="whatsapp",
                    to_phone=client.phone,
                    body=body,
                    scheduled_at=scheduled_at,
                    status="pending",
                ))
                db.commit()
                log.info("Queued non-member club invitation for client %s", client.id)
        except Exception as e:
            log.warning("Non-member invitation error: %s", e)

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

    # ── Notify wait list when slot opens ─────────────────────────────────────
    if not hard_delete:
        try:
            from app.api.wait_list_routes import notify_wait_list_on_cancellation
            service_id = getattr(appt_obj, "service_id", None) if appt_obj else None
            n = notify_wait_list_on_cancellation(db, ctx.studio_id, service_id)
            if n:
                log.info("Notified %d wait list clients after cancellation", n)
        except Exception:
            log.exception("Wait list notification failed")

    # ── Fire automation rules for appointment_canceled ────────────────────────
    if not hard_delete and appt_obj:
        try:
            import pytz as _pytz
            from app.services.automation_engine import fire_event as _fire
            _s = db.get(StudioSettings, ctx.studio_id)
            _tz = _pytz.timezone(getattr(_s, "timezone", None) or "Asia/Jerusalem")
            _local = appt_obj.starts_at.astimezone(_tz)
            _client_name = appt_obj.client.full_name if appt_obj.client else ""
            _fire(db, ctx.studio_id, "appointment_canceled", {
                "client_name": _client_name,
                "client_phone": "",
                "service_name": appt_obj.title or "",
                "service_id": str(appt_obj.service_id) if getattr(appt_obj, "service_id", None) else "",
                "appointment_date": _local.strftime("%d/%m/%Y"),
                "appointment_time": _local.strftime("%H:%M"),
            }, appointment_id=appt_obj.id, client_id=appt_obj.client_id)
        except Exception:
            log.exception("Automation engine error for appointment_canceled")

    return None

@router.post("/{appointment_id}/verify-payment")
def verify_sent_payment(appointment_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Studio confirms they received the deposit (manually, after seeing screenshot on WhatsApp)."""
    from app.models.payment import Payment
    from app.models.appointment import Appointment

    appt = db.get(Appointment, appointment_id)
    if not appt or appt.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Appointment not found")

    if appt.payment_verified_at:
        return {"message": "Payment already verified"}

    # Mark as verified
    appt.payment_verified_at = func.now()

    # Create payment record only if there's an actual deposit amount
    if appt.deposit_amount_cents > 0:
        new_payment = Payment(
            studio_id=ctx.studio_id,
            appointment_id=appt.id,
            client_id=appt.client_id,
            amount_cents=appt.deposit_amount_cents,
            method="bit",
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

    # Fire automation rules for deposit_paid
    try:
        import pytz as _pytz
        from app.services.automation_engine import fire_event as _fire
        _s = db.get(StudioSettings, ctx.studio_id)
        _tz = _pytz.timezone(getattr(_s, "timezone", None) or "Asia/Jerusalem")
        _local = appt.starts_at.astimezone(_tz)
        _client = appt.client if hasattr(appt, "client") else None
        _fire(db, ctx.studio_id, "deposit_paid", {
            "client_name": _client.full_name if _client else "",
            "client_phone": _client.phone if _client else "",
            "service_name": appt.title or "",
            "service_id": str(appt.service_id) if getattr(appt, "service_id", None) else "",
            "amount": str(appt.deposit_amount_cents // 100),
            "appointment_date": _local.strftime("%d/%m/%Y"),
        }, appointment_id=appt.id, client_id=appt.client_id)
    except Exception:
        log.exception("Automation engine error for deposit_paid")

    return {"message": "Payment verified and recorded"}


@router.post("/{appointment_id}/mark-done")
def mark_appointment_done(
    appointment_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Mark appointment done and send aftercare/review message if treatment type requires it."""
    import json as _json
    from sqlalchemy import select
    from app.models.appointment import Appointment
    from app.models.payment import Payment

    appt = db.get(Appointment, appointment_id)
    if not appt or appt.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Appointment not found")

    if appt.status == "done":
        return {"message": "Already marked as done"}

    appt.status = "done"
    appt.done_at = func.now()
    db.commit()

    # ── Send aftercare + review message for every completed appointment ──
    # Sends if aftercare_message OR any review link is configured in settings.
    # No treatment_type matching needed — every done appointment gets the message.
    try:
        settings = db.get(StudioSettings, ctx.studio_id)
        if settings and appt.client_id:
            _has_content = bool(
                getattr(settings, "aftercare_message", None) or
                getattr(settings, "review_link_google", None) or
                getattr(settings, "review_link_instagram", None) or
                getattr(settings, "review_link_facebook", None) or
                getattr(settings, "review_link_whatsapp", None)
            )
            if _has_content:
                final_payment = db.scalar(
                    select(Payment).where(
                        Payment.appointment_id == appt.id,
                        Payment.studio_id == ctx.studio_id,
                        Payment.type == "payment",
                        Payment.status == "paid",
                    ).order_by(Payment.created_at.desc())
                )
                amount_cents = final_payment.amount_cents if final_payment else 0
                from app.crud.automation import enqueue_post_payment_message
                enqueue_post_payment_message(db, appt, amount_cents)
                log.info("Aftercare message enqueued for appointment %s", appointment_id)
            else:
                log.info("No aftercare content configured for studio %s — skipping", ctx.studio_id)
    except Exception:
        log.exception("Failed to enqueue aftercare message for appointment %s", appointment_id)

    # ── Fire automation rules for appointment_done ────────────────────────────
    try:
        import pytz as _pytz
        from app.services.automation_engine import fire_event as _fire
        _settings = db.get(StudioSettings, ctx.studio_id)
        _tz = _pytz.timezone(getattr(_settings, "timezone", None) or "Asia/Jerusalem")
        _local = appt.starts_at.astimezone(_tz)
        _ctx = {
            "client_name": appt.client.full_name if appt.client_id and hasattr(appt, "client") and appt.client else "",
            "client_phone": appt.client_phone or "",
            "service_name": appt.title or "",
            "service_id": str(appt.service_id) if getattr(appt, "service_id", None) else "",
            "appointment_date": _local.strftime("%d/%m/%Y"),
            "appointment_time": _local.strftime("%H:%M"),
            "artist_name": "",
        }
        _fire(db, ctx.studio_id, "appointment_done", _ctx,
              appointment_id=appt.id, client_id=appt.client_id)
    except Exception:
        log.exception("Automation engine error for appointment_done %s", appointment_id)

    return {"message": "Appointment marked as done"}
