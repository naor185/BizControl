from __future__ import annotations
from datetime import datetime, timezone, timedelta, date
from sqlalchemy import select
from sqlalchemy.orm import Session
import asyncio
import pytz

from app.models.message_job import MessageJob
from app.models.studio_settings import StudioSettings
from app.models.appointment import Appointment
from app.models.client import Client
from app.crud.automation import format_template
from app.utils.email_utils import send_email
from app.utils.logger import get_logger

log = get_logger(__name__)

_IL_TZ = pytz.timezone("Asia/Jerusalem")


def _send_via_meta(phone_id: str, token: str, to_phone: str, body: str) -> None:
    import urllib.request, urllib.error, json as _json
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
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = _json.loads(resp.read())
            if "error" in result:
                raise RuntimeError(f"Meta API error: {result['error'].get('message', result['error'])}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            err_msg = _json.loads(raw).get("error", {}).get("message", raw)
        except Exception:
            err_msg = raw
        raise RuntimeError(f"Meta API error {e.code}: {err_msg}")


def _send_via_green(instance_id: str, api_key: str, to_phone: str, body: str) -> None:
    import urllib.request, json as _json
    url = f"https://api.green-api.com/waInstance{instance_id}/sendMessage/{api_key}"
    clean = to_phone.replace("+", "").replace(" ", "").replace("-", "")
    if clean.startswith("0") and len(clean) >= 9:
        clean = "972" + clean[1:]
    if not clean.endswith("@c.us"):
        clean = f"{clean}@c.us"
    payload = _json.dumps({"chatId": clean, "message": body}).encode()
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"Green API error {resp.status}")


def _get_platform_settings(db: Session):
    """Return platform-level StudioSettings as WhatsApp fallback."""
    import os
    platform_id = os.getenv("PLATFORM_STUDIO_ID", "")
    if not platform_id:
        return None
    try:
        import uuid as _uuid
        return db.get(StudioSettings, _uuid.UUID(platform_id))
    except Exception:
        return None


def _log_whatsapp(db: Session, studio_id, phone: str, body: str, status: str,
                   provider: str = "", instance_id: str = "", error: str = "") -> None:
    """Write to whatsapp_logs (best-effort, never raises)."""
    if not db or not studio_id:
        return
    try:
        from sqlalchemy import text as _t
        db.execute(_t("""
            INSERT INTO whatsapp_logs
                (id, studio_id, phone, message, status, provider, instance_id, error_message)
            VALUES
                (gen_random_uuid(), :sid, :ph, :msg, :st, :prov, :iid, :err)
        """), {
            "sid": str(studio_id), "ph": phone,
            "msg": body[:2000] if body else "",
            "st": status, "prov": provider, "iid": instance_id, "err": error,
        })
        db.commit()
    except Exception:
        try: db.rollback()
        except Exception: pass


def send_whatsapp_message(to_phone: str, body: str, settings=None, db: Session | None = None) -> None:
    provider = getattr(settings, "whatsapp_provider", None) if settings else None
    studio_id = getattr(settings, "studio_id", None) if settings else None

    # Fall back to platform WhatsApp if studio has none configured
    if not provider and db is not None:
        platform = _get_platform_settings(db)
        if platform and platform.whatsapp_provider:
            settings = platform
            provider = platform.whatsapp_provider

    if not provider:
        raise ValueError("WhatsApp provider not configured for this studio")

    instance_id_used = ""
    try:
        if provider == "green_api":
            instance_id = getattr(settings, "whatsapp_instance_id", None)
            api_key = getattr(settings, "whatsapp_api_key", None)
            if not instance_id or not api_key:
                raise ValueError("Green API credentials missing (instance_id or api_key)")
            instance_id_used = instance_id
            _send_via_green(instance_id, api_key, to_phone, body)

        elif provider == "meta":
            phone_id = getattr(settings, "whatsapp_phone_id", None)
            api_key = getattr(settings, "whatsapp_api_key", None)
            if not phone_id or not api_key:
                raise ValueError("Meta API credentials missing (phone_id or api_key)")
            _send_via_meta(phone_id, api_key, to_phone, body)

        else:
            raise ValueError(f"Unknown WhatsApp provider: '{provider}'")

        _log_whatsapp(db, studio_id, to_phone, body, "sent", provider, instance_id_used)

    except Exception as exc:
        _log_whatsapp(db, studio_id, to_phone, body, "failed", provider, instance_id_used, str(exc))
        raise


