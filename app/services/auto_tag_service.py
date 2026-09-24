"""
Auto-tags a lead from its first message: the service it asks about and how warm it is.
Called in the background from the webhook when a new lead is created.

Uses the same AI provider as ויקי (Groq / Gemini / OpenAI — app/services/ai/orchestrator.complete_json).
It used Anthropic before, whose package is not installed, so it never ran. It runs only for a studio
whose "ai_auto_tag" module (under ויקי) is on — the superadmin decides per plan or studio.
"""
from __future__ import annotations
import uuid

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.lead import Lead
from app.services.ai.orchestrator import complete_json
from app.utils.logger import get_logger

log = get_logger(__name__)


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

    return complete_json(prompt, max_tokens=150) or {}


def tag_lead(db: Session, lead_id: uuid.UUID, message: str) -> None:
    """
    Classify `message` with AI and update the lead's service_interest + notes.
    Runs synchronously — called in background from webhook handler.
    """
    lead = db.scalar(select(Lead).where(Lead.id == lead_id))
    if not lead or lead.service_interest:
        return

    from app.core.features import is_module_enabled
    from app.models.studio import Studio
    studio = db.get(Studio, lead.studio_id)
    if not studio or not is_module_enabled(db, studio.id, studio.subscription_plan, "ai_auto_tag"):
        return   # off unless the superadmin turned "תיוג AI אוטומטי ללידים" on for this plan/studio

    from app.models.service import Service
    from app.services.business_types import describe, type_lookup
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
