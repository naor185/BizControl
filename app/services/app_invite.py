"""The invitation to the BizFind app — a client hears they can book, see their balance and their purchases in the app
(owner, 2026-10-13).

- One link for every phone (find.biz-control.com/app?b=<business>): an iPhone opens the App Store, an Android
  Google Play, a computer the website. Until the superadmin sets the store links (platform settings), the link opens
  the business's page on BizFind's website — the invitations already sent start leading to the stores the day they do.
- The text says only what this client can really do at this business, by its plan and its settings: book by
  themselves (self-booking on), their points (the club in the plan), their punch card or membership and the classes
  (classes in the plan) — and always their appointments, receipts and photos ({app_features}).
- Sent once per client, after their first visit (the club invitation's moments: an appointment done, a payment, a
  sale at the till), at the owner's time (app_invite_delay_minutes, a day by default) — or by hand from the client's
  card. Not to a client who is already on BizFind.
- Marketing (services/marketing.MARKETING_TYPES): never to a client who asked to be off the list; it counts in the
  plan's WhatsApp messages like any message."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings

KIND = "app_invite"
BIZFIND_URL = os.getenv("BIZFIND_URL", "https://find.biz-control.com").rstrip("/")

DEFAULT_TEXT = (
    "היי {client_name} 👋\n"
    "תודה שביקרת ב{studio_name}!\n"
    "באפליקציית BizFind אפשר:\n"
    "{app_features}\n\n"
    "להורדה: {app_link}"
)


def app_link(slug: str | None) -> str:
    return f"{BIZFIND_URL}/app" + (f"?b={slug}" if slug else "")


def features(db: Session, studio_id, settings: StudioSettings | None) -> list[str]:
    """What this business's clients can do in the app — by its plan and its settings."""
    from app.core.features import has_module
    from app.services.club import club_on
    out = []
    if settings is not None and settings.self_booking_enabled:
        out.append("לקבוע תור בעצמך ולראות מתי יש מקום")
    if club_on(db, studio_id):
        out.append("לראות כמה נקודות יש לך במועדון")
    if has_module(db, studio_id, "classes"):
        out.append("להירשם לשיעורים" + (" ולראות את הכרטיסייה או המנוי שלך ומה נשאר בהם"
                                       if has_module(db, studio_id, "memberships") else ""))
    out.append("לראות את התורים, הקבלות והתמונות שלך")
    return out


def _on_bizfind(db: Session, phone: str) -> bool:
    return bool(db.execute(text("SELECT 1 FROM marketplace_customers WHERE phone = :p LIMIT 1"), {"p": phone}).first())


def maybe_enqueue(db: Session, studio_id, client, appointment_id=None, *, by_hand: bool = False) -> str | None:
    """Queue the invitation (WhatsApp, and e-mail when the client has one). None when queued; otherwise why not, in the
    owner's words (by hand) — automatically it simply isn't sent."""
    from app.crud.automation import format_template
    from app.services.email_center import studio_email_allowed
    from app.services.marketing import refusal_reason, unsubscribe_link

    if client is not None and not client.phone:
        return "ללקוח אין מספר טלפון"
    refused = refusal_reason(client)                     # off the list, no consent, not active
    if refused:
        return refused
    settings = db.get(StudioSettings, studio_id)
    if settings is None:
        return "ההגדרות של העסק לא נמצאו"
    sent = select(MessageJob.created_at).where(MessageJob.studio_id == studio_id, MessageJob.client_id == client.id,
                                               MessageJob.reminder_type == KIND)
    if by_hand:
        last = db.scalar(sent.order_by(MessageJob.created_at.desc()).limit(1))
        if last and last > datetime.now(timezone.utc) - timedelta(hours=24):
            return "ההזמנה כבר נשלחה ללקוח היום"
    else:
        if not settings.app_invite_enabled or db.scalar(sent.limit(1)) is not None or _on_bizfind(db, client.phone):
            return "לא נשלחה"

    studio = db.get(Studio, studio_id)
    template = settings.app_invite_wa_template or DEFAULT_TEXT
    optout = unsubscribe_link(db, studio_id, client.id)
    body = format_template(template, {
        "client_name": client.full_name or "",
        "studio_name": studio.name if studio else "",
        "app_link": app_link(studio.slug if studio else None),
        "app_features": "\n".join(f"• {f}" for f in features(db, studio_id, settings)),
        "optout_link": optout,
    })
    if "{optout_link}" not in template:                   # marketing always carries the way off the list
        body += f"\n\nלהסרה מרשימת ההודעות: {optout}"
    delay = 0 if by_hand else max(0, int(settings.app_invite_delay_minutes if settings.app_invite_delay_minutes is not None else 1440))
    when = datetime.now(timezone.utc) + timedelta(minutes=delay)
    db.add(MessageJob(studio_id=studio_id, client_id=client.id, appointment_id=appointment_id, channel="whatsapp",
                      to_phone=client.phone, body=body, scheduled_at=when, status="pending", reminder_type=KIND))
    if client.email and studio_email_allowed(db, studio_id, "email_app_invite_enabled"):
        from app.utils.email_templates import _email_base, text_as_email_html
        db.add(MessageJob(studio_id=studio_id, client_id=client.id, appointment_id=appointment_id, channel="email",
                          to_phone=client.email, subject=f"{studio.name if studio else ''} — האפליקציה שלנו",
                          body=_email_base("האפליקציה שלנו", text_as_email_html(body)),
                          scheduled_at=when, status="pending", reminder_type=f"{KIND}_email"))
    db.commit()
    return None
