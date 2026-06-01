"""
Advanced Business Analytics — Phase 5.
Revenue trends, retention, heatmap, LTV, per-service/artist breakdown.
"""
from __future__ import annotations
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_, extract, distinct
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db

from app.core.features import require_module
router = APIRouter(prefix="/biz-analytics", tags=["BusinessAnalytics"], dependencies=[Depends(require_module("analytics"))])


def _month_range(year: int, month: int):
    from calendar import monthrange
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    return start, end


# ── Revenue trend (last 12 months) ───────────────────────────────────────────

@router.get("/revenue-trend")
def revenue_trend(
    months: int = Query(12, ge=3, le=24),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from app.models.payment import Payment
    now = datetime.now(timezone.utc)
    result = []
    for i in range(months - 1, -1, -1):
        dt = (now.replace(day=1) - timedelta(days=i * 28)).replace(day=1)
        y, m = dt.year, dt.month
        from calendar import monthrange
        month_start = datetime(y, m, 1, tzinfo=timezone.utc)
        month_end = datetime(y, m, monthrange(y, m)[1], 23, 59, 59, tzinfo=timezone.utc)

        revenue = db.scalar(
            select(func.sum(Payment.amount_cents)).where(
                Payment.studio_id == ctx.studio_id,
                Payment.status == "paid",
                Payment.type == "payment",
                Payment.paid_at >= month_start,
                Payment.paid_at <= month_end,
            )
        ) or 0

        deposits = db.scalar(
            select(func.sum(Payment.amount_cents)).where(
                Payment.studio_id == ctx.studio_id,
                Payment.status == "paid",
                Payment.type == "deposit",
                Payment.paid_at >= month_start,
                Payment.paid_at <= month_end,
            )
        ) or 0

        from app.models.appointment import Appointment
        appt_count = db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.studio_id == ctx.studio_id,
                Appointment.status.in_(["done", "scheduled"]),
                Appointment.starts_at >= month_start,
                Appointment.starts_at <= month_end,
            )
        ) or 0

        HE_MONTHS = ["ינ׳","פב׳","מר׳","אפ׳","מא׳","יו׳","יל׳","אג׳","ספ׳","אק׳","נו׳","דצ׳"]
        result.append({
            "year": y, "month": m,
            "label": f"{HE_MONTHS[m-1]} {y}",
            "revenue_ils": revenue / 100,
            "deposits_ils": deposits / 100,
            "total_ils": (revenue + deposits) / 100,
            "appointment_count": appt_count,
        })
    return result


# ── Revenue per service ────────────────────────────────────────────────────────

@router.get("/revenue-by-service")
def revenue_by_service(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from app.models.payment import Payment
    from app.models.appointment import Appointment
    from app.models.service import Service
    from calendar import monthrange

    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    month_end = datetime(year, month, monthrange(year, month)[1], 23, 59, 59, tzinfo=timezone.utc)

    rows = db.execute(
        select(
            Service.name,
            Service.color,
            func.count(Appointment.id).label("count"),
            func.sum(Payment.amount_cents).label("revenue"),
        )
        .join(Appointment, Appointment.service_id == Service.id)
        .join(Payment, and_(
            Payment.appointment_id == Appointment.id,
            Payment.status == "paid",
            Payment.type == "payment",
        ))
        .where(
            Service.studio_id == ctx.studio_id,
            Appointment.starts_at >= month_start,
            Appointment.starts_at <= month_end,
        )
        .group_by(Service.id, Service.name, Service.color)
        .order_by(func.sum(Payment.amount_cents).desc())
    ).all()

    # Also count appointments with no service
    no_service = db.scalar(
        select(func.count(Appointment.id)).where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.service_id == None,  # noqa
            Appointment.starts_at >= month_start,
            Appointment.starts_at <= month_end,
        )
    ) or 0

    result = [
        {"name": r.name, "color": r.color, "count": r.count, "revenue_ils": (r.revenue or 0) / 100}
        for r in rows
    ]
    if no_service > 0:
        result.append({"name": "ללא שירות מוגדר", "color": "#64748b", "count": no_service, "revenue_ils": 0})
    return result


# ── Revenue per artist ─────────────────────────────────────────────────────────