def process_due_jobs(db: Session, limit: int = 20) -> int:
    now = datetime.now(timezone.utc)

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
            if job.channel == "whatsapp" and job.client_id:
                client = db.get(Client, job.client_id)
                if client and getattr(client, "whatsapp_opted_out", False):
                    job.status = "canceled"
                    job.last_error = "Client opted out of WhatsApp"
                    count += 1
                    continue

            if job.channel == "email":
                settings = db.get(StudioSettings, job.studio_id)
                if not settings or not settings.resend_api_key:
                    raise ValueError("Resend API key not configured for this studio")
                asyncio.run(
                    send_email(
                        api_key=settings.resend_api_key,
                        from_email=settings.resend_from_email or "",
                        to_email=job.to_phone,
                        subject="הודעה מסטודיו BizControl",
                        html_content=job.body,
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


def _build_reminder_context(appt: Appointment, client: Client, settings: StudioSettings) -> dict:
    tz = pytz.timezone(settings.timezone or "Asia/Jerusalem")
    local_dt = appt.starts_at.astimezone(tz)
    has_deposit = bool(appt.deposit_amount_cents and appt.deposit_amount_cents > 0)
    deposit_paid = appt.payment_verified_at is not None
    payment_link = settings.bit_link or settings.paybox_link or ""
    return {
        "client_name": client.full_name,
        "appointment_title": appt.title,
        "appointment_date": local_dt.strftime("%d/%m/%Y"),
        "appointment_time": local_dt.strftime("%H:%M"),
        "payment_link": payment_link,
        "deposit_amount": f"{appt.deposit_amount_cents / 100:.0f}" if appt.deposit_amount_cents else "0",
        "has_deposit": has_deposit,
        "deposit_paid": deposit_paid,
        "studio_address": settings.studio_address or "",
        "map_link": settings.studio_map_link or "",
    }


def _already_enqueued(db: Session, appointment_id, reminder_type: str) -> bool:
    return bool(db.scalar(
        select(MessageJob).where(
            MessageJob.appointment_id == appointment_id,
            MessageJob.reminder_type == reminder_type,
        )
    ))


def _sweep_reminders_for_window(
    db: Session,
    hours_ahead: int,
    window_hours: int = 4,
    reminder_type: str = "",
    enabled_attr: str = "",
    wa_template_attr: str = "",
    wa_default: str = "",
    wa_deposit_default: str = "",
    email_default: str = "",
) -> int:
    """Generic reminder sweep for any time window ahead of now."""
    now = datetime.now(timezone.utc)
    target_start = now + timedelta(hours=hours_ahead - window_hours / 2)
    target_end   = now + timedelta(hours=hours_ahead + window_hours / 2)

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
        # Per-studio toggle check
        if enabled_attr and not getattr(settings, enabled_attr, True):
            continue

        if _already_enqueued(db, appt.id, reminder_type):
            continue

        ctx = _build_reminder_context(appt, client, settings)
        has_deposit = ctx["has_deposit"]
        deposit_paid = ctx["deposit_paid"]

        # Pick WA template: custom from settings → deposit-aware default → generic default
        custom_wa = getattr(settings, wa_template_attr, None) if wa_template_attr else None
        if custom_wa:
            chosen_wa = custom_wa
        elif has_deposit and not deposit_paid and wa_deposit_default:
            chosen_wa = wa_deposit_default
        else:
            chosen_wa = wa_default

        # Add deposit warning line if deposit pending and studio has it enabled
        if (has_deposit and not deposit_paid
                and getattr(settings, "deposit_warning_enabled", True)
                and ctx.get("payment_link")
                and chosen_wa == wa_default):
            chosen_wa = wa_deposit_default or wa_default

        wa_body = format_template(chosen_wa, ctx) if chosen_wa else None
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
                reminder_type=reminder_type,
            ))
            count += 1

        if email_default and client.email and settings.resend_api_key:
            email_body = format_template(email_default, ctx)
            db.add(MessageJob(
                studio_id=appt.studio_id,
                client_id=client.id,
                appointment_id=appt.id,
                channel="email",
                to_phone=client.email,
                body=email_body,
                scheduled_at=now,
                status="pending",
                reminder_type=f"{reminder_type}_email",
            ))
            count += 1

    if count:
        db.commit()
    return count


