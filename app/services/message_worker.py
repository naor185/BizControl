from __future__ import annotations
from datetime import datetime, timezone, timedelta, date
from sqlalchemy import select
from sqlalchemy.orm import Session
import pytz

from app.models.message_job import MessageJob
from app.models.studio_settings import StudioSettings
from app.models.appointment import Appointment
from app.models.client import Client
from app.crud.automation import format_template
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


def _normalize_phone(to_phone: str) -> str:
    clean = to_phone.replace("+", "").replace(" ", "").replace("-", "")
    if clean.startswith("0") and len(clean) >= 9:
        clean = "972" + clean[1:]
    if not clean.endswith("@c.us"):
        clean = f"{clean}@c.us"
    return clean


def _green_post(url: str, payload: bytes) -> dict:
    """POST to Green API and return parsed JSON. Raises on HTTP error or error body."""
    import urllib.request, urllib.error, json as _json
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            data = _json.loads(raw)
            msg = data.get("message") or data.get("error") or str(data)
        except Exception:
            msg = raw.decode(errors="replace")
        raise RuntimeError(f"Green API HTTP {e.code}: {msg}")

    try:
        data = _json.loads(raw)
    except Exception:
        return {}

    # Green API returns {"error": 400, "message": "..."} or {"statusCode": 400} with HTTP 200
    if "error" in data and data["error"] not in (None, 0, False, ""):
        msg = data.get("message") or str(data["error"])
        raise RuntimeError(f"Green API error: {msg}")
    if data.get("statusCode", 0) not in (0, 200, None):
        raise RuntimeError(f"Green API statusCode: {data}")

    return data


_green_state_cache: dict[str, tuple[str, float]] = {}  # instance_id → (state, expiry_ts)


def _check_green_state(instance_id: str, api_key: str) -> str:
    """Return stateInstance, cached for 60s to avoid hammering Green API."""
    import time as _time, urllib.request as _ur, json as _j
    now = _time.monotonic()
    cached = _green_state_cache.get(instance_id)
    if cached and now < cached[1]:
        return cached[0]
    try:
        url = f"https://api.green-api.com/waInstance{instance_id}/getStateInstance/{api_key}"
        with _ur.urlopen(_ur.Request(url), timeout=5) as r:
            state = _j.loads(r.read()).get("stateInstance", "unknown")
    except Exception:
        state = "unknown"
    _green_state_cache[instance_id] = (state, now + 60)
    return state


def _local_path_for_media(media_url: str) -> str | None:
    """Return local filesystem path if media_url points to our own uploads directory."""
    import re
    if not media_url:
        return None
    # Relative URL: /uploads/broadcasts/file.jpg
    if media_url.startswith("/uploads/"):
        return media_url.lstrip("/")
    # Absolute URL pointing to our server: https://xxx/uploads/broadcasts/file.jpg
    m = re.search(r"uploads/broadcasts/[^?#]+", media_url)
    return m.group(0) if m else None


def _send_via_green(instance_id: str, api_key: str, to_phone: str, body: str, media_url: str | None = None) -> None:
    import json as _json, os as _os, base64 as _b64

    state = _check_green_state(instance_id, api_key)
    if state in ("notAuthorized", "blocked"):
        raise RuntimeError(
            f"WhatsApp מנותק (מצב: {state}). "
            "יש לסרוק מחדש QR בהגדרות WhatsApp → אינטגרציות."
        )

    clean = _normalize_phone(to_phone)

    if media_url:
        ext = (media_url.split("?")[0].rsplit(".", 1)[-1].lower()) if "." in media_url else "jpg"
        sent_media = False

        # 1. Try base64 if the file is available locally (avoids URL accessibility issues on Railway)
        local_path = _local_path_for_media(media_url)
        if local_path and _os.path.isfile(local_path):
            try:
                with open(local_path, "rb") as fh:
                    b64data = _b64.b64encode(fh.read()).decode()
                url = f"https://api.green-api.com/waInstance{instance_id}/sendFileByBase64/{api_key}"
                payload = _json.dumps({
                    "chatId": clean,
                    "base64File": b64data,
                    "fileName": f"media.{ext}",
                    "caption": body,
                }).encode()
                _green_post(url, payload)
                sent_media = True
            except Exception as b64_err:
                log.warning("Green API sendFileByBase64 failed (%s) — trying sendFileByUrl", b64_err)

        # 2. Fall back to sendFileByUrl for absolute external URLs
        if not sent_media and media_url.startswith("http"):
            url = f"https://api.green-api.com/waInstance{instance_id}/sendFileByUrl/{api_key}"
            payload = _json.dumps({
                "chatId": clean,
                "urlFile": media_url,
                "fileName": f"media.{ext}",
                "caption": body,
            }).encode()
            try:
                _green_post(url, payload)
                sent_media = True
            except Exception as url_err:
                log.warning("Green API sendFileByUrl failed (%s) — falling back to text-only", url_err)

        if sent_media:
            return

    # Plain text message (primary path, or fallback after media failure)
    url = f"https://api.green-api.com/waInstance{instance_id}/sendMessage/{api_key}"
    payload = _json.dumps({"chatId": clean, "message": body}).encode()
    _green_post(url, payload)


