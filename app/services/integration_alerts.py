"""
Detects external API failures that look like a billing/quota/subscription
problem (as opposed to an unrelated bug) and emails the platform admin.

This is best-effort: every provider phrases "you're out of quota/credit"
differently, so this only catches known keyword patterns — it is not a
guarantee of catching every possible billing-related failure.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PLATFORM_ADMIN_EMAIL = os.getenv("PLATFORM_ADMIN_EMAIL", "ncbilutattoo@gmail.com")

COOLDOWN = timedelta(hours=1)

# Lower-case substrings that, if present in an error message, suggest a
# billing/quota/subscription problem rather than a config or logic bug.
_BILLING_KEYWORDS = (
    "quota", "billing", "payment", "insufficient", "suspended",
    "subscription", "exceeded", "credit", "402",
)


def is_billing_error(error_text: str) -> bool:
    """Best-effort keyword match — see module docstring for the caveat."""
    if not error_text:
        return False
    lowered = error_text.lower()
    return any(kw in lowered for kw in _BILLING_KEYWORDS)


def alert_integration_failure(db: Session, integration: str, error_detail: str, force: bool = False) -> None:
    """Call from an existing except block when an external API call fails.
    No-ops silently if the error doesn't look billing-related, or if this
    integration was already alerted on within the last hour.

    Pass force=True for failures where ANY cause (not just billing) is worth
    surfacing — e.g. Cloudinary upload failures, which silently fall back to
    Railway's ephemeral local disk and put the file at risk of being lost on
    the next deploy, regardless of why Cloudinary itself failed."""
    looks_billing = is_billing_error(error_detail)
    if not force and not looks_billing:
        return

    try:
        row = db.execute(
            text("SELECT last_alerted_at FROM integration_alerts WHERE integration_name = :name"),
            {"name": integration},
        ).fetchone()
        now = datetime.now(timezone.utc)
        if row and row[0] and (now - row[0]) < COOLDOWN:
            return  # already alerted recently — avoid spamming the same failure

        db.execute(
            text("""
                INSERT INTO integration_alerts (integration_name, last_alerted_at, last_error)
                VALUES (:name, :now, :error)
                ON CONFLICT (integration_name)
                DO UPDATE SET last_alerted_at = :now, last_error = :error
            """),
            {"name": integration, "now": now, "error": error_detail[:2000]},
        )
        db.commit()

        if looks_billing:
            title = f"⚠️ {integration} — נראה כמו בעיית תשלום/מכסה"
            explanation = "שירות חיצוני החזיר שגיאה שנראית קשורה לתשלום, מכסה, או מנוי שפג."
            subject_suffix = "בעיית תשלום/מכסה אפשרית"
        else:
            title = f"⚠️ {integration} — כשל בשמירה קבועה"
            explanation = "ההעלאה לאחסון הקבוע נכשלה מסיבה לא ידועה (לאו דווקא תשלום) והקובץ נשמר זמנית בלבד — הוא עלול להימחק בדיפלוי הבא."
            subject_suffix = "כשל בשמירת קובץ"

        from app.services.email_center import send_email as ec_send_email
        html = f"""
        <div dir="rtl" style="font-family:Arial,sans-serif;padding:20px">
            <h2 style="color:#dc2626">{title}</h2>
            <p>{explanation}</p>
            <pre style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap;direction:ltr;text-align:left">{error_detail[:2000]}</pre>
            <p style="color:#64748b;font-size:12px">התראה זו לא תישלח שוב על אותה אינטגרציה למשך שעה.</p>
        </div>
        """
        ec_send_email(
            db,
            to_email=PLATFORM_ADMIN_EMAIL,
            subject=f"⚠️ BizControl: {integration} — {subject_suffix}",
            html_content=html,
            from_name="BizControl System",
            email_type="system",
        )
    except Exception as e:
        # This is a best-effort side-channel alert — never let it break the
        # original request/flow that triggered it.
        logger.error("[integration_alerts] failed to send alert for %s: %s", integration, e)


# ── A business's messages failing (owner, 2026-10-11) ──────────────────────────
# "I want a system alert in the superadmin's e-mail about the account where something failed" — which business,
# where (WhatsApp / e-mail), what happened and what to check; at most once per business and area every 3 hours.

ACCOUNT_COOLDOWN = timedelta(hours=3)
AREA_LABELS = {"whatsapp": "WhatsApp", "email": "מייל"}


def mask_secrets(text_: str | None) -> str:
    """A provider's error can carry the address it called — with the account's key in it (Green API puts the token
    in the path). Kept out of the database, the screens and the alerts."""
    import re
    return re.sub(r"(waInstance\d+/[A-Za-z]+/)[A-Za-z0-9]+", r"\1***", text_ or "")


def _what_to_check(area: str, detail: str) -> str:
    d = (detail or "").lower()
    if area == "whatsapp" and ("מצב: unknown" in detail or "timed out" in d):
        return "שירות ה-WhatsApp (Green API) לא עונה — לבדוק שהחשבון פעיל ושהשירות שלהם לא בתקלה."
    if area == "whatsapp" and ("notauthorized" in d or "מצב:" in detail):
        return "הטלפון של WhatsApp לא מחובר — לסרוק QR מחדש במסך ה-WhatsApp של העסק."
    if area == "email":
        return "שליחת המייל נכשלה — לבדוק את מרכז המיילים (מפתח, דומיין, מכסה)."
    return "לבדוק את תור ההודעות של העסק."


def alert_account_failure(db: Session, studio_id, area: str, detail: str) -> None:
    """E-mail the superadmin that a business's messages are failing. Best-effort — never breaks the caller."""
    if area not in AREA_LABELS:
        return
    key = f"account:{area}:{studio_id}"
    try:
        now = datetime.now(timezone.utc)
        row = db.execute(text("SELECT last_alerted_at FROM integration_alerts WHERE integration_name = :n"), {"n": key}).fetchone()
        if row and row[0] and (now - row[0]) < ACCOUNT_COOLDOWN:
            return
        detail = mask_secrets(detail)[:1500]
        db.execute(text("""
            INSERT INTO integration_alerts (integration_name, last_alerted_at, last_error) VALUES (:n, :now, :e)
            ON CONFLICT (integration_name) DO UPDATE SET last_alerted_at = :now, last_error = :e
        """), {"n": key, "now": now, "e": detail})

        from html import escape
        from app.models.studio import Studio
        from app.services.email_center import send_email as ec_send_email
        studio = db.get(Studio, studio_id)
        name = studio.name if studio else str(studio_id)
        site = os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app").rstrip("/")
        area_label = AREA_LABELS[area]
        html = f"""
        <div dir="rtl" style="font-family:Arial,sans-serif;padding:20px;color:#0f172a">
            <h2 style="color:#dc2626;margin:0 0 12px">⚠️ תקלה בחשבון: {escape(name)}</h2>
            <p><b>איפה:</b> {area_label}</p>
            <p><b>מה קרה:</b> הודעה של העסק לא נשלחה.</p>
            <pre style="background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap">{escape(detail)}</pre>
            <p><b>מה לבדוק:</b> {escape(_what_to_check(area, detail))}</p>
            <p><a href="{site}/admin/messages?studio_id={studio_id}">תור ההודעות של העסק</a> ·
               <a href="{site}/admin/studios/{studio_id}">הכרטיס של העסק</a></p>
            <p style="color:#64748b;font-size:12px">על אותה תקלה באותו עסק לא תישלח התראה נוספת במשך 3 שעות.</p>
        </div>"""
        ec_send_email(db, to_email=PLATFORM_ADMIN_EMAIL, subject=f"⚠️ BizControl: תקלה ב-{area_label} — {name}",
                      html_content=html, from_name="BizControl System", email_type="system")
    except Exception as e:
        logger.error("[integration_alerts] account alert failed for %s: %s", key, e)
