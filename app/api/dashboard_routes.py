from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, func, extract, case
from datetime import datetime, timezone, timedelta
import pytz

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.payment import Payment
from app.models.message_job import MessageJob
from app.models.studio_settings import StudioSettings
from app.models.user import User

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("/stats")
def get_dashboard_stats(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    ctx: AuthContext = Depends(require_studio_ctx), 
    db: Session = Depends(get_db)
):
    """Get aggregated statistics for the studio dashboard."""
    # 1. Get Studio Timezone
    settings = db.get(StudioSettings, ctx.studio_id)
    tz_name = settings.timezone if settings and settings.timezone else "Asia/Jerusalem"
    
    tz = pytz.timezone(tz_name)
    now_local = datetime.now(tz)
    
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)

    # 1. Appointments Today (Always for today)
    appointments_today = db.scalar(
        select(func.count(Appointment.id))
        .where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.starts_at >= today_start,
            Appointment.starts_at <= today_end,
            Appointment.status != "canceled"
        )
    ) or 0

    # 2. Total Clients and Club Members
    total_clients = db.scalar(
        select(func.count(Client.id))
        .where(Client.studio_id == ctx.studio_id, Client.is_active == True)
    ) or 0

    total_club_members = db.scalar(
        select(func.count(Client.id))
        .where(Client.studio_id == ctx.studio_id, Client.is_club_member == True, Client.is_active == True)
    ) or 0

    # 3. Revenue from paid payments (Filtered by month/year if provided)
    revenue_query = select(func.sum(Payment.amount_cents)).where(
        Payment.studio_id == ctx.studio_id,
        Payment.status == "paid"
    )
    
    if year and month:
        start_date = datetime(year, month, 1, tzinfo=tz)
        if month == 12:
            end_date = datetime(year + 1, 1, 1, tzinfo=tz)
        else:
            end_date = datetime(year, month + 1, 1, tzinfo=tz)
        revenue_query = revenue_query.where(Payment.created_at >= start_date, Payment.created_at < end_date)
    elif year:
        start_date = datetime(year, 1, 1, tzinfo=tz)
        end_date = datetime(year + 1, 1, 1, tzinfo=tz)
        revenue_query = revenue_query.where(Payment.created_at >= start_date, Payment.created_at < end_date)

    total_revenue_cents = db.scalar(revenue_query) or 0

    # 4. Pending Automations / Messages
    pending_messages = db.scalar(
        select(func.count(MessageJob.id))
        .where(
            MessageJob.studio_id == ctx.studio_id,
            MessageJob.status == "pending"
        )
    ) or 0

    # 5. Pending Payment Verifications
    pending_payment_verifications = db.scalar(
        select(func.count(Appointment.id))
        .where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.payment_sent_at.is_not(None),
            Appointment.payment_verified_at.is_(None)
        )
    ) or 0

    # 6. Professional Financials (Advanced) - Now uses filtered revenue
    if settings:
        vat_rate = float(settings.vat_percent or 17.0) / 100
        income_tax_rate = float(settings.income_tax_percent or 10.0) / 100
        social_rate = float(settings.social_security_percent or 5.0) / 100
    else:
        vat_rate = 0.17
        income_tax_rate = 0.10
        social_rate = 0.05

    # Gross is the filtered total_revenue_cents
    gross = total_revenue_cents
    vat_amount = int(gross * (vat_rate / (1 + vat_rate))) # VAT is included in gross
    gross_excl_vat = gross - vat_amount
    
    income_tax_amount = int(gross_excl_vat * income_tax_rate)
    social_security_amount = int(gross_excl_vat * social_rate)
    
    net_income = gross_excl_vat - income_tax_amount - social_security_amount

    return {
        "appointments_today": appointments_today,
        "total_clients": total_clients,
        "total_club_members": total_club_members,
        "total_revenue_cents": total_revenue_cents,
        "pending_messages": pending_messages,
        "pending_payment_verifications": pending_payment_verifications,
        "financials": {
            "vat_amount_cents": vat_amount,
            "income_tax_cents": income_tax_amount,
            "social_security_cents": social_security_amount,
            "net_income_cents": net_income,
            "gross_income_cents": gross,
            "vat_rate": vat_rate * 100 # Include the actual rate used
        }
    }