def _get_platform_settings(db: Session):
    """Return platform WhatsApp credentials as fallback.
    Priority: 1) platform_config platform_wa_instance/token  2) system_wa_studio_id  3) PLATFORM_STUDIO_ID env"""
    import os, uuid as _uuid
    from sqlalchemy import text as _t

    # 1. Dedicated platform Green API instance
    try:
        row_i = db.execute(_t("SELECT value FROM platform_config WHERE key='platform_wa_instance'")).fetchone()
        row_t = db.execute(_t("SELECT value FROM platform_config WHERE key='platform_wa_token'")).fetchone()
        if row_i and row_i[0] and row_t and row_t[0]:
            class _PlatformWA:
                whatsapp_provider = "green_api"
                whatsapp_instance_id = row_i[0]
                whatsapp_api_key = row_t[0]
                studio_id = None
            return _PlatformWA()
    except Exception:
        pass

    # 2. Designated system studio
    try:
        row = db.execute(_t("SELECT value FROM platform_config WHERE key='system_wa_studio_id'")).fetchone()
        if row and row[0]:
            settings = db.get(StudioSettings, _uuid.UUID(row[0]))
            if settings and settings.whatsapp_provider:
                return settings
    except Exception:
        pass

    # 3. PLATFORM_STUDIO_ID env var
    platform_id = os.getenv("PLATFORM_STUDIO_ID", "")
    if not platform_id:
        return None
    try:
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


_PLATFORM_FOOTER = (
    "\n\n—\n"
    "🤖 הודעה אוטומטית ממערכת BizControl.\n"
    "אין להשיב להודעה זו."
)


def send_whatsapp_message(to_phone: str, body: str, settings=None, db: Session | None = None, media_url: str | None = None) -> None:
    provider = getattr(settings, "whatsapp_provider", None) if settings else None
    studio_id = getattr(settings, "studio_id", None) if settings else None
    using_platform_fallback = False

    # Fall back to platform WhatsApp if studio has none configured
    if not provider and db is not None:
        platform = _get_platform_settings(db)
        if platform and platform.whatsapp_provider:
            settings = platform
            provider = platform.whatsapp_provider
            using_platform_fallback = True

    if not provider:
        raise ValueError("WhatsApp provider not configured for this studio")

    # Append system footer when sending from BizControl's own number
    if using_platform_fallback:
        body = body.rstrip() + _PLATFORM_FOOTER

    instance_id_used = ""
    try:
        if provider == "green_api":
            instance_id = getattr(settings, "whatsapp_instance_id", None)
            api_key = getattr(settings, "whatsapp_api_key", None)
            if not instance_id or not api_key:
                raise ValueError("Green API credentials missing (instance_id or api_key)")
            instance_id_used = instance_id
            _send_via_green(instance_id, api_key, to_phone, body, media_url=media_url)

        elif provider == "meta":
            phone_id = getattr(settings, "whatsapp_phone_id", None)
            api_key = getattr(settings, "whatsapp_api_key", None)
            if not phone_id or not api_key:
                raise ValueError("Meta API credentials missing (phone_id or api_key)")
            # Meta: send image first if available, then text
            if media_url:
                try:
                    import httpx as _httpx
                    _httpx.post(
                        f"https://graph.facebook.com/v18.0/{phone_id}/messages",
                        headers={"Authorization": f"Bearer {api_key}"},
                        json={"messaging_product": "whatsapp", "to": to_phone.replace("+", ""),
                              "type": "image", "image": {"link": media_url}},
                        timeout=10,
                    )
                except Exception:
                    pass
            _send_via_meta(phone_id, api_key, to_phone, body)

        else:
            raise ValueError(f"Unknown WhatsApp provider: '{provider}'")

        _log_whatsapp(db, studio_id, to_phone, body, "sent", provider, instance_id_used)

    except Exception as exc:
        _log_whatsapp(db, studio_id, to_phone, body, "failed", provider, instance_id_used, str(exc))
        if db is not None:
            from app.services.integration_alerts import alert_integration_failure
            alert_integration_failure(db, f"WhatsApp ({provider})", str(exc))
        raise


