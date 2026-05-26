"""
Fetches ad performance data from Meta Marketing API and caches it in ad_insights.
Requires: meta_ad_account_id + meta_page_access_token in studio settings.
"""
from __future__ import annotations
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.models.ad_insight import AdInsight
from app.models.studio_settings import StudioSettings
from app.utils.logger import get_logger

log = get_logger(__name__)

META_GRAPH_VERSION = "v19.0"
META_BASE = f"https://graph.facebook.com/{META_GRAPH_VERSION}"

INSIGHT_FIELDS = ",".join([
    "campaign_id", "campaign_name",
    "adset_id", "adset_name",
    "ad_id", "ad_name",
    "impressions", "clicks", "reach", "spend",
    "actions", "action_values",
    "date_start", "date_stop",
])


def _spend_cents(spend_str: str | None) -> int:
    try:
        return round(float(spend_str or 0) * 100)
    except (ValueError, TypeError):
        return 0


def _action_count(actions: list[dict], action_type: str) -> int:
    for a in (actions or []):
        if a.get("action_type") == action_type:
            try:
                return int(float(a.get("value", 0)))
            except (ValueError, TypeError):
                pass
    return 0


def sync_ad_insights(
    db: Session,
    studio_id: uuid.UUID,
    settings: StudioSettings,
    days_back: int = 30,
) -> dict:
    """
    Pull the last `days_back` days of ad insights from Meta and upsert into ad_insights.
    Returns a summary dict.
    """
    token = settings.meta_page_access_token
    account_id = settings.meta_ad_account_id if hasattr(settings, "meta_ad_account_id") else None

    if not token or not account_id:
        return {"ok": False, "error": "meta_ad_account_id or meta_page_access_token not configured"}

    date_since = (date.today() - timedelta(days=days_back)).isoformat()
    date_until = date.today().isoformat()

    try:
        resp = httpx.get(
            f"{META_BASE}/act_{account_id}/insights",
            params={
                "access_token": token,
                "fields": INSIGHT_FIELDS,
                "level": "ad",
                "time_range": f'{{"since":"{date_since}","until":"{date_until}"}}',
                "time_increment": 1,
                "limit": 500,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.error("[meta_ads_sync] API error: %s", e)
        return {"ok": False, "error": str(e)}

    rows: list[dict[str, Any]] = data.get("data", [])
    synced_count = 0
    now = datetime.now(timezone.utc)

    for row in rows:
        campaign_id = row.get("campaign_id", "")
        ad_id = row.get("ad_id")
        ds = row.get("date_start", "")
        de = row.get("date_stop", "")

        if not campaign_id or not ds:
            continue

        # Delete existing row for this (studio, ad, date) before inserting fresh data
        db.execute(
            delete(AdInsight).where(
                AdInsight.studio_id == studio_id,
                AdInsight.campaign_id == campaign_id,
                AdInsight.ad_id == ad_id,
                AdInsight.date_start == date.fromisoformat(ds),
            )
        )

        actions_list = row.get("actions", [])
        insight = AdInsight(
            id=uuid.uuid4(),
            studio_id=studio_id,
            date_start=date.fromisoformat(ds),
            date_stop=date.fromisoformat(de),
            campaign_id=campaign_id,
            campaign_name=row.get("campaign_name", ""),
            ad_set_id=row.get("adset_id"),
            ad_set_name=row.get("adset_name"),
            ad_id=ad_id,
            ad_name=row.get("ad_name"),
            impressions=int(row.get("impressions", 0)),
            clicks=int(row.get("clicks", 0)),
            reach=int(row.get("reach", 0)),
            spend_cents=_spend_cents(row.get("spend")),
            leads=_action_count(actions_list, "lead"),
            link_clicks=_action_count(actions_list, "link_click"),
            actions=actions_list or None,
            synced_at=now,
        )
        db.add(insight)
        synced_count += 1

    db.commit()
    return {"ok": True, "synced": synced_count, "date_since": date_since, "date_until": date_until}


def get_campaign_summary(db: Session, studio_id: uuid.UUID, days_back: int = 30) -> list[dict]:
    """Aggregate ad_insights by campaign for the last N days."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.scalars(
        select(AdInsight).where(
            AdInsight.studio_id == studio_id,
            AdInsight.date_start >= cutoff,
        )
    ).all()

    campaigns: dict[str, dict] = {}
    for r in rows:
        k = r.campaign_id
        if k not in campaigns:
            campaigns[k] = {
                "campaign_id": k,
                "campaign_name": r.campaign_name,
                "impressions": 0,
                "clicks": 0,
                "reach": 0,
                "spend_cents": 0,
                "leads": 0,
                "link_clicks": 0,
            }
        c = campaigns[k]
        c["impressions"] += r.impressions
        c["clicks"] += r.clicks
        c["reach"] += r.reach
        c["spend_cents"] += r.spend_cents
        c["leads"] += r.leads
        c["link_clicks"] += r.link_clicks

    result = []
    for c in campaigns.values():
        spend = c["spend_cents"] / 100
        impr = c["impressions"]
        clicks = c["clicks"]
        leads = c["leads"]
        c["ctr"] = round(clicks / impr * 100, 2) if impr > 0 else 0
        c["cpm"] = round(spend / impr * 1000, 2) if impr > 0 else 0
        c["cpc"] = round(spend / clicks, 2) if clicks > 0 else 0
        c["cpl"] = round(spend / leads, 2) if leads > 0 else 0
        c["spend"] = round(spend, 2)
        result.append(c)

    return sorted(result, key=lambda x: x["spend_cents"], reverse=True)


def get_daily_spend(db: Session, studio_id: uuid.UUID, days_back: int = 30) -> list[dict]:
    """Return daily spend + leads for the last N days (for chart)."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.scalars(
        select(AdInsight).where(
            AdInsight.studio_id == studio_id,
            AdInsight.date_start >= cutoff,
        ).order_by(AdInsight.date_start)
    ).all()

    daily: dict[str, dict] = {}
    for r in rows:
        k = r.date_start.isoformat()
        if k not in daily:
            daily[k] = {"date": k, "spend_cents": 0, "leads": 0, "clicks": 0, "impressions": 0}
        daily[k]["spend_cents"] += r.spend_cents
        daily[k]["leads"] += r.leads
        daily[k]["clicks"] += r.clicks
        daily[k]["impressions"] += r.impressions

    return [{"date": d["date"], "spend": round(d["spend_cents"] / 100, 2), "leads": d["leads"], "clicks": d["clicks"], "impressions": d["impressions"]}
            for d in sorted(daily.values(), key=lambda x: x["date"])]
