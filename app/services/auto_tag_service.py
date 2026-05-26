"""
Auto-tags a lead based on the first message content using Claude Haiku.
Called from the webhook when a new lead is created.
Tags: service interest + lead temperature.
"""
from __future__ import annotations
import json
import uuid

import anthropic
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.lead import Lead
from app.utils.logger import get_logger

log = get_logger(__name__)

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


SERVICE_KEYWORDS = {
    "קעקוע קטן": ["קעקוע קטן", "קטנה", "מיני", "tiny", "small"],
    "שרוול": ["שרוול", "sleeve", "כל היד"],
    "גב": ["גב", "back"],
    "צוואר": ["צוואר", "neck"],
    "פירסינג": ["פירסינג", "piercing", "עגיל", "נוז"],
    "תיקון": ["תיקון", "לתקן", "touch up", "touch-up"],
    "מחיקה": ["מחיקה", "להסיר", "הסרה", "removal", "laser"],
    "ייעוץ": ["ייעוץ", "consultation", "שאלה", "לשאול"],
}


def _classify_sync(message: str) -> dict:
    """Synchronous Claude call — fast Haiku model."""
    prompt = f"""סווג הודעה זו מלקוח פוטנציאלי לסטודיו קעקועים.

הודעה: "{message[:300]}"

החזר JSON בלבד (ללא טקסט נוסף):
{{
  "service_interest": "שם השירות המבוקש בעברית (או null אם לא ברור)",
  "temperature": "hot|warm|cold",
  "notes": "הערה קצרה אם יש (אופציונלי)"
}}

temperature:
- hot = רוצה לקבוע תור, שאלה ספציפית על מחיר/זמינות
- warm = מתעניין, שואל שאלות כלליות
- cold = סתם התעניינות, לא בדחיפות"""

    try:
        client = _get_client()
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=128,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)
    except Exception as e:
        log.warning("[auto_tag] classification failed: %s", e)
        return {}


def tag_lead(db: Session, lead_id: uuid.UUID, message: str) -> None:
    """
    Classify `message` with AI and update the lead's service_interest + notes.
    Runs synchronously — called in background from webhook handler.
    """
    lead = db.scalar(select(Lead).where(Lead.id == lead_id))
    if not lead or lead.service_interest:
        return

    result = _classify_sync(message)
    if not result:
        return

    changed = False
    if result.get("service_interest") and not lead.service_interest:
        lead.service_interest = result["service_interest"]
        changed = True

    temp = result.get("temperature")
    if temp == "hot" and not lead.notes:
        lead.notes = "🔥 ליד חם — מתעניין באופן פעיל"
        changed = True
    elif temp == "cold" and not lead.notes:
        lead.notes = "❄️ ליד קר — התעניינות ראשונית"
        changed = True

    if changed:
        db.commit()
        log.info("[auto_tag] lead %s tagged: service=%s temp=%s", lead_id, result.get("service_interest"), temp)
