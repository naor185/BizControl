from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.message_job import MessageJob
from app.models.studio_settings import StudioSettings
from app.models.appointment import Appointment
from app.models.client import Client
from app.crud.automation import format_template
from app.utils.email_utils import send_email
from datetime import timedelta
import asyncio

def _send_via_meta(phone_id: str, token: str, to_phone: str, body: str) -> None:
    import urllib.request, json as _json
    url = f"https://graph.facebook.com/v19.0/{phone_id}/messages"
    payload = _json.dumps({
        "messaging_product": "whatsapp",
        "to": to_phone,
        "type": "text",
        "text": {"body": body}
    }).encode()
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"Meta API error {resp.status}")


def _send_via_green(instance_id: str, api_key: str, to_phone: str, body: str) -> None:
    import urllib.request, json as _json
    # Green API endpoint: send message
    url = f"https://api.green-api.com/waInstance{instance_id}/sendMessage/{api_key}"
    # normalize phone: remove +, spaces, dashes
    clean = to_phone.replace("+", "").replace(" ", "").replace("-", "")
    if not clean.endswith("@c.us"):
        clean = f"{clean}@c.us"
    payload = _json.dumps({"chatId": clean, "message": body}).encode()
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"Green API error {resp.status}")


PLATFORM_STUDIO_ID = "46b85021-8eb4-4e63-a2e1-638dbb3e58fb"


def send_whatsapp_message(to_phone: str, body: str, settings=None, db: Session = None) -> None:
    # If studio has no WhatsApp configured, fall back to platform settings
    provider = getattr(settings, "whatsapp_provider", None) if settings else None
    if not provider and db:
        settings = db.get(StudioSettings, PLATFORM_STUDIO_ID)
        provider = getattr(settings, "whatsapp_provider", None) if settings else None

    if provider == "green_api":
        instance_id = getattr(settings, "whatsapp_instance_id", None)
        api_key = getattr(settings, "whatsapp_api_key", None)
        if not instance_id or not api_key:
            print(f"[WA-GREEN] חסרים פרטי Green API, לא נשלח ל-{to_phone}")
            return
        _send_via_green(instance_id, api_key, to_phone, body)

    elif provider == "meta" and getattr(settings, "whatsapp_phone_id", None) and getattr(settings, "whatsapp_api_key", None):
        _send_via_meta(settings.whatsapp_phone_id, settings.whatsapp_api_key, to_phone, body)

    else:
        print(f"[WHATSAPP LOG-ONLY] to={to_phone}\n{body}\n")

