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
