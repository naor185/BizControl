"""
Auto-tags a lead based on the first message content using Claude Haiku.
Called from the webhook when a new lead is created.
Tags: service interest + lead temperature.
"""
from __future__ import annotations
import json
import uuid

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.lead import Lead
from app.utils.logger import get_logger

log = get_logger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic   # imported here: the package is not in requirements.txt (see the webhook caller)
        _client = anthropic.Anthropic()
    return _client


def _classify_sync(message: str, business_field: str, services: list[str]) -> dict:
    """Synchronous Claude call — fast Haiku model. Told the business's own field and services, so a
    lead is never tagged with another field's service (a clinic's lead as a tattoo)."""
    services_line = ", ".join(services) if services else "לא הוגדרו"
    prompt = f"""סווג הודעה זו מלקוח פוטנציאלי לעסק בתחום: {business_field}.
השירותים של העסק: {services_line}

הודעה: "{message[:300]}"

החזר JSON בלבד (ללא טקסט נוסף):
{{
  "service_interest": "השירות המבוקש — אחד מהשירותים של העסק אם מתאים, אחרת בעברית קצרה (או null אם לא ברור)",
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

    from app.models.service import Service
    from app.services.business_types import describe, type_lookup
    from app.models.studio import Studio
    studio = db.get(Studio, lead.studio_id)
    field = describe(type_lookup(db), studio.business_type if studio else None)["label"]
    services = list(db.scalars(select(Service.name).where(Service.studio_id == lead.studio_id,
                                                         Service.is_active.is_(True))).all())[:30]
    result = _classify_sync(message, field, services)
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