@router.get("/daily-payments")
def get_daily_payments(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Get list of today's appointments with payment status for the financial dashboard."""
    # 1. Get Studio Timezone
    settings = db.get(StudioSettings, ctx.studio_id)
    tz_name = settings.timezone if settings and settings.timezone else "Asia/Jerusalem"
    
    tz = pytz.timezone(tz_name)
    now_local = datetime.now(tz)
    
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)

    stmt = (
        select(Appointment, Client)
        .join(Client, Client.id == Appointment.client_id)
        .where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.starts_at >= today_start,
            Appointment.starts_at <= today_end,
            Appointment.status != "canceled"
        )
        .order_by(Appointment.starts_at.asc())
    )
    
    results = db.execute(stmt).all()
    
    data = []
    for appt, client in results:
        # Calculate paid amount for this appointment
        paid_cents = db.scalar(
            select(func.sum(Payment.amount_cents))
            .where(
                Payment.appointment_id == appt.id,
                Payment.status == "paid",
                Payment.type != "refund"
            )
        ) or 0
        
        refund_cents = db.scalar(
            select(func.sum(Payment.amount_cents))
            .where(
                Payment.appointment_id == appt.id,
                Payment.status == "paid",
                Payment.type == "refund"
            )
        ) or 0
        
        net_paid = paid_cents - refund_cents
        remaining = max(0, appt.total_price_cents - net_paid)
        
        data.append({
            "appointment_id": appt.id,
            "client_id": client.id,
            "client_name": client.full_name,
            "client_phone": client.phone,
            "client_loyalty_points": client.loyalty_points or 0,
            "starts_at": appt.starts_at,
            "total_price_cents": appt.total_price_cents,
            "deposit_amount_cents": appt.deposit_amount_cents,
            "paid_cents": net_paid,
            "remaining_cents": remaining,
            "status": appt.status,
            "payment_sent_at": appt.payment_sent_at,
            "payment_verified_at": appt.payment_verified_at
        })

    return data


@router.get("/analytics")
def get_analytics(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Deep analytics: revenue/appointments by month, artist performance, busiest days."""
    settings = db.get(StudioSettings, ctx.studio_id)
    tz_name = settings.timezone if settings and settings.timezone else "Asia/Jerusalem"
    tz = pytz.timezone(tz_name)
    now = datetime.now(tz)

    # ── Revenue & appointments by month (last 6 months) ──────────────────────
    revenue_by_month = []
    appts_by_month = []
    for i in range(5, -1, -1):
        month = now.month - i
        year = now.year
        while month <= 0:
            month += 12
            year -= 1
        month_start = tz.localize(datetime(year, month, 1))
        if month == 12:
            month_end = tz.localize(datetime(year + 1, 1, 1))
        else:
            month_end = tz.localize(datetime(year, month + 1, 1))

        label = month_start.strftime("%m/%y")

        rev = db.scalar(
            select(func.sum(Payment.amount_cents)).where(
                Payment.studio_id == ctx.studio_id,
                Payment.status == "paid",
                Payment.type != "refund",
                Payment.created_at >= month_start,
                Payment.created_at < month_end,
            )
        ) or 0
        revenue_by_month.append({"month": label, "revenue": round(rev / 100)})

        cnt = db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.studio_id == ctx.studio_id,
                Appointment.status != "canceled",
                Appointment.starts_at >= month_start,
                Appointment.starts_at < month_end,
            )
        ) or 0
        appts_by_month.append({"month": label, "count": cnt})

    # ── Artist performance (all time) ─────────────────────────────────────────
    artists_raw = db.scalars(
        select(User).where(
            User.studio_id == ctx.studio_id,
            User.is_active == True,  # noqa: E712
            User.role.in_(["owner", "admin", "artist"]),
        )
    ).all()

    artists = []
    for artist in artists_raw:
        appt_count = db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.studio_id == ctx.studio_id,
                Appointment.artist_id == artist.id,
                Appointment.status != "canceled",
            )
        ) or 0
        rev_cents = db.scalar(
            select(func.sum(Payment.amount_cents)).where(
                Payment.studio_id == ctx.studio_id,
                Payment.status == "paid",
                Payment.type != "refund",
                Payment.appointment_id.in_(
                    select(Appointment.id).where(
                        Appointment.artist_id == artist.id,
                        Appointment.studio_id == ctx.studio_id,
                    )
                ),
            )
        ) or 0
        artists.append({
            "name": artist.display_name or artist.email,
            "appointments": appt_count,
            "revenue": round(rev_cents / 100),
        })
    artists.sort(key=lambda a: a["revenue"], reverse=True)

    # ── Busiest days of week (last 90 days) ───────────────────────────────────
    since = now - timedelta(days=90)
    day_rows = db.execute(
        select(
            extract("dow", Appointment.starts_at).label("dow"),
            func.count(Appointment.id).label("cnt"),
        ).where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.status != "canceled",
            Appointment.starts_at >= since,
        ).group_by("dow")
    ).all()

    day_names = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
    day_map = {int(r.dow): r.cnt for r in day_rows}
    busiest_days = [{"day": day_names[d], "count": day_map.get(d, 0)} for d in range(7)]

    # ── New vs returning clients (last 30 days) ───────────────────────────────
    thirty_ago = now - timedelta(days=30)
    new_clients = db.scalar(
        select(func.count(Client.id)).where(
            Client.studio_id == ctx.studio_id,
            Client.created_at >= thirty_ago,
        )
    ) or 0
    total_clients = db.scalar(
        select(func.count(Client.id)).where(Client.studio_id == ctx.studio_id)
    ) or 0
    returning = max(0, total_clients - new_clients)

    return {
        "revenue_by_month": revenue_by_month,
        "appts_by_month": appts_by_month,
        "artists": artists,
        "busiest_days": busiest_days,
        "new_vs_returning": {"new": new_clients, "returning": returning},
    }