def sweep_upcoming_reminders(db: Session) -> int:
    """תזכורת יום לפני התור — נשלחת כ-24 שעות מראש."""
    return _sweep_reminders_for_window(
        db,
        hours_ahead=24,
        window_hours=4,
        reminder_type="1day",
        enabled_attr="reminder_1_day_enabled",
        wa_template_attr="reminder_wa_template",
        wa_default=(
            "היי {client_name} 👋\n"
            "תזכורת ידידותית — מחר יש לך תור!\n\n"
            "📋 {appointment_title}\n"
            "📅 {appointment_date} בשעה {appointment_time}\n\n"
            "מחכים לך!"
        ),
        wa_deposit_default=(
            "היי {client_name} 👋\n"
            "תזכורת ידידותית — מחר יש לך תור!\n\n"
            "📋 {appointment_title}\n"
            "📅 {appointment_date} בשעה {appointment_time}\n\n"
            "⚠️ שים לב: טרם שולמה מקדמה בסך ₪{deposit_amount}.\n"
            "לתשלום: {payment_link}\n\n"
            "מחכים לך!"
        ),
        email_default=(
            "<div dir='rtl' style='font-family:Arial,sans-serif;padding:20px'>"
            "<h2>תזכורת לתור מחר 📅</h2>"
            "<p>היי {client_name},</p>"
            "<p>רק מזכירים שיש לנו פגישה מחר — <strong>{appointment_title}</strong>.</p>"
            "<p><strong>מתי?</strong> {appointment_date} בשעה {appointment_time}</p>"
            "<p>נתראה!</p>"
            "</div>"
        ),
    )


def sweep_7day_reminders(db: Session) -> int:
    """תזכורת שבוע לפני התור."""
    return _sweep_reminders_for_window(
        db,
        hours_ahead=7 * 24,
        window_hours=4,
        reminder_type="7day",
        enabled_attr="reminder_7_days_enabled",
        wa_template_attr="reminder_7day_wa_template",
        wa_default=(
            "היי {client_name} 👋\n"
            "רצינו להזכיר — בעוד שבוע יש לך תור!\n\n"
            "📋 {appointment_title}\n"
            "📅 {appointment_date} בשעה {appointment_time}\n\n"
            "מחכים לך!"
        ),
        wa_deposit_default=(
            "היי {client_name} 👋\n"
            "רצינו להזכיר — בעוד שבוע יש לך תור!\n\n"
            "📋 {appointment_title}\n"
            "📅 {appointment_date} בשעה {appointment_time}\n\n"
            "⚠️ טרם שולמה מקדמה בסך ₪{deposit_amount}.\n"
            "לתשלום: {payment_link}\n\n"
            "מחכים לך!"
        ),
        email_default=(
            "<div dir='rtl' style='font-family:Arial,sans-serif;padding:20px'>"
            "<h2>תזכורת לתור בעוד שבוע 📅</h2>"
            "<p>היי {client_name},</p>"
            "<p>רק מזכירים שיש תור ל-<strong>{appointment_title}</strong> בעוד שבוע.</p>"
            "<p><strong>מתי?</strong> {appointment_date} בשעה {appointment_time}</p>"
            "<p>נתראה!</p>"
            "</div>"
        ),
    )


