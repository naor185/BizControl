"""
Messages from the company to the businesses' owners — the superadmin's CRM, part ב (owner, 2026-10-10).
WhatsApp from BizControl's own number (the one every business without its own uses — not the platform business's
own Meta line, which Meta blocks outside a 24-hour window; message_worker.py) and e-mail in BizControl's name, to one
business, the chosen ones, or everyone a filter shows. Each message goes through the queue (message_jobs) as the platform's own, to the owner (a user of the
business) — so it's retried, logged, and listed back per business. Templates the superadmin edits; a message fills
{owner_name}, {business_name}, {plan}, {days_left}.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

KIND = "crm"                       # message_jobs.reminder_type of a message from the company
CHANNELS = {"whatsapp": ("whatsapp",), "email": ("email",), "both": ("whatsapp", "email")}

DEFAULT_TEMPLATES = [
    ("welcome", "ברוכים הבאים", "ברוכים הבאים ל-BizControl",
     "היי {owner_name}, ברוכים הבאים ל-BizControl! 🎉\nהחודש הראשון של {business_name} חינם, עם כל המערכת פתוחה.\n"
     "צריכים עזרה בהקמה? כתבו לנו ל-support@biz-control.com"),
    ("trial_ending", "החודש החינמי נגמר בקרוב", "החודש החינמי שלך נגמר בקרוב",
     "היי {owner_name}, החודש החינמי של {business_name} נגמר בעוד {days_left} ימים.\n"
     "כדי להמשיך בלי הפסקה בוחרים מסלול בדף המנוי במערכת: https://www.biz-control.com/billing\n"
     "שאלות? support@biz-control.com"),
    ("payment_reminder", "תזכורת תשלום", "תזכורת: תשלום המנוי ל-BizControl",
     "היי {owner_name}, תזכורת: התשלום על מסלול {plan} של {business_name} מגיע בעוד {days_left} ימים.\n"
     "שילמת כבר? תודה, ואפשר להתעלם מההודעה."),
    ("tip", "טיפ לשימוש", "טיפ קטן מ-BizControl",
     "היי {owner_name}, טיפ קטן מ-BizControl: תזכורות WhatsApp אוטומטיות ללקוחות מורידות ביטולים של הרגע האחרון.\n"
     "מפעילים בהגדרות ← מדיניות ואוטומציה."),
    ("win_back", "התגעגענו", "התגעגענו אליך ב-BizControl",
     "היי {owner_name}, שמנו לב שלא נכנסת ל-BizControl כבר זמן מה.\nיש משהו שנוכל לעזור בו? כתבו לנו ל-support@biz-control.com"),
]


def platform_studio_id(db: Session) -> uuid.UUID | None:
    """The platform's own business — the sender of a message from the company. Found the way the platform settings
    are (superadmin_routes._get_platform_settings): PLATFORM_STUDIO_ID, else the business marked is_platform."""
    env = os.getenv("PLATFORM_STUDIO_ID", "")
    if env:
        try:
            return uuid.UUID(env)
        except ValueError:
            pass
    from app.models.studio import Studio
    return db.scalar(select(Studio.id).where(Studio.is_platform.is_(True)).limit(1))


def templates(db: Session) -> list[dict]:
    rows = db.execute(text("SELECT key, name, email_subject, body FROM platform_message_templates ORDER BY sort, key")).fetchall()
    return [{"key": r[0], "name": r[1], "email_subject": r[2], "body": r[3]} for r in rows]


def save_template(db: Session, key: str, name: str, email_subject: str, body: str) -> None:
    db.execute(text("""
        INSERT INTO platform_message_templates (key, name, email_subject, body, sort) VALUES (:k, :n, :s, :b, 100)
        ON CONFLICT (key) DO UPDATE SET name = :n, email_subject = :s, body = :b, updated_at = NOW()
    """), {"k": key, "n": name, "s": email_subject, "b": body})
    db.commit()


def fill(body: str, values: dict) -> str:
    out = body
    for k, v in values.items():
        out = out.replace("{" + k + "}", str(v) if v is not None else "")
    return out


def send(db: Session, studio_ids: list[str], channel: str, body: str, subject: str | None) -> dict:
    """Queue the message to each business's owner. {queued, skipped: [{name, reason}]}."""
    from app.models.message_job import MessageJob
    from app.services.platform_crm import customers
    sender = platform_studio_id(db)
    if sender is None:
        raise ValueError("לא הוגדר העסק של הפלטפורמה (PLATFORM_STUDIO_ID) — אין ממי לשלוח")
    wanted = set(studio_ids)
    queued, skipped = 0, []
    now = datetime.now(timezone.utc)
    for c in customers(db):
        if c["id"] not in wanted:
            continue
        values = {"owner_name": c["owner_name"] or "", "business_name": c["name"], "plan": c["plan_label"],
                  "days_left": c["days_left"] if c["days_left"] is not None and c["days_left"] >= 0 else ""}
        owner_id = db.scalar(text("SELECT id FROM users WHERE studio_id = :s AND role = 'owner' ORDER BY is_active DESC LIMIT 1"),
                             {"s": c["id"]})
        for ch in CHANNELS[channel]:
            to = c["owner_phone"] if ch == "whatsapp" else c["owner_email"]
            if not to:
                skipped.append({"name": c["name"], "reason": "אין לבעל העסק טלפון" if ch == "whatsapp" else "אין לבעל העסק מייל"})
                continue
            db.add(MessageJob(studio_id=sender, recipient_user_id=owner_id, channel=ch, to_phone=to,
                              subject=fill(subject or "הודעה מ-BizControl", values) if ch == "email" else None,
                              body=fill(body, values), reminder_type=KIND, scheduled_at=now, status="pending"))
            queued += 1
    db.commit()
    return {"queued": queued, "skipped": skipped}


def _as_text(body: str | None) -> str:
    """An e-mail goes out as HTML (message_worker turns the lines into it); the log shows the words."""
    import html
    import re
    return html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", chr(10), body or ""))).strip()


def sent(db: Session, studio_id: str | None = None, limit: int = 200) -> list[dict]:
    """Messages from the company, newest first — all of them, or one business's."""
    rows = db.execute(text(f"""
        SELECT m.id, m.channel, m.to_phone, m.subject, m.body, m.status, m.last_error, m.created_at, m.sent_at,
               s.id, s.name
        FROM message_jobs m
        JOIN users u ON u.id = m.recipient_user_id
        JOIN studios s ON s.id = u.studio_id
        WHERE m.reminder_type = :k {"AND s.id = :s" if studio_id else ""}
        ORDER BY m.created_at DESC LIMIT :n
    """), {"k": KIND, "s": studio_id, "n": limit}).fetchall()
    return [{"id": str(r[0]), "channel": r[1], "to": r[2], "subject": r[3],
             "body": _as_text(r[4]) if r[1] == "email" else r[4], "status": r[5],
             "error": r[6], "created_at": r[7].isoformat() if r[7] else None, "sent_at": r[8].isoformat() if r[8] else None,
             "studio_id": str(r[9]), "studio_name": r[10]} for r in rows]
