"""
The platform's own customers — the businesses using BizControl — for the superadmin's CRM (owner, 2026-10-10):
who they are, their plan and where it stands, how active they are, and a retention signal:
- active (green): uses the system;
- at risk (yellow): the free month ends within 7 days, or no one came in for 14 days, or no appointments in 30 days;
- inactive (red): the plan ended, or no one came in for 30 days.
"Came in" = the business's last sign-in renewal (it renews every few minutes of use) or an app seen.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

ACTIVE, AT_RISK, INACTIVE = "active", "at_risk", "inactive"
ENDED = ("expired", "suspended", "canceled")


def signal(status: str | None, ends_at: datetime | None, last_active: datetime | None, appointments_30d: int,
           joined: datetime | None, now: datetime) -> tuple[str, str]:
    """The retention signal and its reason, in the words the superadmin reads."""
    if status in ENDED:
        return INACTIVE, "המנוי הסתיים"
    new = joined is not None and now - joined < timedelta(days=14)
    if last_active is None:
        return (ACTIVE, "עסק חדש") if new else (INACTIVE, "לא נכנס למערכת")
    idle = (now - last_active).days
    if idle >= 30:
        return INACTIVE, f"לא נכנס {idle} ימים"
    if status == "trial" and ends_at is not None:
        left = (ends_at - now).days
        if left <= 7:
            return AT_RISK, "החודש החינמי נגמר היום" if left <= 0 else f"החודש החינמי נגמר בעוד {left} ימים"
    if idle >= 14:
        return AT_RISK, f"לא נכנס {idle} ימים"
    if appointments_30d == 0 and not new:
        return AT_RISK, "לא קבע תורים בחודש האחרון"
    return ACTIVE, "פעיל"


def customers(db: Session) -> list[dict]:
    from app.models.appointment import Appointment
    from app.models.client import Client
    from app.models.device_token import DeviceToken
    from app.models.module import Plan
    from app.models.refresh_token import RefreshToken
    from app.models.studio import Studio
    from app.models.subscription import Subscription
    from app.models.user import User
    from app.services.message_quota import balance

    now = datetime.now(timezone.utc)
    plans = {p.id: p for p in db.scalars(select(Plan)).all()}
    last_login = dict(db.execute(select(RefreshToken.studio_id, func.max(RefreshToken.created_at)).group_by(RefreshToken.studio_id)).all())
    last_app = dict(db.execute(select(DeviceToken.studio_id, func.max(DeviceToken.last_seen_at)).group_by(DeviceToken.studio_id)).all())
    appts = dict(db.execute(select(Appointment.studio_id, func.count()).where(Appointment.created_at >= now - timedelta(days=30))
                            .group_by(Appointment.studio_id)).all())
    clients = dict(db.execute(select(Client.studio_id, func.count()).where(Client.is_active.is_(True)).group_by(Client.studio_id)).all())
    subs = {s.studio_id: s for s in db.scalars(select(Subscription)).all()}

    out = []
    for st in db.scalars(select(Studio).where(Studio.is_platform.is_(False)).order_by(Studio.created_at.desc())).all():
        owner = db.scalar(select(User).where(User.studio_id == st.id, User.role == "owner").order_by(User.is_active.desc()))
        sub = subs.get(st.id)
        plan_id = st.subscription_plan or (sub.plan_id if sub else None)     # the plan the system enforces
        plan = plans.get(plan_id)
        status = sub.status if sub else ("active" if st.is_active else "expired")
        # the free month ends on its own date; anything else on plan_expires_at — the date access is locked on
        # (auth_deps). A business that went from the free month to paying keeps its old trial_ends_at.
        if sub is not None and status == "trial":
            ends_at = sub.trial_ends_at or st.plan_expires_at
        else:
            ends_at = st.plan_expires_at or (sub.current_period_end if sub else None)
        active_times = [t for t in (last_login.get(st.id), last_app.get(st.id)) if t]
        last_active = max(active_times) if active_times else None
        level, reason = signal(status, ends_at, last_active, appts.get(st.id, 0), st.created_at, now)
        out.append({
            "id": str(st.id), "name": st.name, "slug": st.slug, "business_type": st.business_type,
            "joined": st.created_at.isoformat() if st.created_at else None,
            "owner_name": (owner.display_name if owner else None) or "",
            "owner_email": owner.email if owner else None, "owner_phone": owner.phone if owner else None,
            "plan_id": plan_id, "plan_label": plan.display_name if plan else plan_id,
            "monthly_ils": (plan.price_cents // 100) if plan and status not in ENDED and plan_id != "trial" else 0,
            "status": status, "ends_at": ends_at.isoformat() if ends_at else None,
            "days_left": (ends_at - now).days if ends_at else None,
            "cancel_at_period_end": bool(sub and sub.cancel_at_period_end),
            "last_active": last_active.isoformat() if last_active else None,
            "appointments_30d": appts.get(st.id, 0), "clients": clients.get(st.id, 0),
            "whatsapp_month": balance(db, st.id)["used"],
            "signal": level, "signal_reason": reason,
        })
    return out
