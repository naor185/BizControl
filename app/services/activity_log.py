"""The business's activity log — who did what, and when (owner, 2026-10-13: "מי שינה מה ומתי").

One log for the whole platform (audit_logs): the superadmin reads the rows marked kind="platform", the owner reads his
business's rows marked kind="business" (GET /api/activity). Each sensitive action calls record() once it was saved —
a receipt, a credit, a deleted client or appointment, a voided sale, a discount at the till, a deleted expense, the
business's settings, the team, a fixed shift. The text is plain Hebrew without he/she ("הפקת קבלה 1151 · ₪1,400"); the
person's name is shown next to it. The superadmin signed in as the business shows as BizControl support."""
from __future__ import annotations

import logging
from datetime import datetime

import pytz
from sqlalchemy.orm import Session

from app.core.deps import AuthContext
from app.models.audit_log import AuditLog
from app.models.studio_settings import StudioSettings
from app.models.user import User

log = logging.getLogger(__name__)

AREAS: dict[str, str] = {
    "receipts": "קבלות וזיכויים",
    "money": "כסף וקופה",
    "clients": "לקוחות ותורים",
    "team": "צוות",
    "attendance": "נוכחות",
    "settings": "הגדרות",
}
SUPPORT = "תמיכת BizControl"


def record(db: Session, ctx: AuthContext, area: str, text: str) -> None:
    """One line in the business's log — called after the action was saved (it commits the line). A failure here never
    undoes the action."""
    try:
        user = db.get(User, ctx.user_id)
        name = SUPPORT if ctx.impersonated else name_of(db, ctx.user_id)
        db.add(AuditLog(kind="business", admin_id=str(ctx.user_id), admin_email=(user.email if user else "") or "",
                        action=area, studio_id=str(ctx.studio_id),
                        details={"text": text[:300], "name": name, "role": ctx.role, "support": ctx.impersonated}))
        db.commit()
    except Exception:
        db.rollback()
        log.exception("activity log: could not record %r for studio %s", text, ctx.studio_id)


def ils(cents: int | None) -> str:
    """₪1,400 · ₪99.50"""
    v = (cents or 0) / 100
    return f"₪{v:,.0f}" if float(v).is_integer() else f"₪{v:,.2f}"


def at(db: Session, studio_id, when: datetime | None) -> str:
    """The studio's wall clock, short — 13.10 09:00."""
    if when is None:
        return ""
    settings = db.get(StudioSettings, studio_id)
    tz = pytz.timezone(settings.timezone if settings and settings.timezone else "Asia/Jerusalem")
    return when.astimezone(tz).strftime("%d.%m %H:%M")


# The business's settings (PATCH /api/automation) in the words of its screens — the first that fits a field
_SETTING_WORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("messages_off",), "אילו הודעות נשלחות"),
    (("_template",), "נוסחי הודעות"),
    (("reminder_", "same_day_reminder", "deposit_warning"), "תזכורות"),
    (("theme_", "landing_page"), "מראה ודף העסק"),
    (("marketplace_",), "הפרופיל ב-BizFind"),
    (("self_booking",), "זימון עצמי"),
    (("bank_", "bit_link", "paybox_link"), "פרטי תשלום ובנק"),
    (("deposit_", "cancellation_"), "מקדמות וביטולים"),
    (("whatsapp_", "facebook_", "instagram_"), "חיבור וואטסאפ ורשתות"),
    (("google_calendar",), "חיבור יומן גוגל"),
    (("calendar_", "work_days"), "שעות היומן"),
    (("studio_",), "כתובת ופרטי העסק"),
    (("points_", "cashback", "club_"), "מועדון לקוחות"),
    (("gift_",), "כרטיסי מתנה"),
    (("birthday_",), "יום הולדת"),
    (("aftercare", "review_link"), "הודעת המשך וביקורות"),
    (("vat_percent", "income_tax_percent", "social_security_percent"), "מע\"מ ומסים"),
    (("block_shabbat",), "שבת"),
    (("optout",), "הסרה מרשימת התפוצה"),
)


def settings_words(fields) -> str:
    """["reminder_1_day_enabled", "confirm_wa_template"] → "תזכורות, נוסחי הודעות" """
    words: list[str] = []
    for f in fields:
        w = next((w for keys, w in _SETTING_WORDS if any(k in f for k in keys)), "הגדרות נוספות")
        if w not in words:
            words.append(w)
    return ", ".join(words)


def name_of(db: Session, user_id) -> str:
    """The person's name — the owner without one is "בעל העסק", anyone else without one their e-mail."""
    user = db.get(User, user_id) if user_id else None
    if user is None:
        return ""
    return user.display_name or ("בעל העסק" if user.role == "owner" else user.email)
