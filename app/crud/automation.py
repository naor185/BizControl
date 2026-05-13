import os
from datetime import datetime, timedelta, timezone
from uuid import UUID
from sqlalchemy.orm import Session
import pytz

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


def _build_context(settings: StudioSettings, client: Client, appt: Appointment, artist_name: str = "") -> dict:
    base_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    deposit_amount = appt.deposit_amount_cents / 100 if appt.deposit_amount_cents else 0
    bank_details = ""
    if settings.bank_name or settings.bank_branch or settings.bank_account:
        bank_details = f"{settings.bank_name or ''} | סניף {settings.bank_branch or ''} | חשבון {settings.bank_account or ''}"
    return {
        "client_name": client.full_name or "",
        "appointment_title": appt.title or "",
        "appointment_date": appt.starts_at.astimezone(pytz.timezone(settings.timezone or "Asia/Jerusalem")).strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.astimezone(pytz.timezone(settings.timezone or "Asia/Jerusalem")).strftime("%H:%M"),
        "payment_link": f"{base_url}/pay/{appt.id}",
        "deposit_amount": f"{deposit_amount:.0f}" if deposit_amount == int(deposit_amount) else f"{deposit_amount:.2f}",
        "artist_name": artist_name,
        "studio_address": settings.studio_address or "",
        "map_link": settings.studio_map_link or "",
        "portfolio_link": settings.studio_portfolio_link or "",
        "bit_link": settings.bit_link or "",
        "paybox_link": settings.paybox_link or "",
        "bank_details": bank_details,
        "cancellation_free_days": str(settings.cancellation_free_days or 7),
        "deposit_lock_days": str(settings.deposit_lock_days or 7),
        "loyalty_points": str(client.loyalty_points or 0),
        "join_link": f"{base_url}/join/{appt.studio_id}",
        "contact_phone": "",
    }


def enqueue_confirmation_message(db: Session, appt: Appointment, artist_name: str = "") -> None:
    """Queue confirmation or deposit-request message for a NEW appointment."""
    settings = db.get(StudioSettings, appt.studio_id)
    client = db.get(Client, appt.client_id)
    if not settings or not client:
        return

    context = _build_context(settings, client, appt, artist_name)
    now = datetime.now(timezone.utc)
    has_deposit = bool(appt.deposit_amount_cents and appt.deposit_amount_cents > 0)

    # --- WhatsApp ---
    if client.phone:
        if has_deposit and settings.deposit_request_wa_template:
            wa_body = smart_format(settings.deposit_request_wa_template, context)
        elif settings.confirm_wa_template:
            wa_body = smart_format(settings.confirm_wa_template, context)
        else:
            wa_body = f"שלום {client.full_name}, התור שלך ל-{appt.title} נקבע ליום {context['appointment_date']} בשעה {context['appointment_time']}."
        db.add(MessageJob(
            studio_id=appt.studio_id, client_id=client.id, appointment_id=appt.id,
            channel="whatsapp", to_phone=client.phone, body=wa_body,
            scheduled_at=now, status="pending",
        ))

    # --- Email ---
    if client.email and settings.smtp_host and settings.confirm_email_template:
        email_body = smart_format(settings.confirm_email_template, context)
        db.add(MessageJob(
            studio_id=appt.studio_id, client_id=client.id, appointment_id=appt.id,
            channel="email", to_phone=client.email, body=email_body,
            scheduled_at=now, status="pending",
        ))

    db.commit()


