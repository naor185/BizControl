"""
Analytics API — Meta Ads data, organic lead analytics, AI insights.
"""
from __future__ import annotations
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.core.features import require_feature
from app.models.ad_insight import AdInsight
from app.models.ai_insight import AiInsight
from app.models.lead import Lead
from app.models.studio_settings import StudioSettings
from app.services.meta_ads_service import sync_ad_insights, get_campaign_summary, get_daily_spend

router = APIRouter(prefix="/analytics", tags=["Analytics"])


# ── Meta Ads ──────────────────────────────────────────────────────────────────

@router.post("/ads/sync")
def trigger_sync(
    days_back: int = 30,
    background_tasks: BackgroundTasks = None,
    _: None = Depends(require_feature("marketing_analytics")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Trigger a fresh sync from Meta Marketing API."""
    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")

    if not getattr(settings, "meta_ad_account_id", None) or not settings.meta_page_access_token:
        raise HTTPException(status_code=400, detail="meta_ad_account_id and meta_page_access_token required")

    result = sync_ad_insights(db, ctx.studio_id, settings, days_back=days_back)
    if not result["ok"]:
        raise HTTPException(status_code=502, detail=result.get("error", "Sync failed"))
    return result


@router.get("/ads/campaigns")
def ads_campaigns(
    days_back: int = 30,
    _: None = Depends(require_feature("marketing_analytics")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    return get_campaign_summary(db, ctx.studio_id, days_back=days_back)


@router.get("/ads/daily")
def ads_daily(
    days_back: int = 30,
    _: None = Depends(require_feature("marketing_analytics")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    return get_daily_spend(db, ctx.studio_id, days_back=days_back)


@router.get("/ads/summary")
def ads_summary(
    days_back: int = 30,
    _: None = Depends(require_feature("marketing_analytics")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Total KPIs across all campaigns for the period."""
    cutoff = date.today() - timedelta(days=days_back)
    rows = db.scalars(
        select(AdInsight).where(
            AdInsight.studio_id == ctx.studio_id,
            AdInsight.date_start >= cutoff,
        )
    ).all()

    total_spend_cents = sum(r.spend_cents for r in rows)
    total_impressions = sum(r.impressions for r in rows)
    total_clicks = sum(r.clicks for r in rows)
    total_leads = sum(r.leads for r in rows)
    total_reach = sum(r.reach for r in rows)
    spend = total_spend_cents / 100

    last_synced = max((r.synced_at for r in rows), default=None)

    return {
        "spend": round(spend, 2),
        "spend_cents": total_spend_cents,
        "impressions": total_impressions,
        "clicks": total_clicks,
        "leads": total_leads,
        "reach": total_reach,
        "ctr": round(total_clicks / total_impressions * 100, 2) if total_impressions else 0,
        "cpm": round(spend / total_impressions * 1000, 2) if total_impressions else 0,
        "cpc": round(spend / total_clicks, 2) if total_clicks else 0,
        "cpl": round(spend / total_leads, 2) if total_leads else 0,
        "last_synced": last_synced.isoformat() if last_synced else None,
        "days_back": days_back,
    }


# ── Organic Analytics ────────────────────────────────────────────────────────

@router.get("/organic/summary")
def organic_summary(
    days_back: int = 30,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Lead-based organic analytics (from our own data, no Meta API needed)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    leads = db.scalars(
        select(Lead).where(
            Lead.studio_id == ctx.studio_id,
            Lead.created_at >= cutoff,
        )
    ).all()

    by_source: dict[str, dict] = {}
    for l in leads:
        src = l.source
        if src not in by_source:
            by_source[src] = {"source": src, "total": 0, "booked": 0, "lost": 0}
        by_source[src]["total"] += 1
        if l.status == "booked":
            by_source[src]["booked"] += 1
        elif l.status == "lost":
            by_source[src]["lost"] += 1

    for s in by_source.values():
        s["conversion_rate"] = round(s["booked"] / s["total"] * 100, 1) if s["total"] else 0

    by_campaign: dict[str, dict] = {}
    for l in leads:
        if not l.campaign_name:
            continue
        k = l.campaign_name
        if k not in by_campaign:
            by_campaign[k] = {"campaign": k, "total": 0, "booked": 0, "source": l.source}
        by_campaign[k]["total"] += 1
        if l.status == "booked":
            by_campaign[k]["booked"] += 1

    for c in by_campaign.values():
        c["conversion_rate"] = round(c["booked"] / c["total"] * 100, 1) if c["total"] else 0

    # Daily lead volume for chart
    daily: dict[str, int] = {}
    for l in leads:
        k = l.created_at.date().isoformat()
        daily[k] = daily.get(k, 0) + 1

    return {
        "total_leads": len(leads),
        "booked": sum(1 for l in leads if l.status == "booked"),
        "lost": sum(1 for l in leads if l.status == "lost"),
        "by_source": sorted(by_source.values(), key=lambda x: x["total"], reverse=True),
        "by_campaign": sorted(by_campaign.values(), key=lambda x: x["total"], reverse=True),
        "daily": [{"date": k, "leads": v} for k, v in sorted(daily.items())],
        "days_back": days_back,
    }


# ── AI Insights ──────────────────────────────────────────────────────────────

class InsightOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    priority: str
    icon: str | None
    generated_at: str

    class Config:
        from_attributes = True


@router.get("/insights", response_model=list[InsightOut])
def list_insights(
    _: None = Depends(require_feature("ai_insights")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(AiInsight).where(
            AiInsight.studio_id == ctx.studio_id,
            (AiInsight.expires_at == None) | (AiInsight.expires_at > now),
        ).order_by(
            AiInsight.priority.desc(),
            AiInsight.generated_at.desc(),
        ).limit(20)
    ).all()

    return [
        InsightOut(
            id=str(r.id),
            type=r.type,
            title=r.title,
            body=r.body,
            priority=r.priority,
            icon=r.icon,
            generated_at=r.generated_at.isoformat(),
        )
        for r in rows
    ]


@router.post("/insights/generate")
async def generate_insights(
    _: None = Depends(require_feature("ai_insights")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Generate fresh AI insights based on current analytics data."""
    from app.services.ai_insights_service import generate_studio_insights
    try:
        count = await generate_studio_insights(db, ctx.studio_id)
        return {"ok": True, "generated": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/insights/{insight_id}", status_code=204)
def dismiss_insight(
    insight_id: uuid.UUID,
    _: None = Depends(require_feature("ai_insights")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(AiInsight).where(AiInsight.id == insight_id, AiInsight.studio_id == ctx.studio_id))
    if row:
        db.delete(row)
        db.commit()
