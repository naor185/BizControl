import os
from datetime import datetime, timedelta, timezone
from uuid import UUID
from sqlalchemy.orm import Session

from app.models.studio_settings import StudioSettings
from app.models.client import Client
from app.models.appointment import Appointment
from app.models.client_points_ledger import ClientPointsLedger
from app.models.message_job import MessageJob

def format_template(template: str, context: dict) -> str:
    """Replaces placeholders like {client_name} with values from context."""
    if not template:
        return ""
    for key, value in context.items():
        placeholder = "{" + key + "}"
        template = template.replace(placeholder, str(value or ""))
    return template

def smart_format(template: str, context: dict) -> str:
    """
    Smart template formatting:
    - If template contains {placeholders} → replaces them as usual.
    - If template is plain text (no {}) → appends relevant details automatically.
    """
    if not template:
        return ""
    if "{" not in template:
        # Plain text mode – build details block automatically
        lines = [template.strip(), ""]
        if context.get("client_name"):
            lines.append(f"👤 {context['client_name']}")
        if context.get("appointment_title"):
            lines.append(f"🎨 {context['appointment_title']}")
        if context.get("appointment_date") and context.get("appointment_time"):
            lines.append(f"📅 {context['appointment_date']} בשעה {context['appointment_time']}")
        elif context.get("appointment_date"):
            lines.append(f"📅 {context['appointment_date']}")
        if context.get("deposit_amount") and float(context.get("deposit_amount", 0)) > 0:
            lines.append(f"💳 מקדמה: {context['deposit_amount']} ₪")
        if context.get("payment_link"):
            lines.append(f"🔗 {context['payment_link']}")
        if context.get("payment_amount"):
            lines.append(f"💰 סכום ששולם: {context['payment_amount']} ₪")
        if context.get("points_total"):
            lines.append(f"⭐ יתרת נקודות: {context['points_total']}")
        return "\n".join(lines).strip()
    return format_template(template, context)


def enqueue_confirmation_message(db: Session, appt: Appointment) -> None:
    """
    Queue immediate confirmation message for a NEW appointment.
    """
    settings = db.get(StudioSettings, appt.studio_id)
    client = db.get(Client, appt.client_id)
    if not settings or not client:
        return

    # Base URL for the public payment page
    # In a real app, this would be the public domain. 
    # For now, we use a placeholder or local env.
    base_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    payment_confirm_url = f"{base_url}/pay/{appt.id}"

    context = {
        "client_name": client.full_name,
        "appointment_title": appt.title,
        "appointment_date": appt.starts_at.strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.strftime("%H:%M"),
        "payment_link": payment_confirm_url,
        "deposit_amount": f"{appt.deposit_amount_cents / 100:.2f}" if appt.deposit_amount_cents else "0.00",
    }

    now = datetime.now(timezone.utc)

    # WhatsApp Confirmation
    wa_template = settings.confirm_wa_template
    if not wa_template:
        wa_template = "שלום {client_name}, התור שלך ל-{appointment_title} נקבע בהצלחה ליום {appointment_date} בשעה {appointment_time}. לתשלום מקדמה של {deposit_amount} ש״ח: {payment_link}"

    if client.phone:
        body = smart_format(wa_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            channel="whatsapp",
            to_phone=client.phone,
            body=body,
            scheduled_at=now,
            status="pending",
        ))

    # Email Confirmation
    email_template = settings.confirm_email_template
    if not email_template:
        email_template = """
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #333;">אישור תור חדש ✅</h2>
            <p>שלום {client_name},</p>
            <p>התור שלך ל-<strong>{appointment_title}</strong> נקבע בהצלחה.</p>
            <p><strong>תאריך:</strong> {appointment_date}</p>
            <p><strong>שעה:</strong> {appointment_time}</p>
            <p>נודה לך על העברת מקדמה בסך {deposit_amount} ש״ח בקישור הבא: <a href="{payment_link}">{payment_link}</a></p>
            <p>מחכים לראותך!</p>
            <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
            <p style="font-size: 12px; color: #888;">הודעה זו נשלחה אוטומטית ממערכת BizControl.</p>
        </div>
        """

    if client.email and settings.smtp_host:
        body = smart_format(email_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            channel="email",
            to_phone=client.email,
            body=body,
            scheduled_at=now,
            status="pending",
        ))
    
    db.commit()

