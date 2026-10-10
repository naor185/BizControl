"""
Multi-Location API — Phase 6.
Allows studio owners to switch between branches and view unified stats.
"""
from __future__ import annotations
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.auth_deps import get_current_user
from app.core.features import require_module
from app.db.deps import get_db
from app.models.user import User
from app.models.studio import Studio
from app.api.superadmin_routes import require_superadmin

router = APIRouter(prefix="/locations", tags=["MultiLocation"])


def _studio_out(s: Studio) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "slug": s.slug,
        "location_name": s.location_name or s.name,
        "is_main_location": s.is_main_location,
        "logo_url": s.logo_url,
        "primary_color": s.primary_color or "#7c3aed",
        "organization_id": str(s.organization_id) if s.organization_id else None,
    }


@router.get("")
def get_my_locations(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Return all locations in the same organization as the current studio."""
    studio = db.get(Studio, ctx.studio_id)
    from app.core.features import has_module
    if not studio or not studio.organization_id or not has_module(db, studio.id, "multi_location"):
        # Single location (or branches not in the plan — enterprise) — return just this studio
        return [_studio_out(studio)] if studio else []

    siblings = db.scalars(
        select(Studio).where(
            Studio.organization_id == studio.organization_id,
            Studio.is_active == True,  # noqa
        ).order_by(Studio.is_main_location.desc(), Studio.name)
    ).all()
    return [_studio_out(s) for s in siblings]


@router.post("/switch/{target_studio_id}")
def switch_location(
    target_studio_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _plan: None = Depends(require_module("multi_location")),      # branches — enterprise
):
    """Get a token for a different location in the same organization."""
    from app.core.security import create_access_token

    current = db.get(Studio, ctx.studio_id)
    target = db.get(Studio, uuid.UUID(target_studio_id))

    if not current or not target:
        raise HTTPException(404, "Studio not found")

    # Must be in the same organization
    if (not current.organization_id or
            current.organization_id != target.organization_id):
        raise HTTPException(403, "Not in the same organization")

    # Check user is owner/admin of current studio
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(403, "Only owners can switch locations")

    # Find the user in the target studio (or use the same user if they exist there)
    target_user = db.scalar(
        select(User).where(
            User.studio_id == target.id,
            User.role.in_(["owner", "admin"]),
            User.is_active == True,  # noqa
        )
    ) or current_user  # fallback to current user

    token = create_access_token({
        "user_id": str(target_user.id),
        "studio_id": str(target.id),
        "role": target_user.role,
        "switched_from": str(ctx.studio_id),
    })
    return {
        "access_token": token,
        "studio_name": target.name,
        "location_name": target.location_name or target.name,
    }


@router.get("/unified-stats")
def unified_stats(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
    _plan: None = Depends(require_module("multi_location")),
):
    """Aggregate stats across all locations in the organization."""
    from app.models.appointment import Appointment
    from app.models.payment import Payment
    from app.models.client import Client
    from datetime import datetime, timezone
    import pytz

    studio = db.get(Studio, ctx.studio_id)
    if not studio or not studio.organization_id:
        raise HTTPException(400, "No organization configured")

    org_studios = db.scalars(
        select(Studio).where(
            Studio.organization_id == studio.organization_id,
            Studio.is_active == True,  # noqa
        )
    ).all()
    org_ids = [s.id for s in org_studios]

    tz = pytz.timezone("Asia/Jerusalem")
    now = datetime.now(tz)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Revenue this month across all locations
    revenue = db.scalar(
        select(func.sum(Payment.amount_cents)).where(
            Payment.studio_id.in_(org_ids),
            Payment.status == "paid",
            Payment.type == "payment",
            Payment.paid_at >= month_start.astimezone(timezone.utc),
        )
    ) or 0

    # Appointments this month
    appt_count = db.scalar(
        select(func.count(Appointment.id)).where(
            Appointment.studio_id.in_(org_ids),
            Appointment.status.in_(["done", "scheduled"]),
            Appointment.starts_at >= month_start.astimezone(timezone.utc),
        )
    ) or 0

    # Total clients
    client_count = db.scalar(
        select(func.count(Client.id)).where(Client.studio_id.in_(org_ids))
    ) or 0

    # Per-location breakdown
    breakdown = []
    for s in org_studios:
        loc_rev = db.scalar(
            select(func.sum(Payment.amount_cents)).where(
                Payment.studio_id == s.id,
                Payment.status == "paid",
                Payment.type == "payment",
                Payment.paid_at >= month_start.astimezone(timezone.utc),
            )
        ) or 0
        loc_appts = db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.studio_id == s.id,
                Appointment.status.in_(["done", "scheduled"]),
                Appointment.starts_at >= month_start.astimezone(timezone.utc),
            )
        ) or 0
        breakdown.append({
            "studio_id": str(s.id),
            "name": s.location_name or s.name,
            "revenue_ils": loc_rev / 100,
            "appointment_count": loc_appts,
        })

    return {
        "organization_id": str(studio.organization_id),
        "location_count": len(org_studios),
        "total_revenue_ils": revenue / 100,
        "total_appointments": appt_count,
        "total_clients": client_count,
        "locations": sorted(breakdown, key=lambda x: x["revenue_ils"], reverse=True),
    }


# ── Super Admin: link studios into organization ────────────────────────────────

class LinkOrgPayload(BaseModel):
    studio_ids: list[str]
    organization_id: Optional[str] = None  # if None, creates new org
    main_studio_id: Optional[str] = None


@router.post("/admin/link-organization")
def link_organization(
    payload: LinkOrgPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(require_superadmin),
):
    """Super Admin endpoint: link studios into an organization — superadmin only (it was open to anyone, and a
    linked business is one its owner can switch into), within the main business's plan (up to 3 branches)."""
    from app.core.features import has_module
    from app.services.plan_limits import check_branches
    if not payload.studio_ids:
        raise HTTPException(400, "לא נבחרו עסקים")
    org_id = uuid.UUID(payload.organization_id) if payload.organization_id else uuid.uuid4()
    main_id = uuid.UUID(payload.main_studio_id or payload.studio_ids[0])
    if not has_module(db, main_id, "multi_location"):
        raise HTTPException(400, "המסלול של העסק הראשי לא כולל סניפים")
    joining = {uuid.UUID(sid) for sid in payload.studio_ids}
    already = set(db.scalars(select(Studio.id).where(Studio.organization_id == org_id)).all()) if payload.organization_id else set()
    check_branches(db, main_id, len(joining | already))

    for sid in payload.studio_ids:
        studio = db.get(Studio, uuid.UUID(sid))
        if studio:
            studio.organization_id = org_id
            studio.is_main_location = (sid == payload.main_studio_id) if payload.main_studio_id else True

    db.commit()
    return {"organization_id": str(org_id), "linked": len(payload.studio_ids)}