def enqueue_deposit_approved_message(db: Session, appt: Appointment, artist_name: str = "") -> None:
    """Send full details message after studio owner approves the deposit."""
    settings = db.get(StudioSettings, appt.studio_id)
    client = db.get(Client, appt.client_id)
    if not settings or not client or not client.phone:
        return

    context = _build_context(settings, client, appt, artist_name)
    now = datetime.now(timezone.utc)

    template = settings.deposit_approved_wa_template
    if not template:
        template = (
            "✅ {client_name}, המקדמה אושרה!\n\n"
            "📅 {appointment_date} בשעה {appointment_time}\n"
            "✂️ {artist_name}\n"
            "📍 {studio_address}\n"
            "🗺️ ניווט: {map_link}\n"
            "🖼️ תיק עבודות: {portfolio_link}\n\n"
            "מדיניות ביטולים: ביטול עד {cancellation_free_days} ימים לפני — החזר מלא. "
            "פחות מ-{cancellation_free_days} ימים — ללא החזר. "
            "שינוי תור עד {deposit_lock_days} ימים לפני בלבד.\n\nמחכים לך! 🙏"
        )

    db.add(MessageJob(
        studio_id=appt.studio_id, client_id=client.id, appointment_id=appt.id,
        channel="whatsapp", to_phone=client.phone,
        body=smart_format(template, context),
        scheduled_at=now, status="pending",
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
        "appointment_date": appt.starts_at.astimezone(pytz.timezone(settings.timezone or "Asia/Jerusalem")).strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.astimezone(pytz.timezone(settings.timezone or "Asia/Jerusalem")).strftime("%H:%M"),
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
        "appointment_date": appt.starts_at.astimezone(pytz.timezone(settings.timezone or "Asia/Jerusalem")).strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.astimezone(pytz.timezone(settings.timezone or "Asia/Jerusalem")).strftime("%H:%M"),
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

    # ── Calculate cashback points ────────────────────────────
    pct = int(getattr(settings, "points_percent_per_payment", 5) or 5)
    points_earned = int(amount_cents / 100 * pct / 100)
    if points_earned > 0:
        client.loyalty_points = (client.loyalty_points or 0) + points_earned
        db.add(ClientPointsLedger(
            studio_id=appt.studio_id,
            client_id=client.id,
            appointment_id=appt.id,
            delta_points=points_earned,
            reason=f"cashback {pct}% on payment ₪{amount_cents/100:.2f}",
        ))
        db.flush()

    # ── Build review block ───────────────────────────────────
    review_lines: list[str] = []
    if settings.review_link_google:
        review_lines.append(f"⭐ Google: {settings.review_link_google.strip()}")
    if settings.review_link_instagram:
        review_lines.append(f"📸 Instagram: {settings.review_link_instagram.strip()}")
    if settings.review_link_facebook:
        review_lines.append(f"👍 Facebook: {settings.review_link_facebook.strip()}")
    if settings.review_link_whatsapp:
        review_lines.append(f"💬 WhatsApp: {settings.review_link_whatsapp.strip()}")
    review_block = ("\n\n🙏 היה לנו כיף! נשמח אם תשאיר ביקורת:\n" + "\n".join(review_lines)) if review_lines else ""

    # ── Aftercare block ──────────────────────────────────────
    aftercare_block = ""
    if settings.aftercare_message:
        aftercare_block = f"\n\n💊 הוראות טיפול:\n{settings.aftercare_message.strip()}"

    # ── Points block ─────────────────────────────────────────
    points_total = client.loyalty_points or 0
    points_block = f"\n\n🎁 נקודות נאמנות:\nצברת {points_earned} נקודות על התשלום הזה!\nסה\"כ: {points_total} נקודות."

    context = {
        "client_name": client.full_name,
        "appointment_title": appt.title,
        "appointment_date": appt.starts_at.astimezone(pytz.timezone(settings.timezone or "Asia/Jerusalem")).strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.astimezone(pytz.timezone(settings.timezone or "Asia/Jerusalem")).strftime("%H:%M"),
        "payment_amount": f"{amount_cents / 100:.2f}",
        "points_earned": str(points_earned),
        "points_total": str(points_total),
        "review_block": review_block,
        "aftercare_block": aftercare_block,
        "points_block": points_block,
    }

    now = datetime.now(timezone.utc)

    # ── WhatsApp ──────────────────────────────────────────────
    wa_template = settings.post_payment_wa_template
    if not wa_template:
        wa_template = (
            "תודה {client_name}! 🙏 קיבלנו תשלום של ₪{payment_amount}."
            "{points_block}"
            "{aftercare_block}"
            "{review_block}"
        )
    if client.phone:
        db.add(MessageJob(
            studio_id=appt.studio_id, client_id=client.id, appointment_id=appt.id,
            channel="whatsapp", to_phone=client.phone,
            body=smart_format(wa_template, context),
            scheduled_at=now, status="pending",
        ))

    # ── Email ─────────────────────────────────────────────────
    email_template = settings.post_payment_email_template
    if not email_template:
        review_html = ""
        if review_lines:
            links_html = "".join(f'<li><a href="{l.split(": ", 1)[-1]}" style="color:#111;">{l.split(": ", 1)[0]}</a></li>' for l in review_lines)
            review_html = f'<h3 style="color:#333;">🙏 נשמח לביקורת!</h3><ul style="line-height:2;">{links_html}</ul>'
        aftercare_html = f'<h3 style="color:#333;">💊 הוראות טיפול</h3><p style="color:#555;">{settings.aftercare_message}</p>' if settings.aftercare_message else ""
        points_html = f'<div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;margin:16px 0;"><strong style="color:#166534;">🎁 צברת {points_earned} נקודות!</strong><br><span style="color:#555;">סה"כ: {points_total} נקודות.</span></div>' if points_earned > 0 else f'<p style="color:#555;">סה"כ נקודות: {points_total}</p>'
        email_template = f"""<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">
  <div style="background:#111;padding:24px 30px;border-radius:12px 12px 0 0;">
    <span style="color:#fff;font-size:20px;font-weight:bold;">תודה על התשלום! 🙏</span>
  </div>
  <div style="padding:24px 30px;background:#fafafa;">
    <p>היי {{client_name}},</p>
    <p>קיבלנו תשלום של <strong>₪{{payment_amount}}</strong> עבור <strong>{{appointment_title}}</strong>.</p>
    {points_html}
    {aftercare_html}
    {review_html}
  </div>
  <div style="padding:12px 30px;background:#f3f4f6;text-align:center;font-size:11px;color:#9ca3af;border-radius:0 0 12px 12px;">BizControl</div>
</div>"""
    if client.email and settings.smtp_host:
        db.add(MessageJob(
            studio_id=appt.studio_id, client_id=client.id, appointment_id=appt.id,
            channel="email", to_phone=client.email,
            body=smart_format(email_template, context),
            scheduled_at=now, status="pending",
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

    # נקודות על סיום תור
    points = int(settings.points_per_done_appointment or 0)
    if points > 0:
        client.loyalty_points = (client.loyalty_points or 0) + points
        db.add(ClientPointsLedger(
            studio_id=appt.studio_id,
            client_id=appt.client_id,
            appointment_id=appt.id,
            delta_points=points,
            reason=f"Appointment done - {points} points awarded",
        ))
        db.flush()

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
