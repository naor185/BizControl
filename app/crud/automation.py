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
        has_dep = context.get("deposit_amount") and float(context.get("deposit_amount", 0)) > 0
        if has_dep:
            lines.append(f"💳 מקדמה: {context['deposit_amount']} ₪")
        if has_dep and context.get("payment_link"):
            lines.append(f"🔗 {context['payment_link']}")
        if context.get("studio_address"):
            lines.append(f"📍 {context['studio_address']}")
        if context.get("map_link"):
            lines.append(f"🗺️ ניווט: {context['map_link']}")
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

    # Strip payment placeholders when no deposit so templates don't leak Bit/Paybox links
    if not has_deposit:
        context["bit_link"] = ""
        context["paybox_link"] = ""
        context["payment_link"] = ""
        context["deposit_amount"] = ""

    # --- WhatsApp ---
    if client.phone:
        if has_deposit and settings.deposit_request_wa_template:
            wa_body = smart_format(settings.deposit_request_wa_template, context)
        elif settings.confirm_wa_template:
            wa_body = smart_format(settings.confirm_wa_template, context)
        else:
            lines = [
                f"שלום {client.full_name} 👋",
                f"התור שלך ל{appt.title} נקבע בהצלחה ✅",
                "",
                f"📅 תאריך: {context['appointment_date']}",
                f"🕐 שעה: {context['appointment_time']}",
            ]
            if context.get("artist_name"):
                lines.append(f"✂️ {context['artist_name']}")
            if has_deposit and context.get("payment_link"):
                lines += ["", f"💳 לתשלום המקדמה:", context["payment_link"]]
            if context.get("studio_address"):
                lines += ["", f"📍 {context['studio_address']}"]
            if context.get("map_link"):
                lines.append(f"🗺️ ניווט: {context['map_link']}")
            if context.get("portfolio_link"):
                lines.append(f"🖼️ תיק עבודות: {context['portfolio_link']}")
            cancellation_days = context.get("cancellation_free_days")
            if cancellation_days:
                lines += [
                    "",
                    f"ביטול ללא עלות עד {cancellation_days} ימים לפני התור.",
                ]
            lines += ["", "מחכים לך! 🙏"]
            wa_body = "\n".join(lines)
        db.add(MessageJob(
            studio_id=appt.studio_id, client_id=client.id, appointment_id=appt.id,
            channel="whatsapp", to_phone=client.phone, body=wa_body,
            scheduled_at=now, status="pending",
        ))

    # --- Email ---
    if client.email and settings.resend_api_key and settings.confirm_email_template:
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

    tz = pytz.timezone(settings.timezone or "Asia/Jerusalem")
    local_dt = appt.starts_at.astimezone(tz)
    _DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
    day_name = _DAY_NAMES[local_dt.weekday() % 7] if local_dt.weekday() != 6 else "שבת"
    # Python weekday: 0=Mon..6=Sun, Israeli week starts Sunday
    _HE_DAYS = {0: "שני", 1: "שלישי", 2: "רביעי", 3: "חמישי", 4: "שישי", 5: "שבת", 6: "ראשון"}
    day_name = _HE_DAYS.get(local_dt.weekday(), "")

    context = {
        "client_name": client.full_name,
        "appointment_title": appt.title,
        "appointment_date": local_dt.strftime("%d/%m/%Y"),
        "appointment_time": local_dt.strftime("%H:%M"),
        "appointment_day": day_name,
    }

    now = datetime.now(timezone.utc)

    # WhatsApp Reschedule
    wa_template = settings.reschedule_wa_template
    if not wa_template:
        wa_template = (
            "🔄 עדכון תור\n\n"
            "היי {client_name}! 👋\n\n"
            "התור שלך ל *{appointment_title}* עודכן למועד חדש:\n"
            "📅 יום {appointment_day}, {appointment_date}\n"
            "🕐 שעה {appointment_time}\n\n"
            "אם יש שאלות — אנחנו כאן 😊\n"
            "מחכים לראותך! 🙏"
        )

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

    if client.email and settings.resend_api_key:
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
    if client.email and settings.resend_api_key and client.marketing_consent is not False:
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