@router.get("/revenue-by-artist")
def revenue_by_artist(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from app.models.payment import Payment
    from app.models.appointment import Appointment
    from app.models.user import User
    from calendar import monthrange

    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    month_end = datetime(year, month, monthrange(year, month)[1], 23, 59, 59, tzinfo=timezone.utc)

    rows = db.execute(
        select(
            User.display_name,
            User.calendar_color,
            func.count(Appointment.id).label("count"),
            func.sum(Payment.amount_cents).label("revenue"),
        )
        .join(Appointment, Appointment.artist_id == User.id)
        .outerjoin(Payment, and_(
            Payment.appointment_id == Appointment.id,
            Payment.status == "paid",
            Payment.type == "payment",
        ))
        .where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.starts_at >= month_start,
            Appointment.starts_at <= month_end,
            Appointment.status.in_(["done", "scheduled"]),
        )
        .group_by(User.id, User.display_name, User.calendar_color)
        .order_by(func.count(Appointment.id).desc())
    ).all()

    return [
        {
            "name": r.display_name or "ללא שם",
            "color": r.calendar_color or "#7c3aed",
            "count": r.count,
            "revenue_ils": (r.revenue or 0) / 100,
        }
        for r in rows
    ]


# ── Hourly heatmap ────────────────────────────────────────────────────────────

@router.get("/heatmap")
def hourly_heatmap(
    months: int = Query(3, ge=1, le=12),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Returns count of appointments per day-of-week × hour matrix."""
    from app.models.appointment import Appointment
    import pytz

    since = datetime.now(timezone.utc) - timedelta(days=months * 30)

    appts = db.scalars(
        select(Appointment).where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.starts_at >= since,
            Appointment.status.in_(["done", "scheduled"]),
        )
    ).all()

    # Build 7×24 matrix
    matrix = [[0] * 24 for _ in range(7)]
    tz = pytz.timezone("Asia/Jerusalem")
    for a in appts:
        local = a.starts_at.astimezone(tz)
        dow = local.weekday()   # 0=Mon … 6=Sun
        hour = local.hour
        matrix[dow][hour] += 1

    days = ["שני","שלישי","רביעי","חמישי","שישי","שבת","ראשון"]
    return {
        "matrix": matrix,
        "days": days,
        "hours": list(range(24)),
        "max_val": max(max(row) for row in matrix) or 1,
    }


# ── Retention analysis ────────────────────────────────────────────────────────

@router.get("/retention")
def retention_analysis(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """New vs returning clients for the month."""
    from app.models.appointment import Appointment
    from app.models.client import Client
    from calendar import monthrange

    month_start = datetime(year, month, 1, tzinfo=timezone.utc)
    month_end = datetime(year, month, monthrange(year, month)[1], 23, 59, 59, tzinfo=timezone.utc)

    # Clients with an appointment this month
    this_month_clients = set(db.scalars(
        select(distinct(Appointment.client_id)).where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.status.in_(["done", "scheduled"]),
            Appointment.starts_at >= month_start,
            Appointment.starts_at <= month_end,
            Appointment.client_id != None,  # noqa
        )
    ).all())

    # Of those, who had an appointment BEFORE this month (returning)
    returning = set()
    for cid in this_month_clients:
        prev = db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.studio_id == ctx.studio_id,
                Appointment.client_id == cid,
                Appointment.starts_at < month_start,
                Appointment.status.in_(["done", "scheduled"]),
            )
        ) or 0
        if prev > 0:
            returning.add(cid)

    new_clients = this_month_clients - returning
    total = len(this_month_clients)

    return {
        "total": total,
        "new": len(new_clients),
        "returning": len(returning),
        "retention_rate": round(len(returning) / total * 100, 1) if total else 0,
    }


# ── Client LTV (top clients) ──────────────────────────────────────────────────

@router.get("/top-clients")
def top_clients(
    limit: int = Query(10, le=50),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from app.models.payment import Payment
    from app.models.client import Client

    rows = db.execute(
        select(
            Client.id,
            Client.full_name,
            Client.phone,
            func.count(Payment.id).label("payment_count"),
            func.sum(Payment.amount_cents).label("total_revenue"),
        )
        .join(Payment, Payment.client_id == Client.id)
        .where(
            Client.studio_id == ctx.studio_id,
            Payment.studio_id == ctx.studio_id,
            Payment.status == "paid",
        )
        .group_by(Client.id, Client.full_name, Client.phone)
        .order_by(func.sum(Payment.amount_cents).desc())
        .limit(limit)
    ).all()

    return [
        {
            "id": str(r.id),
            "name": r.full_name or "לא ידוע",
            "phone": r.phone,
            "payment_count": r.payment_count,
            "ltv_ils": (r.total_revenue or 0) / 100,
        }
        for r in rows
    ]
