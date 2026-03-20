from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from datetime import datetime, timezone
import pytz

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.payment import Payment
from app.models.message_job import MessageJob
from app.models.studio_settings import StudioSettings

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