def enqueue_post_payment_message(db: Session, appt: Appointment, amount_cents: int, points_earned: int = 0) -> None:
    from sqlalchemy import select as _select
    settings = db.get(StudioSettings, appt.studio_id)
    client = db.get(Client, appt.client_id)
    if not settings or not client:
        return

    # לקוח שביקש הסרה לא מקבל הודעה
    if getattr(client, "whatsapp_opted_out", False):
        return

    # ── Dedup: skip if post-payment thank-you already sent for this appointment ──
    already = db.scalar(
        _select(MessageJob).where(
            MessageJob.appointment_id == appt.id,
            MessageJob.reminder_type.in_(["post_payment", "aftercare"]),
        )
    )
    if already:
        return

    # ── Build review block — Google only ────────────────────
    review_block = ""
    if settings.review_link_google:
        review_block = (
            "\n\n⭐ נשמח לביקורת שלך בגוגל!\n"
            f"{settings.review_link_google.strip()}"
        )

    # ── Aftercare block — substitute {client_name} first ─────
    aftercare_block = ""
    if settings.aftercare_message:
        aftercare_text = format_template(settings.aftercare_message.strip(), {"client_name": client.full_name or ""})
        aftercare_block = f"\n\n{aftercare_text}"

    # ── Points block — only for club members ─────────────────
    points_total = client.loyalty_points or 0
    if client.is_club_member:
        if points_earned > 0:
            points_block = f"\n\n🎁 כחבר/ת מועדון צברת {points_earned} נקודות!\nסה\"כ: {points_total} נקודות."
        else:
            points_block = f"\n\n🎁 סה\"כ נקודות במועדון: {points_total} נקודות."
    else:
        points_block = ""

    tz = pytz.timezone(settings.timezone or "Asia/Jerusalem")
    context = {
        "client_name": client.full_name,
        "appointment_title": appt.title,
        "appointment_date": appt.starts_at.astimezone(tz).strftime("%d/%m/%Y"),
        "appointment_time": appt.starts_at.astimezone(tz).strftime("%H:%M"),
        "payment_amount": "",          # intentionally blank — never show amount to client
        "points_earned": str(points_earned) if client.is_club_member else "",
        "points_total": str(points_total) if client.is_club_member else "",
        "review_block": review_block,
        "aftercare_block": aftercare_block,
        "points_block": points_block,
    }

    now = datetime.now(timezone.utc)

    # ── WhatsApp ──────────────────────────────────────────────
    wa_template = settings.post_payment_wa_template
    if not wa_template:
        wa_template = (
            "היי {client_name}! 😊\n"
            "שמחים שבחרת בנו ❤️"
            "{points_block}"
            "{aftercare_block}"
            "{review_block}"
        )
    if client.phone:
        wa_body = smart_format(wa_template, context)
        # Always append aftercare/review if not already embedded in the template
        if aftercare_block and "{aftercare_block}" not in wa_template:
            wa_body += aftercare_block
        if review_block and "{review_block}" not in wa_template:
            wa_body += review_block
        db.add(MessageJob(
            studio_id=appt.studio_id, client_id=client.id, appointment_id=appt.id,
            channel="whatsapp", to_phone=client.phone,
            body=wa_body,
            scheduled_at=now, status="pending",
            reminder_type="post_payment",
        ))

    # ── Email ─────────────────────────────────────────────────
    email_template = settings.post_payment_email_template
    if not email_template:
        review_html = ""
        if settings.review_link_google:
            review_html = (
                f'<h3 style="color:#333;">⭐ נשמח לביקורת שלך בגוגל!</h3>'
                f'<p><a href="{settings.review_link_google.strip()}" style="color:#111;">'
                f'{settings.review_link_google.strip()}</a></p>'
            )
        aftercare_html = f'<h3 style="color:#333;">💊 הוראות טיפול</h3><p style="color:#555;">{settings.aftercare_message}</p>' if settings.aftercare_message else ""
        points_html = f'<div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;margin:16px 0;"><strong style="color:#166534;">🎁 צברת {points_earned} נקודות!</strong><br><span style="color:#555;">סה"כ: {points_total} נקודות.</span></div>' if points_earned > 0 else ""
        email_template = f"""<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">
  <div style="background:#111;padding:24px 30px;border-radius:12px 12px 0 0;">
    <span style="color:#fff;font-size:20px;font-weight:bold;">תודה על התשלום! 🙏</span>
  </div>
  <div style="padding:24px 30px;background:#fafafa;">
    <p>היי {{client_name}},</p>
    <p>תודה על הביקור! 🙏</p>
    {points_html}
    {aftercare_html}
    {review_html}
  </div>
  <div style="padding:12px 30px;background:#f3f4f6;text-align:center;font-size:11px;color:#9ca3af;border-radius:0 0 12px 12px;">BizControl</div>
</div>"""
    if client.email and settings.resend_api_key:
        email_body = smart_format(email_template, context)
        # Plain-text custom email templates also need aftercare and review appended
        if "{" not in email_template:
            if aftercare_block:
                email_body += aftercare_block
            if review_block:
                email_body += review_block
        db.add(MessageJob(
            studio_id=appt.studio_id, client_id=client.id, appointment_id=appt.id,
            channel="email", to_phone=client.email,
            body=email_body,
            scheduled_at=now, status="pending",
            reminder_type="aftercare",
        ))

    db.commit()

