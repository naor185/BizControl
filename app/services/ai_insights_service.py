"""
Generates AI-powered business insights by analyzing leads + ad data.
Uses Claude API to produce actionable recommendations in Hebrew.
"""
from __future__ import annotations
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import anthropic
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ad_insight import AdInsight
from app.models.ai_insight import AiInsight
from app.models.lead import Lead
from app.utils.logger import get_logger

log = get_logger(__name__)

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


def _build_data_summary(db: Session, studio_id: uuid.UUID) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    leads = db.scalars(select(Lead).where(Lead.studio_id == studio_id, Lead.created_at >= cutoff)).all()

    by_source: dict[str, dict] = {}
    for l in leads:
        src = l.source
        if src not in by_source:
            by_source[src] = {"total": 0, "booked": 0, "lost": 0}
        by_source[src]["total"] += 1
        if l.status == "booked":
            by_source[src]["booked"] += 1
        elif l.status == "lost":
            by_source[src]["lost"] += 1

    by_campaign: dict[str, dict] = {}
    for l in leads:
        if not l.campaign_name:
            continue
        k = l.campaign_name
        if k not in by_campaign:
            by_campaign[k] = {"total": 0, "booked": 0, "source": l.source}
        by_campaign[k]["total"] += 1
        if l.status == "booked":
            by_campaign[k]["booked"] += 1

    # Ads data
    ad_cutoff = date.today() - timedelta(days=30)
    ads = db.scalars(select(AdInsight).where(AdInsight.studio_id == studio_id, AdInsight.date_start >= ad_cutoff)).all()
    total_spend = sum(a.spend_cents for a in ads) / 100
    total_leads_ads = sum(a.leads for a in ads)
    total_clicks = sum(a.clicks for a in ads)
    total_impressions = sum(a.impressions for a in ads)

    return {
        "period": "30 ימים אחרונים",
        "leads": {
            "total": len(leads),
            "booked": sum(1 for l in leads if l.status == "booked"),
            "lost": sum(1 for l in leads if l.status == "lost"),
            "new": sum(1 for l in leads if l.status == "new"),
            "by_source": by_source,
            "by_campaign": by_campaign,
        },
        "ads": {
            "total_spend_ils": round(total_spend, 2),
            "total_leads": total_leads_ads,
            "total_clicks": total_clicks,
            "total_impressions": total_impressions,
            "cpl": round(total_spend / total_leads_ads, 2) if total_leads_ads else None,
            "ctr": round(total_clicks / total_impressions * 100, 2) if total_impressions else None,
        },
    }


async def generate_studio_insights(db: Session, studio_id: uuid.UUID) -> int:
    """
    Generates up to 5 AI insights for the studio.
    Deletes old insights first, then inserts fresh ones.
    Returns count of generated insights.
    """
    data = _build_data_summary(db, studio_id)

    prompt = f"""אתה יועץ שיווקי לעסקי שירות (סטודיו לקעקועים / יופי / ספא).
בסס את ניתוחך על הנתונים הבאים מ-{data['period']}:

{json.dumps(data, ensure_ascii=False, indent=2)}

צור בדיוק 5 תובנות עסקיות ממוקדות ופרקטיות בעברית.
כל תובנה צריכה להיות תוצאה-מוכוונת: מה לעשות / מה לשנות / מה להגביר.
אם אין מספיק נתונים בתחום מסוים — אמור זאת ותן המלצה כללית.

החזר JSON בפורמט הבא בלבד (ללא טקסט נוסף):
[
  {{
    "type": "ads|organic|leads|general",
    "priority": "high|medium|low",
    "icon": "📈",
    "title": "כותרת קצרה (עד 60 תווים)",
    "body": "הסבר וממצא (2-3 משפטים, עד 200 תווים)"
  }},
  ...
]"""

    try:
        client = _get_client()
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        # Strip markdown code block if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        insights_data: list[dict] = json.loads(raw)
    except Exception as e:
        log.error("[ai_insights] generation failed: %s", e)
        raise

    # Delete existing insights for this studio
    existing = db.scalars(select(AiInsight).where(AiInsight.studio_id == studio_id)).all()
    for row in existing:
        db.delete(row)

    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=24)
    count = 0

    for item in insights_data[:5]:
        db.add(AiInsight(
            id=uuid.uuid4(),
            studio_id=studio_id,
            type=item.get("type", "general"),
            title=item.get("title", "")[:255],
            body=item.get("body", ""),
            priority=item.get("priority", "medium"),
            icon=item.get("icon"),
            generated_at=now,
            expires_at=expires,
        ))
        count += 1

    db.commit()
    return count
