"""
The customer club — points, cashback, the birthday benefit, joining. On only where the business's plan sells it (the
customer_club module — pro and up, app/core/features); every action that gives, takes or offers points asks here.
A business that left a plan with the club keeps its members and their points; nothing new is given or taken.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.features import has_module

OFF = "מועדון הלקוחות לא כלול במסלול של העסק"


def club_on(db: Session, studio_id, cache: dict | None = None) -> bool:
    if cache is None:
        return has_module(db, studio_id, "customer_club")
    if studio_id not in cache:
        cache[studio_id] = has_module(db, studio_id, "customer_club")
    return cache[studio_id]


def cashback_percent(db: Session, studio_id, client) -> int:
    """The percent of a payment that comes back as points — 0 for a client outside the club, or a business without it."""
    if not client or not client.is_club_member or not club_on(db, studio_id):
        return 0
    from app.models.studio_settings import StudioSettings
    settings = db.get(StudioSettings, studio_id)
    return max(0, int(settings.points_percent_per_payment or 0)) if settings else 0