def process_due_jobs(db: Session, limit: int = 20) -> int:
    import pytz as _pytz
    now = datetime.now(timezone.utc)
    israel_tz = _pytz.timezone("Asia/Jerusalem")
    now_israel = datetime.now(israel_tz)
    is_shabbat = now_israel.weekday() == 5  # Saturday

    stmt = (
        select(MessageJob)
        .where(MessageJob.status == "pending", MessageJob.scheduled_at <= now)
        .order_by(MessageJob.scheduled_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )

    jobs = list(db.scalars(stmt).all())
    count = 0
    _shabbat_cache: dict = {}  # studio_id -> block_shabbat_messages bool

    for job in jobs:
        try:
            # Skip on Shabbat if studio opted in to shabbat blocking
            if is_shabbat:
                sid = str(job.studio_id)
                if sid not in _shabbat_cache:
                    _s = db.get(StudioSettings, job.studio_id)
                    _shabbat_cache[sid] = bool(getattr(_s, "block_shabbat_messages", False))
                if _shabbat_cache[sid]:
                    continue  # Leave as pending — will be sent on Sunday

            # Club invite: skip if client already joined the club since enqueueing
            if getattr(job, "reminder_type", None) in ("club_invite", "club_invite_email") and job.client_id:
                _client_check = db.get(Client, job.client_id)
                if _client_check and getattr(_client_check, "is_club_member", False):
                    job.status = "canceled"
                    job.last_error = "Client already joined club — invite skipped"
                    db.commit()
                    count += 1
                    continue

            if job.channel == "whatsapp" and job.client_id:
                client = db.get(Client, job.client_id)
                if client and getattr(client, "whatsapp_opted_out", False):
                    job.status = "canceled"
                    job.last_error = "Client opted out of WhatsApp"
                    count += 1
                    continue

            if job.channel == "email":
                # All emails go through the central Email Center — no per-studio
                # Resend key path anymore.
                subject = getattr(job, "subject", None) or "הודעה מהסטודיו"
                from app.services.email_center import send_email as _ec_send
                from app.models.studio import Studio as _Studio
                _studio = db.get(_Studio, job.studio_id)
                studio_name = _studio.name if _studio else "BizControl"
                ok = _ec_send(
                    db,
                    to_email=job.to_phone,
                    subject=subject,
                    html_content=job.body,
                    from_name=studio_name,
                    studio_id=str(job.studio_id),
                    client_id=str(job.client_id) if job.client_id else None,
                    template_key=getattr(job, "reminder_type", None) or "notification",
                    email_type="appointment",
                )
                if not ok:
                    raise ValueError("Email center send failed — check system API key")
            else:
                settings = db.get(StudioSettings, job.studio_id)
                send_whatsapp_message(job.to_phone, job.body, settings, db=db,
                                      media_url=getattr(job, "media_url", None))

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

        if email_default and client.email:
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

        # Email same-day reminder
        from app.services.email_center import studio_email_allowed as _email_ok
        if client.email and not _already_enqueued(db, appt.id, "same_day_email") \
                and _email_ok(db, appt.studio_id, "email_reminder_enabled"):
            from app.utils.email_templates import _email_base
            map_row = f'<tr><td style="padding:6px 12px 6px 0;color:#64748b;">🗺️ ניווט:</td><td><a href="{ctx["map_link"]}" style="color:#3b82f6;">לחץ כאן לניווט</a></td></tr>' if ctx.get("map_link") else ""
            deposit_row = f'<tr><td colspan="2" style="padding:8px;background:#fef9c3;border-radius:8px;color:#854d0e;">⚠️ טרם שולמה מקדמה בסך ₪{ctx["deposit_amount"]}. <a href="{ctx["payment_link"]}" style="color:#854d0e;">לתשלום לחץ כאן</a></td></tr>' if (has_deposit and not deposit_paid and deposit_warning_enabled and ctx.get("payment_link")) else ""
            _addr_row = ("<tr><td style='padding:6px 12px 6px 0;color:#64748b;'>📍 כתובת:</td><td style='font-weight:bold;'>" + ctx["studio_address"] + "</td></tr>") if ctx.get("studio_address") else ""
            email_html = (
                f"<p>בוקר טוב <strong>{ctx['client_name']}</strong> ☀️</p>"
                f"<p>תזכורת — <strong>היום יש לך תור!</strong></p>"
                f"<table style='border-collapse:collapse;margin:16px 0;font-size:14px;'>"
                f"<tr><td style='padding:6px 12px 6px 0;color:#64748b;'>📋 שירות:</td><td style='font-weight:bold;'>{ctx['appointment_title']}</td></tr>"
                f"<tr><td style='padding:6px 12px 6px 0;color:#64748b;'>🕐 שעה:</td><td style='font-weight:bold;'>{ctx['appointment_time']}</td></tr>"
                f"{_addr_row}"
                f"{map_row}"
                f"{deposit_row}"
                f"</table>"
                f"<p>מחכים לך! 🙌</p>"
            )
            db.add(MessageJob(
                studio_id=appt.studio_id,
                client_id=client.id,
                appointment_id=appt.id,
                channel="email",
                to_phone=client.email,
                subject=f"☀️ תזכורת לתור היום בשעה {ctx['appointment_time']}",
                body=_email_base("תזכורת לתור היום ☀️", email_html),
                scheduled_at=now_utc,
                status="pending",
                reminder_type="same_day_email",
            ))
            count += 1

    if count:
        db.commit()
    log.info("sweep_same_day_reminders: enqueued %d messages for %s", count, today_il)
    return count


def sweep_birthday_messages(db: Session, studio_id=None) -> int:
    """Runs on the 25th of each month — sends birthday WhatsApp + coupon to club members
    whose birthday falls in the NEXT month, giving them ~5-35 days to book in advance.
    Pass studio_id to limit the sweep to a single studio (for manual triggers by studio owners)."""
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

    reminder_type_wa = f"birthday-{target_year}-{target_month:02d}"

    filters = [
        Client.is_club_member.is_(True),
        Client.is_active.is_(True),
        Client.birth_date.isnot(None),
        extract("month", Client.birth_date) == target_month,
    ]
    if studio_id is not None:
        filters.append(Client.studio_id == studio_id)

    stmt = (
        select(Client, StudioSettings)
        .join(StudioSettings, StudioSettings.studio_id == Client.studio_id)
        .where(*filters)
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
                MessageJob.reminder_type == reminder_type_wa,
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
                "היי {client_name}, מזל טוב! 🎉\n"
                "יום ההולדת שלך מתקרב 🥳\n"
                "הנה הטבה מיוחדת של {benefit_percent}% הנחה לחודש ההולדת שלך — במיוחד בשבילך ❤️\n\n"
                "קוד הקופון שלך: *{coupon_code}*"
            )

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
                reminder_type=reminder_type_wa,
            ))
            count += 1

        # Email birthday message
        from app.services.email_center import studio_email_allowed as _email_ok
        reminder_type_email = f"birthday_email-{target_year}-{target_month:02d}"
        if client.email and _email_ok(db, client.studio_id, "email_birthday_enabled"):
            already_email = db.scalar(
                select(MessageJob).where(
                    MessageJob.client_id == client.id,
                    MessageJob.reminder_type == reminder_type_email,
                )
            )
            if not already_email:
                from app.utils.email_templates import _email_base
                email_html = (
                    f"<p>היי <strong>{context['client_name']}</strong>, מזל טוב! 🎉</p>"
                    f"<p>יום ההולדת שלך מתקרב 🥳<br>הנה הטבה מיוחדת של <strong>{context['benefit_percent']}% הנחה</strong> לחודש ההולדת שלך — במיוחד בשבילך ❤️</p>"
                    f"<div style='background:#fef9c3;border-radius:12px;padding:16px 20px;margin:20px 0;text-align:center;'>"
                    f"<div style='font-size:13px;color:#92400e;margin-bottom:6px;'>קוד הקופון שלך:</div>"
                    f"<div style='font-size:24px;font-weight:900;letter-spacing:4px;color:#1a1a2e;'>{context['coupon_code']}</div>"
                    f"</div>"
                    f"<p style='color:#64748b;font-size:13px;'>הקוד תקף לחודש {target_month}/{target_year}. הזן בקופה בעת התשלום.</p>"
                )
                db.add(MessageJob(
                    studio_id=client.studio_id,
                    client_id=client.id,
                    channel="email",
                    to_phone=client.email,
                    subject=f"🎉 מזל טוב! הטבת יום הולדת {context['benefit_percent']}% מחכה לך",
                    body=_email_base("מזל טוב! 🎉 הטבה מיוחדת בשבילך", email_html),
                    scheduled_at=now,
                    status="pending",
                    reminder_type=reminder_type_email,
                ))
                count += 1

    if count:
        db.commit()
    log.info("sweep_birthday_messages: sent %d messages for birthday month %d/%d", count, target_month, target_year)
    return count