def sweep_3day_reminders(db: Session) -> int:
    """תזכורת שלושה ימים לפני התור."""
    return _sweep_reminders_for_window(
        db,
        hours_ahead=3 * 24,
        window_hours=4,
        reminder_type="3day",
        enabled_attr="reminder_3_days_enabled",
        wa_template_attr="reminder_3day_wa_template",
        wa_default=(
            "היי {client_name} 👋\n"
            "תזכורת — בעוד שלושה ימים יש לך תור!\n\n"
            "📋 {appointment_title}\n"
            "📅 {appointment_date} בשעה {appointment_time}\n\n"
            "מחכים לך!"
        ),
        wa_deposit_default=(
            "היי {client_name} 👋\n"
            "תזכורת — בעוד שלושה ימים יש לך תור!\n\n"
            "📋 {appointment_title}\n"
            "📅 {appointment_date} בשעה {appointment_time}\n\n"
            "⚠️ טרם שולמה מקדמה בסך ₪{deposit_amount}.\n"
            "לתשלום: {payment_link}\n\n"
            "מחכים לך!"
        ),
        email_default=(
            "<div dir='rtl' style='font-family:Arial,sans-serif;padding:20px'>"
            "<h2>תזכורת לתור בעוד שלושה ימים 📅</h2>"
            "<p>היי {client_name},</p>"
            "<p>רק מזכירים שיש תור ל-<strong>{appointment_title}</strong> בעוד שלושה ימים.</p>"
            "<p><strong>מתי?</strong> {appointment_date} בשעה {appointment_time}</p>"
            "<p>נתראה!</p>"
            "</div>"
        ),
    )


def sweep_same_day_reminders(db: Session) -> int:
    """תזכורת בוקר ביום התור — רצה כל יום בשעה 08:00 שעון ישראל."""
    now_utc = datetime.now(timezone.utc)
    today_il = now_utc.astimezone(_IL_TZ).date()

    # חלון: כל התורים של היום הנוכחי לפי שעון ישראל
    day_start_utc = _IL_TZ.localize(datetime.combine(today_il, datetime.min.time())).astimezone(timezone.utc)
    day_end_utc   = _IL_TZ.localize(datetime.combine(today_il, datetime.max.time())).astimezone(timezone.utc)

    stmt = (
        select(Appointment, Client, StudioSettings)
        .join(Client, Client.id == Appointment.client_id)
        .join(StudioSettings, StudioSettings.studio_id == Appointment.studio_id)
        .where(
            Appointment.status == "scheduled",
            Appointment.starts_at >= day_start_utc,
            Appointment.starts_at <= day_end_utc,
        )
    )
    rows = db.execute(stmt).all()
    count = 0

    for appt, client, settings in rows:
        if not getattr(settings, "same_day_reminder_enabled", True):
            continue

        if client.whatsapp_opted_out:
            continue

        if _already_enqueued(db, appt.id, "same_day"):
            continue

        ctx = _build_reminder_context(appt, client, settings)
        has_deposit = ctx["has_deposit"]
        deposit_paid = ctx["deposit_paid"]
        deposit_warning_enabled = getattr(settings, "deposit_warning_enabled", True)

        custom_wa = getattr(settings, "same_day_reminder_wa_template", None)
        if custom_wa:
            wa_body = format_template(custom_wa, ctx)
        else:
            lines = [
                f"בוקר טוב {ctx['client_name']} ☀️",
                f"תזכורת — היום יש לך תור!",
                "",
                f"📋 {ctx['appointment_title']}",
                f"🕐 שעה {ctx['appointment_time']}",
            ]
            if ctx.get("studio_address"):
                lines += ["", f"📍 {ctx['studio_address']}"]
            if ctx.get("map_link"):
                lines.append(f"🗺️ ניווט: {ctx['map_link']}")
            if has_deposit and not deposit_paid and deposit_warning_enabled and ctx.get("payment_link"):
                lines += [
                    "",
                    f"⚠️ שים לב: טרם שולמה מקדמה בסך ₪{ctx['deposit_amount']}.",
                    f"לתשלום: {ctx['payment_link']}",
                ]
            lines += ["", "מחכים לך! 🙌"]
            wa_body = "\n".join(lines)

        if client.phone and wa_body:
            db.add(MessageJob(
                studio_id=appt.studio_id,
                client_id=client.id,
                appointment_id=appt.id,
                channel="whatsapp",
                to_phone=client.phone,
                body=wa_body,
                scheduled_at=now_utc,
                status="pending",
                reminder_type="same_day",
            ))
            count += 1

    if count:
        db.commit()
    log.info("sweep_same_day_reminders: enqueued %d messages for %s", count, today_il)
    return count


