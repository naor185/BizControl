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

def send_whatsapp_message(to_phone: str, body: str) -> None:
    # TODO: כאן נחבר ספק אמיתי (Twilio / WhatsApp Cloud API).
    # כרגע "log-only"
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
                send_whatsapp_message(job.to_phone, job.body)
            
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

def sweep_upcoming_reminders(db: Session) -> int:
    """Enqueues reminders for appointments starting in ~24 hours."""
    now = datetime.now(timezone.utc)
    target_start = now + timedelta(hours=22)
    target_end = now + timedelta(hours=26)

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