def enqueue_reschedule_message(db: Session, appt: Appointment) -> None:
    """
    Queue immediate reschedule message for an existing appointment.
    """
    settings = db.get(StudioSettings, appt.studio_id)
    client = db.get(Client, appt.client_id)
    if not settings or not client:
        return

    context = {
        "client_name": client.full_name,
        "appointment_title": appt.title,
        "appointment_date": appt.starts_at.strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.strftime("%H:%M"),
    }

    now = datetime.now(timezone.utc)

    # WhatsApp Reschedule
    wa_template = settings.reschedule_wa_template
    if not wa_template:
        wa_template = "שלום {client_name}, התור שלך ל-{appointment_title} עודכן ליום {appointment_date} בשעה {appointment_time}. נשמח לראותך!"

    if client.phone:
        body = smart_format(wa_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            channel="whatsapp",
            to_phone=client.phone,
            body=body,
            scheduled_at=now,
            status="pending",
        ))

    # Email Reschedule
    email_template = settings.reschedule_email_template
    if not email_template:
        email_template = """
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #333;">עדכון מועד תור 🔄</h2>
            <p>שלום {client_name},</p>
            <p>התור שלך ל-<strong>{appointment_title}</strong> עודכן למועד חדש.</p>
            <p><strong>תאריך חדש:</strong> {appointment_date}</p>
            <p><strong>שעה חדשה:</strong> {appointment_time}</p>
            <p>נשמח לראותך!</p>
            <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;" />
            <p style="font-size: 12px; color: #888;">הודעה זו נשלחה אוטומטית ממערכת BizControl.</p>
        </div>
        """

    if client.email and settings.smtp_host:
        body = smart_format(email_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            channel="email",
            to_phone=client.email,
            body=body,
            scheduled_at=now,
            status="pending",
        ))
    
    db.commit()

def enqueue_cancel_message(db: Session, appt: Appointment) -> None:
    """Send a WhatsApp/Email cancellation notice to the client."""
    settings = db.get(StudioSettings, appt.studio_id)
    client = db.get(Client, appt.client_id)
    if not settings or not client:
        return

    context = {
        "client_name": client.full_name,
        "appointment_title": appt.title,
        "appointment_date": appt.starts_at.strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.strftime("%H:%M"),
    }

    now = datetime.now(timezone.utc)

    # WhatsApp
    wa_template = settings.cancel_wa_template or "מצטערים, התור שלך בוטל. נשמח לקבוע תור חדש בהקדם!"
    if client.phone and client.marketing_consent is not False:
        body = smart_format(wa_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            channel="whatsapp",
            to_phone=client.phone,
            body=body,
            scheduled_at=now,
            status="pending",
        ))

    # Email
    email_template = settings.cancel_email_template or "מצטערים, התור שלך בוטל. נשמח לקבוע תור חדש בהקדם!"
    if client.email and settings.smtp_host and client.marketing_consent is not False:
        body = smart_format(email_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            channel="email",
            to_phone=client.email,
            body=body,
            scheduled_at=now,
            status="pending",
        ))

    db.commit()