def maybe_enqueue_club_invite(db: Session, studio_id, client, appointment_id=None) -> bool:
    """
    שולח הזמנה למועדון ללקוח שאינו חבר — אם הפיצ'ר מופעל בהגדרות.
    מחזיר True אם נוסף ל-queue, False אחרת.
    """
    import os as _os
    from app.models.studio_settings import StudioSettings
    from app.models.studio import Studio

    if not client or not client.phone:
        return False
    if getattr(client, "whatsapp_opted_out", False):
        return False
    if client.is_club_member:
        return False

    settings = db.get(StudioSettings, studio_id)
    if not settings:
        return False

    # בדיקת toggle
    if not getattr(settings, "club_invite_enabled", True):
        return False

    # dedup — שלחנו פעם אחת בלבד לכל לקוח
    from sqlalchemy import select as _sel
    already = db.scalar(
        _sel(MessageJob).where(
            MessageJob.studio_id == studio_id,
            MessageJob.client_id == client.id,
            MessageJob.reminder_type == "club_invite",
        )
    )
    if already:
        return False

    from app.models.studio import Studio
    from app.api.invite_routes import create_invite_token
    frontend_url = _os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    studio = db.get(Studio, studio_id)
    slug = studio.slug if studio else None
    join_link = f"{frontend_url}/s/{slug}" if slug else ""
    optout_token = create_invite_token(str(studio_id), str(client.id))
    optout_link = f"{frontend_url}/optout/{optout_token}"
    points_on_signup = int(getattr(settings, "points_on_signup", 50) or 50)

    template = getattr(settings, "non_member_wa_template", None) or (
        "היי {client_name}! 👋\n\n"
        "שמחים שביקרת אצלנו!\n"
        "הצטרף/י למועדון הלקוחות שלנו וקבל/י {points_on_signup} נקודות מתנה לביקור הבא 🎉\n\n"
        "הרשמה: {join_link}\n\n"
        "להסרה מרשימת ההודעות: {optout_link}"
    )

    body = format_template(template, {
        "client_name": client.full_name or "",
        "points_on_signup": points_on_signup,
        "join_link": join_link,
        "optout_link": optout_link,
    })

    delay = int(getattr(settings, "club_invite_delay_minutes", 30) or 30)
    scheduled_at = datetime.now(timezone.utc) + timedelta(minutes=delay)

    db.add(MessageJob(
        studio_id=studio_id,
        client_id=client.id,
        appointment_id=appointment_id,
        channel="whatsapp",
        to_phone=client.phone,
        body=body,
        scheduled_at=scheduled_at,
        status="pending",
        reminder_type="club_invite",
    ))
    db.commit()
    return True


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

    # לקוח שביקש הסרה
    if getattr(client, "whatsapp_opted_out", False):
        return

    # אם לא רוצים לשלוח בלי הסכמה
    if client.marketing_consent is False:
        return

    # Dedup: אם כבר נשלחה הודעת post_payment לאותו תור — לא לשלוח aftercare נוסף
    from sqlalchemy import select as _sel_ac
    already_post_payment = db.scalar(
        _sel_ac(MessageJob).where(
            MessageJob.appointment_id == appt.id,
            MessageJob.reminder_type == "post_payment",
        )
    ) if appt.id else None
    if already_post_payment:
        appt.automation_enqueued_at = datetime.now(timezone.utc)
        return

    # בדוק אם סוג הטיפול של התור מצריך שליחת הוראות טיפול
    # אם אין treatment_types מוגדרים — שולחים לכולם (ברירת מחדל)
    # אם יש — שולחים רק לסוגים שסומנו send_aftercare=True
    import json as _json
    aftercare_allowed = True
    raw_types = getattr(settings, "treatment_types", None)
    if raw_types:
        try:
            types_list = _json.loads(raw_types) if isinstance(raw_types, str) else raw_types
            if any(t.get("send_aftercare") is not None for t in types_list):
                # יש לפחות סוג אחד עם הגדרה מפורשת — בדוק לפי שם התור
                appt_title = (appt.title or "").strip().lower()
                aftercare_allowed = any(
                    t.get("send_aftercare") and t.get("name", "").strip().lower() in appt_title
                    for t in types_list
                )
        except Exception:
            pass

    if not aftercare_allowed:
        appt.automation_enqueued_at = datetime.now(timezone.utc)
        return

    # done_at פעם ראשונה
    now = datetime.now(timezone.utc)
    if appt.done_at is None:
        appt.done_at = now

    # נקודות על סיום תור — מבוטל, נקודות ניתנות רק דרך קאשבק על תשלום
    points = 0

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