def sweep_birthday_messages(db: Session) -> int:
    """Runs on the 25th of each month — sends birthday WhatsApp + coupon to club members
    whose birthday falls in the NEXT month, giving them ~5-35 days to book in advance."""
    from app.models.client import Client
    from app.models.studio_settings import StudioSettings
    from app.crud.birthday_coupon import get_or_create_birthday_coupon
    from sqlalchemy import extract

    now = datetime.now(timezone.utc)

    if now.month == 12:
        target_month = 1
        target_year = now.year + 1
    else:
        target_month = now.month + 1
        target_year = now.year

    # Dedup tag — birthday still uses body tag because there's no appointment_id to key on
    tag = f"[birthday-{target_year}-{target_month:02d}]"

    stmt = (
        select(Client, StudioSettings)
        .join(StudioSettings, StudioSettings.studio_id == Client.studio_id)
        .where(
            Client.is_club_member.is_(True),
            Client.is_active.is_(True),
            Client.birth_date.isnot(None),
            extract("month", Client.birth_date) == target_month,
        )
    )
    rows = db.execute(stmt).all()
    count = 0

    for client, settings in rows:
        if not getattr(settings, "birthday_automation_enabled", True):
            continue

        if client.whatsapp_opted_out:
            continue

        existing = db.scalar(
            select(MessageJob).where(
                MessageJob.client_id == client.id,
                MessageJob.body.contains(tag),
            )
        )
        if existing:
            continue

        discount_percent = int(settings.birthday_benefit_percent or 10) or 10
        coupon = get_or_create_birthday_coupon(
            db,
            studio_id=client.studio_id,
            client_id=client.id,
            month=target_month,
            year=target_year,
            discount_percent=discount_percent,
            client_name=client.name or client.full_name or "",
        )

        context = {
            "client_name": client.full_name,
            "benefit_percent": discount_percent,
            "coupon_code": coupon.code,
            "birth_day": client.birth_date.day if client.birth_date else "",
            "birth_month": target_month,
        }

        wa_template = settings.birthday_wa_template
        if not wa_template:
            wa_template = (
                f"{tag}\n"
                "היי {client_name}, מזל טוב! 🎉\n"
                "יום ההולדת שלך מתקרב 🥳\n"
                "הנה הטבה מיוחדת של {benefit_percent}% הנחה לחודש ההולדת שלך — במיוחד בשבילך ❤️\n\n"
                "קוד הקופון שלך: *{coupon_code}*"
            )
        else:
            wa_template = f"{tag}\n{wa_template}"

        if client.phone:
            wa_body = format_template(wa_template, context)
            db.add(MessageJob(
                studio_id=client.studio_id,
                client_id=client.id,
                channel="whatsapp",
                to_phone=client.phone,
                body=wa_body,
                scheduled_at=now,
                status="pending",
            ))
            count += 1

    if count:
        db.commit()
    log.info("sweep_birthday_messages: sent %d messages for birthday month %d/%d", count, target_month, target_year)
    return count
