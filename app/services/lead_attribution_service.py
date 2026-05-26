"""
Lead attribution engine.

Records a LeadSource row when a lead converts to a booking, and can update
revenue when a payment is recorded.  Call record_conversion() from the
lead convert endpoint; call record_revenue() from the payment creation path.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.lead import Lead
from app.models.lead_source import LeadSource
from app.utils.logger import get_logger

log = get_logger(__name__)


def record_conversion(
    db: Session,
    lead: Lead,
    conversation_id: uuid.UUID | None = None,
) -> Optional[LeadSource]:
    """
    Create (or update) a LeadSource row when a lead converts to a booking.
    No-ops gracefully if attribution data is missing.
    """
    # Require at least a platform to be worth recording
    if not lead.source or lead.source == "manual":
        return None

    # Avoid duplicates — check if we already have a conversion row
    existing = db.scalar(
        select(LeadSource).where(
            LeadSource.lead_id == lead.id,
            LeadSource.converted_to_booking == True,  # noqa: E712
        )
    )
    if existing:
        return existing

    now = datetime.now(timezone.utc)

    ls = LeadSource(
        id=uuid.uuid4(),
        studio_id=lead.studio_id,
        lead_id=lead.id,
        conversation_id=conversation_id,
        platform=lead.source,                  # whatsapp | instagram | facebook
        source_type=_infer_source_type(lead),
        campaign_id=None,
        campaign_name=lead.campaign_name,
        ad_id=lead.ad_id,
        converted_to_booking=True,
        converted_at=now,
    )
    db.add(ls)

    log.info("[attribution] recorded conversion: lead=%s platform=%s campaign=%s", lead.id, lead.source, lead.campaign_name)
    return ls


def record_revenue(
    db: Session,
    lead_id: uuid.UUID,
    revenue_cents: int,
) -> bool:
    """
    Back-fill revenue on the attribution row once a payment is created.
    Returns True if a row was found and updated.
    """
    row = db.scalar(
        select(LeadSource).where(
            LeadSource.lead_id == lead_id,
            LeadSource.converted_to_booking == True,  # noqa: E712
        )
    )
    if not row:
        return False
    row.revenue_cents = (row.revenue_cents or 0) + revenue_cents
    log.info("[attribution] revenue updated: lead=%s revenue_cents=%d", lead_id, revenue_cents)
    return True


def _infer_source_type(lead: Lead) -> str:
    """Derive source_type from lead fields — best-effort."""
    if lead.ad_id:
        return "paid_ad"
    if lead.campaign_name:
        return "paid_ad"
    return "organic"