def enqueue_post_payment_message(db: Session, appt: Appointment, amount_cents: int) -> None:
    settings = db.get(StudioSettings, appt.studio_id)
    client = db.get(Client, appt.client_id)
    if not settings or not client:
        return

    context = {
        "client_name": client.full_name,
        "appointment_title": appt.title,
        "appointment_date": appt.starts_at.strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.strftime("%H:%M"),
        "payment_amount": f"{amount_cents / 100:.2f}",
        "points_total": client.loyalty_points,
    }

    now = datetime.now(timezone.utc)

    # WhatsApp
    wa_template = settings.post_payment_wa_template
    if not wa_template:
        wa_template = "תודה על התשלום! שמחים שבחרת בנו."
    if client.phone:
        body = smart_format(wa_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            channel="whatsapp",
            to_phone=client.phone,
            body=body,
            scheduled_at=now,
            status="pending",
        ))

    # Email
    email_template = settings.post_payment_email_template
    if not email_template:
        email_template = "תודה על התשלום! שמחים שבחרת בנו."
    if client.email and settings.smtp_host:
        body = smart_format(email_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            channel="email",
            to_phone=client.email,
            body=body,
            scheduled_at=now,
            status="pending",
        ))
    
    db.commit()

def build_aftercare_message(settings: StudioSettings, client: Client, points_added: int, points_total: int) -> str:
    parts: list[str] = []
    if settings.aftercare_message:
        parts.append(settings.aftercare_message.strip())

    # Links
    if settings.review_link_google:
        parts.append(f"\n⭐ Google Review:\n{settings.review_link_google.strip()}")
    if settings.review_link_instagram:
        parts.append(f"\n📸 Instagram:\n{settings.review_link_instagram.strip()}")
    if settings.review_link_facebook:
        parts.append(f"\n📘 Facebook:\n{settings.review_link_facebook.strip()}")
    if settings.review_link_whatsapp:
        parts.append(f"\n💬 WhatsApp:\n{settings.review_link_whatsapp.strip()}")

    parts.append(f"\n🎁 נקודות:\nצברת {points_added} נקודות. סה״כ: {points_total}")
    return "\n".join(parts).strip()

def enqueue_aftercare_if_needed(db: Session, appt: Appointment) -> None:
    """
    Idempotent:
    - אם כבר enqueued בעבר -> לא עושה כלום
    - אם הסטטוס לא done -> לא עושה כלום
    """
    if appt.status != "done":
        return
    if appt.automation_enqueued_at is not None:
        return

    settings = db.get(StudioSettings, appt.studio_id)
    client = db.get(Client, appt.client_id)
    if not settings or not client:
        return

    # אם לא רוצים לשלוח בלי הסכמה
    if client.marketing_consent is False:
        # עדיין אפשר לתת נקודות אם תרצה; כרגע נעשה גם וגם רק אם יש הסכמה
        return

    # done_at פעם ראשונה
    now = datetime.now(timezone.utc)
    if appt.done_at is None:
        appt.done_at = now

    # נקודות על סיום תור - לא מופעל יותר (מנגנון הנקודות הוא קאשבק מתשלום בלבד)
    points = 0

    # היתרה אצלך היא loyalty_points - לא מוסיפים כלום
    # (הלוג נשמר עם 0 כדי לא לשבור את ה-aftercare message)

    db.add(ClientPointsLedger(
        studio_id=appt.studio_id,
        client_id=appt.client_id,
        appointment_id=appt.id,
        delta_points=0,
        reason="Appointment done - no auto points (cashback only)",
    ))

    # message job
    delay = int(settings.aftercare_delay_minutes or 0)
    scheduled_at = (appt.done_at or now) + timedelta(minutes=delay)

    body = build_aftercare_message(settings, client, points_added=points, points_total=client.loyalty_points)

    # חייב טלפון כדי לשלוח
    if not client.phone:
        # אם אין טלפון: רק נקודות, בלי job
        appt.automation_enqueued_at = now
        return

    db.add(MessageJob(
        studio_id=appt.studio_id,
        client_id=appt.client_id,
        appointment_id=appt.id,
        channel="whatsapp",
        to_phone=client.phone,
        body=body,
        scheduled_at=scheduled_at,
        status="pending",
        attempts=0,
    ))

    appt.automation_enqueued_at = now