def sweep_deposit_reminders(db: Session) -> int:
    """
    24 שעות אחרי קביעת תור שדורש מקדמה — אם המקדמה טרם שולמה/אושרה,
    שולחים ללקוח תזכורת לשלם מקדמה לשריון התור.
    לא נשלחת אם: payment_verified_at IS NOT NULL / deposit_amount_cents = 0 / כבר נשלחה.
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=48)
    window_end   = now - timedelta(hours=24)

    appts = db.scalars(
        select(Appointment).where(
            Appointment.deposit_amount_cents > 0,
            Appointment.payment_verified_at.is_(None),
            Appointment.status == "scheduled",
            Appointment.created_at >= window_start,
            Appointment.created_at <= window_end,
        )
    ).all()

    count = 0
    for appt in appts:
        if _already_enqueued(db, appt.id, "deposit_24h"):
            continue

        client = db.get(Client, appt.client_id)
        if not client or not client.phone:
            continue
        if getattr(client, "whatsapp_opted_out", False):
            continue

        settings = db.get(StudioSettings, appt.studio_id)
        if not settings:
            continue

        il_dt = appt.starts_at.astimezone(_IL_TZ)
        date_str = il_dt.strftime("%d/%m/%Y")
        time_str = il_dt.strftime("%H:%M")
        deposit_ils = appt.deposit_amount_cents / 100

        template = getattr(settings, "deposit_reminder_wa_template", None) or (
            "היי {client_name} 👋\n\n"
            "תזכורת: התור שלך בתאריך {date} בשעה {time} עדיין ממתין לאישור מקדמה.\n\n"
            "💰 סכום המקדמה: ₪{deposit_amount}\n\n"
            "לשריון התור יש לשלוח את המקדמה. ללא תשלום המקדמה התור אינו מאושר סופית.\n\n"
            "לפרטים נוספים צור/י קשר ישירות."
        )

        body = format_template(template, {
            "client_name": client.full_name or "",
            "date": date_str,
            "time": time_str,
            "deposit_amount": f"{deposit_ils:.0f}" if deposit_ils == int(deposit_ils) else f"{deposit_ils:.2f}",
        })

        db.add(MessageJob(
            studio_id=appt.studio_id,
            client_id=appt.client_id,
            appointment_id=appt.id,
            channel="whatsapp",
            to_phone=client.phone,
            body=body,
            scheduled_at=now,
            status="pending",
            reminder_type="deposit_24h",
        ))
        count += 1

    if count:
        db.commit()
    log.info("sweep_deposit_reminders: enqueued %d deposit reminders", count)
    return count
