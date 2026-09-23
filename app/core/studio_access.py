"""
One definition of "this studio's paid access has ended", shared by the API gate
(app/middleware/plan_enforcement.py) and every public-facing endpoint.

When access ends, the studio's own staff are locked out (402) AND its public site
is *archived*: landing page, online booking, waitlist, club sign-up, gift-card shop
and the BizFind listing stop taking customers. Nothing is deleted. Archived is
computed on every request, never stored, so the moment the subscription is renewed
(Subscription.status back to trial/active and plan_expires_at in the future) the
site opens again and booking works, with no step in between.

"Archived" mirrors the staff lockout exactly, because that is what the owner asked
for: the site closes when the calendar stops working. The two lockout paths are
Subscription.status outside ACCESS_OK_STATUSES (the 402 middleware) and
Studio.plan_expires_at in the past (app/core/auth_deps.get_current_user).
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session

from app.models.studio import Studio
from app.models.subscription import Subscription

# Statuses that keep full access. past_due/grace_period are intentionally included:
# a failed renewal charge degrades to a warning, not an instant lockout; the
# grace_period→suspended transition (expiry sweep cron) is what eventually blocks
# access if nothing is resolved.
ACCESS_OK_STATUSES = frozenset({"trial", "active", "past_due", "grace_period"})

# Shown to the customer who opens an archived studio's page or tries to book.
ARCHIVED_DETAIL = "העסק אינו זמין להזמנות כרגע — האתר שלו בארכיון. הוא יחזור לפעול ברגע שהעסק יחדש את המנוי."


def studio_is_archived(db: Session, studio: Studio) -> bool:
    if studio.is_platform:
        return False
    sub = db.scalar(select(Subscription).where(Subscription.studio_id == studio.id))
    if sub is not None and sub.status not in ACCESS_OK_STATUSES:
        return True
    return bool(studio.plan_expires_at and studio.plan_expires_at < datetime.now(timezone.utc))


def raise_if_archived(db: Session, studio: Studio) -> None:
    """410 Gone (not 404) so pages can tell 'archived, will return' from 'no such business'."""
    if studio_is_archived(db, studio):
        raise HTTPException(status_code=410, detail=ARCHIVED_DETAIL)


def studio_site_live():
    """SQL condition for .where(): the studios whose site is NOT archived (same rule as
    studio_is_archived, for listings that filter many studios at once)."""
    now = datetime.now(timezone.utc)
    blocked_status = exists().where(
        Subscription.studio_id == Studio.id,
        Subscription.status.notin_(ACCESS_OK_STATUSES),
    )
    return or_(
        Studio.is_platform.is_(True),
        and_(~blocked_status, or_(Studio.plan_expires_at.is_(None), Studio.plan_expires_at >= now)),
    )