def process_due_jobs(db: Session, limit: int = 20) -> int:
    now = datetime.now(timezone.utc)

    # חשוב: נעילה (SKIP LOCKED) כדי למנוע double-send אם רצים כמה workers
    stmt = (
        select(MessageJob)
        .where(MessageJob.status == "pending", MessageJob.scheduled_at <= now)
        .order_by(MessageJob.scheduled_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )

    jobs = list(db.scalars(stmt).all())
    count = 0

    for job in jobs:
        try:
            if job.channel == "email":
                settings = db.get(StudioSettings, job.studio_id)
                if not settings or not settings.smtp_host or not settings.smtp_user or not settings.smtp_pass:
                    raise ValueError("SMTP variables not set or studio settings missing")
                
                asyncio.run(
                    send_email(
                        host=settings.smtp_host,
                        port=settings.smtp_port or 587,
                        user=settings.smtp_user,
                        password=settings.smtp_pass,
                        from_email=settings.smtp_from_email or settings.smtp_user,
                        to_email=job.to_phone,
                        subject="הודעה מסטודיו BizControl",
                        html_content=job.body
                    )
                )
            else:
                settings = db.get(StudioSettings, job.studio_id)
                send_whatsapp_message(job.to_phone, job.body, settings, db=db)
            
            job.status = "sent"
            job.sent_at = now
            job.last_error = None
        except Exception as e:
            job.attempts = int(job.attempts or 0) + 1
            job.last_error = str(e)
            job.status = "failed" if job.attempts >= 3 else "pending"
        count += 1

    if count:
        db.commit()
    return count

def _sweep_reminders_for_window(
    db: Session,
    hours_ahead: int,
    window_hours: int = 4,
    tag: str = "",
    wa_default: str = "",
    email_default: str = "",
) -> int:
    """Generic reminder sweep for any time window ahead of now."""
    now = datetime.now(timezone.utc)
    target_start = now + timedelta(hours=hours_ahead - window_hours // 2)
    target_end   = now + timedelta(hours=hours_ahead + window_hours // 2)

    stmt = (
        select(Appointment, Client, StudioSettings)
        .join(Client, Client.id == Appointment.client_id)
        .join(StudioSettings, StudioSettings.studio_id == Appointment.studio_id)
        .where(
            Appointment.status == "scheduled",
            Appointment.starts_at >= target_start,
            Appointment.starts_at <= target_end,
        )
    )
    rows = db.execute(stmt).all()
    count = 0

    for appt, client, settings in rows:
        # Deduplicate: skip if a job with same tag already exists for this appointment
        existing = db.scalar(
            select(MessageJob).where(
                MessageJob.appointment_id == appt.id,
                MessageJob.body.contains(tag),
            )
        )
        if existing:
            continue

        payment_link = settings.bit_link or settings.paybox_link or ""
        context = {
            "client_name": client.full_name,
            "appointment_title": appt.title,
            "appointment_date": appt.starts_at.strftime("%d/%m/%Y"),
            "appointment_time": appt.starts_at.strftime("%H:%M"),
            "payment_link": payment_link,
            "deposit_amount": f"{appt.deposit_amount_cents / 100:.2f}" if appt.deposit_amount_cents else "0.00",
        }

        wa_body = format_template(wa_default, context) if wa_default else None
        if client.phone and wa_body:
            db.add(MessageJob(
                studio_id=appt.studio_id,
                client_id=client.id,
                appointment_id=appt.id,
                channel="whatsapp",
                to_phone=client.phone,
                body=wa_body,
                scheduled_at=now,
                status="pending",
            ))
            count += 1

        email_body = format_template(email_default, context) if email_default and client.email and settings.smtp_host else None
        if email_body:
            db.add(MessageJob(
                studio_id=appt.studio_id,
                client_id=client.id,
                appointment_id=appt.id,
                channel="email",
                to_phone=client.email,
                body=email_body,
                scheduled_at=now,
                status="pending",
            ))
            count += 1

    if count:
        db.commit()
    return count


def sweep_upcoming_reminders(db: Session) -> int:
    """Enqueues reminders for appointments starting in ~24 hours."""
    now = datetime.now(timezone.utc)
    target_start = now + timedelta(hours=22)
    target_end   = now + timedelta(hours=26)

    # find appointments in the window that are scheduled and haven't had a reminder
    stmt = (
        select(Appointment, Client, StudioSettings)
        .join(Client, Client.id == Appointment.client_id)
        .join(StudioSettings, StudioSettings.studio_id == Appointment.studio_id)
        .where(
            Appointment.status == "scheduled",
            Appointment.starts_at >= target_start,
            Appointment.starts_at <= target_end,
        )
    )

    rows = db.execute(stmt).all()
    count = 0

    for appt, client, settings in rows:
        # Check if reminder already enqueued (searching for WA or Email jobs for this appt)
        # We look for jobs scheduled near 'now' (reminders are sent ~24h before)
        existing_stmt = select(MessageJob).where(
            MessageJob.appointment_id == appt.id,
            MessageJob.scheduled_at >= now - timedelta(hours=12) # safeguard
        )
        if db.scalar(existing_stmt):
            continue

        payment_link = settings.bit_link or settings.paybox_link or ""
        context = {
            "client_name": client.full_name,
            "appointment_title": appt.title,
            "appointment_date": appt.starts_at.strftime("%d/%m/%Y"),
            "appointment_time": appt.starts_at.strftime("%H:%M"),
            "payment_link": payment_link,
            "deposit_amount": f"{appt.deposit_amount_cents / 100:.2f}" if appt.deposit_amount_cents else "0.00",
        }

        # WhatsApp Reminder
        wa_template = settings.reminder_wa_template
        if not wa_template:
            wa_template = "היי {client_name}, תזכורת ידידותית לתור שלך מחר ({appointment_date}) בשעה {appointment_time}. מחכים לך! במידה וטרם הועברה מקדמה, ניתן לשלם כאן: {payment_link}"

        if client.phone:
            db.add(MessageJob(
                studio_id=appt.studio_id,
                client_id=client.id,
                appointment_id=appt.id,
                channel="whatsapp",
                to_phone=client.phone,
                body=format_template(wa_template, context),
                scheduled_at=now,
                status="pending",
            ))
            count += 1

        # Email Reminder
        email_template = settings.reminder_email_template
        if not email_template:
            email_template = """
            <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #333;">תזכורת לתור למחר 📅</h2>
                <p>היי {client_name},</p>
                <p>רק מזכירים שיש לנו פגישה מחר ל-<strong>{appointment_title}</strong>.</p>
                <p><strong>מתי?</strong> {appointment_date} בשעה {appointment_time}</p>
                <p>נתראה בקרוב!</p>
                <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
                <p style="font-size: 12px; color: #888;">הודעה זו נשלחה אוטומטית ממערכת BizControl.</p>
            </div>
            """

        if client.email and settings.smtp_host:
            db.add(MessageJob(
                studio_id=appt.studio_id,
                client_id=client.id,
                appointment_id=appt.id,
                channel="email",
                to_phone=client.email,
                body=format_template(email_template, context),
                scheduled_at=now,
                status="pending",
            ))
            count += 1

    if count:
        db.commit()
    return count


def sweep_7day_reminders(db: Session) -> int:
    return _sweep_reminders_for_window(
        db,
        hours_ahead=7 * 24,
        window_hours=4,
        tag="[7day]",
        wa_default="[7day] היי {client_name}! יש לך תור ל-{appointment_title} בעוד שבוע, ב-{appointment_date} בשעה {appointment_time}. מחכים לך!",
        email_default="<div dir=rtl>[7day] תזכורת תור בעוד שבוע - {client_name} - {appointment_date} {appointment_time}</div>",
    )


def sweep_3day_reminders(db: Session) -> int:
    return _sweep_reminders_for_window(
        db,
        hours_ahead=3 * 24,
        window_hours=4,
        tag="[3day]",
        wa_default="[3day] היי {client_name}! תזכורת התור שלך ל-{appointment_title} בעוד 3 ימים, ב-{appointment_date} בשעה {appointment_time}. אם טרם שילמת מקדמה: {payment_link}",
        email_default="<div dir=rtl>[3day] תזכורת - 3 ימים לתור - {client_name} - {appointment_date} {appointment_time}</div>",
    )
