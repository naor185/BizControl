from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, func, extract, case, or_
from datetime import datetime, timezone, timedelta
import pytz

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.client_points_ledger import ClientPointsLedger
from app.models.payment import Payment
from app.models.pos_transaction import PosTransaction
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

    # 3. Revenue from paid payments + POS transactions (filtered by month/year if provided)
    revenue_query = select(func.sum(Payment.amount_cents)).where(
        Payment.studio_id == ctx.studio_id,
        Payment.status == "paid",
        or_(Payment.notes == None, ~Payment.notes.ilike("[מערכת]%")),
    )
    pos_revenue_query = select(func.sum(PosTransaction.total_cents)).where(
        PosTransaction.studio_id == ctx.studio_id,
        PosTransaction.status == "paid",
    )

    if year and month:
        start_date = datetime(year, month, 1, tzinfo=tz)
        end_date = datetime(year + 1, 1, 1, tzinfo=tz) if month == 12 else datetime(year, month + 1, 1, tzinfo=tz)
        revenue_query = revenue_query.where(Payment.created_at >= start_date, Payment.created_at < end_date)
        pos_revenue_query = pos_revenue_query.where(PosTransaction.created_at >= start_date, PosTransaction.created_at < end_date)
    elif year:
        start_date = datetime(year, 1, 1, tzinfo=tz)
        end_date = datetime(year + 1, 1, 1, tzinfo=tz)
        revenue_query = revenue_query.where(Payment.created_at >= start_date, Payment.created_at < end_date)
        pos_revenue_query = pos_revenue_query.where(PosTransaction.created_at >= start_date, PosTransaction.created_at < end_date)

    total_revenue_cents = (db.scalar(revenue_query) or 0) + (db.scalar(pos_revenue_query) or 0)

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

@router.get("/today-revenue")
def get_today_revenue(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Return breakdown of money actually received today: appointment payments + POS cash."""
    settings = db.get(StudioSettings, ctx.studio_id)
    tz_name = settings.timezone if settings and settings.timezone else "Asia/Jerusalem"
    tz = pytz.timezone(tz_name)
    now_local = datetime.now(tz)
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end   = now_local.replace(hour=23, minute=59, second=59, microsecond=999999)

    # Payments linked to appointments created today
    appt_cents = db.scalar(
        select(func.sum(Payment.amount_cents)).where(
            Payment.studio_id == ctx.studio_id,
            Payment.status == "paid",
            Payment.type != "refund",
            or_(Payment.notes == None, ~Payment.notes.ilike("[מערכת]%")),
            Payment.created_at >= today_start,
            Payment.created_at <= today_end,
        )
    ) or 0

    # Refunds today (deduct)
    refund_cents = db.scalar(
        select(func.sum(Payment.amount_cents)).where(
            Payment.studio_id == ctx.studio_id,
            Payment.status == "paid",
            Payment.type == "refund",
            Payment.created_at >= today_start,
            Payment.created_at <= today_end,
        )
    ) or 0

    # POS transactions today
    pos_cents = db.scalar(
        select(func.sum(PosTransaction.total_cents)).where(
            PosTransaction.studio_id == ctx.studio_id,
            PosTransaction.status == "paid",
            PosTransaction.created_at >= today_start,
            PosTransaction.created_at <= today_end,
        )
    ) or 0

    net_appt = max(0, appt_cents - refund_cents)
    total    = net_appt + pos_cents

    # מקדמות שאושרו היום לתורים עתידיים
    from app.models.client import Client as _Client
    future_deposits_rows = db.execute(
        select(Appointment, _Client, Payment)
        .join(_Client, _Client.id == Appointment.client_id)
        .join(Payment, Payment.appointment_id == Appointment.id)
        .where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.status != "canceled",
            Appointment.starts_at > today_end,
            Payment.status == "paid",
            Payment.type != "refund",
            Payment.created_at >= today_start,
            Payment.created_at <= today_end,
        )
    ).all()

    deposits_today = [
        {
            "client_name": client.full_name,
            "amount_cents": payment.amount_cents,
            "appointment_date": appt.starts_at.date().isoformat(),
        }
        for appt, client, payment in future_deposits_rows
    ]

    return {
        "appointment_payments_cents": net_appt,
        "pos_revenue_cents": pos_cents,
        "total_today_cents": total,
        "deposits_today": deposits_today,
        "date": today_start.date().isoformat(),
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
        remaining = max(0, (appt.total_price_cents or 0) - net_paid)
        
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


@router.get("/pending-payments")
def get_pending_payments(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """All appointments where client reported payment but studio hasn't verified yet."""
    stmt = (
        select(Appointment, Client)
        .join(Client, Client.id == Appointment.client_id)
        .where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.payment_sent_at.is_not(None),
            Appointment.payment_verified_at.is_(None),
            Appointment.status != "canceled",
        )
        .order_by(Appointment.payment_sent_at.desc())
    )
    results = db.execute(stmt).all()

    data = []
    for appt, client in results:
        paid_cents = db.scalar(
            select(func.sum(Payment.amount_cents)).where(
                Payment.appointment_id == appt.id,
                Payment.status == "paid",
                Payment.type != "refund",
            )
        ) or 0
        data.append({
            "appointment_id": str(appt.id),
            "client_id": str(client.id),
            "client_name": client.full_name,
            "client_phone": client.phone or "",
            "starts_at": appt.starts_at.isoformat(),
            "total_price_cents": appt.total_price_cents,
            "paid_cents": paid_cents,
            "remaining_cents": max(0, (appt.total_price_cents or 0) - paid_cents),
            "payment_sent_at": appt.payment_sent_at.isoformat() if appt.payment_sent_at else None,
        })
    return data


@router.get("/pending-gift-cards")
def get_pending_gift_cards(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Gift-card orders from the public purchase page awaiting staff confirmation of payment."""
    from sqlalchemy import text
    rows = db.execute(
        text("""
            SELECT id, code, amount_cents, bonus_cents, recipient_name,
                   buyer_name, buyer_phone, created_at
            FROM gift_cards
            WHERE studio_id = :sid AND status = 'pending_payment'
            ORDER BY created_at DESC
        """),
        {"sid": str(ctx.studio_id)}
    ).fetchall()
    return [
        {
            "id": str(r[0]),
            "code": r[1],
            "amount_ils": round(r[2] / 100, 2),
            "bonus_ils": round((r[3] or 0) / 100, 2),
            "recipient_name": r[4],
            "buyer_name": r[5],
            "buyer_phone": r[6],
            "created_at": r[7].isoformat() if r[7] else None,
        }
        for r in rows
    ]


@router.get("/pending-visits")
def get_pending_visits(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Appointments that already passed but are still 'scheduled' — studio needs to confirm the visit happened."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=7)

    stmt = (
        select(Appointment, Client)
        .join(Client, Client.id == Appointment.client_id)
        .where(
            Appointment.studio_id == ctx.studio_id,
            Appointment.status == "scheduled",
            Appointment.starts_at < now,
            Appointment.starts_at >= cutoff,
        )
        .order_by(Appointment.starts_at.desc())
    )
    rows = db.execute(stmt).all()

    return [
        {
            "appointment_id": str(appt.id),
            "client_id": str(client.id),
            "client_name": client.full_name,
            "client_phone": client.phone or "",
            "title": appt.title,
            "starts_at": appt.starts_at.isoformat(),
        }
        for appt, client in rows
    ]


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
                or_(Payment.notes == None, ~Payment.notes.ilike("[מערכת]%")),
            )
        ) or 0
        pos_rev = db.scalar(
            select(func.sum(PosTransaction.total_cents)).where(
                PosTransaction.studio_id == ctx.studio_id,
                PosTransaction.status == "paid",
                PosTransaction.created_at >= month_start,
                PosTransaction.created_at < month_end,
            )
        ) or 0
        revenue_by_month.append({"month": label, "revenue": round((rev + pos_rev) / 100)})

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
                or_(Payment.notes == None, ~Payment.notes.ilike("[מערכת]%")),
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


@router.get("/loyalty-stats")
def get_loyalty_stats(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """סטטיסטיקות מועדון נאמנות: נקודות שהוענקו, מומשו, ויתרה כוללת."""
    # נקודות שהוענקו (כל ה-delta_points החיוביים)
    total_awarded = db.scalar(
        select(func.coalesce(func.sum(ClientPointsLedger.delta_points), 0)).where(
            ClientPointsLedger.studio_id == ctx.studio_id,
            ClientPointsLedger.delta_points > 0,
        )
    ) or 0

    # נקודות שמומשו (delta_points שליליים עם reason שמכיל "redeemed")
    total_redeemed = db.scalar(
        select(func.coalesce(func.sum(ClientPointsLedger.delta_points), 0)).where(
            ClientPointsLedger.studio_id == ctx.studio_id,
            ClientPointsLedger.delta_points < 0,
            ClientPointsLedger.reason.ilike("%redeemed%"),
        )
    ) or 0
    total_redeemed = abs(total_redeemed)

    # יתרה כוללת של כל הלקוחות
    total_outstanding = db.scalar(
        select(func.coalesce(func.sum(Client.loyalty_points), 0)).where(
            Client.studio_id == ctx.studio_id,
            Client.is_active == True,
        )
    ) or 0

    # מספר לקוחות עם נקודות
    clients_with_points = db.scalar(
        select(func.count(Client.id)).where(
            Client.studio_id == ctx.studio_id,
            Client.loyalty_points > 0,
            Client.is_active == True,
        )
    ) or 0

    return {
        "total_points_awarded": int(total_awarded),
        "total_points_redeemed": int(total_redeemed),
        "total_points_redeemed_ils": int(total_redeemed),  # 1 נקודה = 1 ש"ח
        "total_outstanding_points": int(total_outstanding),
        "total_outstanding_ils": int(total_outstanding),
        "clients_with_points": int(clients_with_points),
    }


@router.get("/consultation-conversion")
def consultation_conversion(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """אחוזי המרה: לקוחות שביצעו פגישת יעוץ ולאחר מכן קבעו תור אמיתי."""
    from app.models.service import Service

    # כל תורי היעוץ — לפי כותרת המכילה 'יעוץ' או שם שירות המכיל 'יעוץ'
    consult_service_ids = db.scalars(
        select(Service.id).where(
            Service.studio_id == ctx.studio_id,
            Service.name.ilike("%יעוץ%"),
        )
    ).all()

    consult_filter = or_(
        Appointment.title.ilike("%יעוץ%"),
        Appointment.service_id.in_(consult_service_ids) if consult_service_ids else False,
    )

    # קבוצת לקוחות ייחודיים + תאריך יעוץ ראשון לכל אחד
    consult_rows = db.execute(
        select(Appointment.client_id, func.min(Appointment.starts_at).label("first_consult"))
        .where(
            Appointment.studio_id == ctx.studio_id,
            consult_filter,
            Appointment.status != "canceled",
        )
        .group_by(Appointment.client_id)
    ).all()

    total = len(consult_rows)
    converted = 0

    for row in consult_rows:
        follow_up = db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.studio_id == ctx.studio_id,
                Appointment.client_id == row.client_id,
                ~consult_filter,
                Appointment.starts_at > row.first_consult,
                Appointment.status != "canceled",
            )
        ) or 0
        if follow_up > 0:
            converted += 1

    rate = round(converted / total * 100) if total > 0 else 0

    return {
        "total_consultations": total,
        "converted": converted,
        "not_converted": total - converted,
        "conversion_rate": rate,
    }


# ── Advanced Business Analytics ───────────────────────────────────────────────

@router.get("/advanced")
def advanced_analytics(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """
    Comprehensive business analytics:
    KPIs, retention trend, hourly heatmap, revenue by service, top clients, avg value trend.
    """
    from sqlalchemy import text as _t
    sid = str(ctx.studio_id)

    settings = db.get(StudioSettings, ctx.studio_id)
    tz_name = settings.timezone if settings and settings.timezone else "Asia/Jerusalem"
    tz = pytz.timezone(tz_name)
    now = datetime.now(tz)

    # ── KPIs ──────────────────────────────────────────────────────────────────

    # This month boundaries
    mo_start = tz.localize(datetime(now.year, now.month, 1))
    if now.month == 12:
        mo_end = tz.localize(datetime(now.year + 1, 1, 1))
    else:
        mo_end = tz.localize(datetime(now.year, now.month + 1, 1))

    prev_mo_start = (mo_start - timedelta(days=1)).replace(day=1).replace(hour=0, minute=0, second=0, microsecond=0)
    prev_mo_start = tz.localize(datetime(prev_mo_start.year, prev_mo_start.month, 1))

    def _rev(start, end):
        pay = db.scalar(
            select(func.sum(Payment.amount_cents)).where(
                Payment.studio_id == ctx.studio_id, Payment.status == "paid",
                Payment.type != "refund", Payment.created_at >= start, Payment.created_at < end,
                or_(Payment.notes == None, ~Payment.notes.ilike("[מערכת]%")),
            )
        ) or 0
        pos = db.scalar(
            select(func.sum(PosTransaction.total_cents)).where(
                PosTransaction.studio_id == ctx.studio_id, PosTransaction.status == "paid",
                PosTransaction.created_at >= start, PosTransaction.created_at < end,
            )
        ) or 0
        return pay + pos

    rev_this = _rev(mo_start, mo_end)
    rev_prev = _rev(prev_mo_start, mo_start)
    rev_growth = round((rev_this - rev_prev) / rev_prev * 100) if rev_prev > 0 else 0

    appts_this = db.scalar(
        select(func.count(Appointment.id)).where(
            Appointment.studio_id == ctx.studio_id, Appointment.status != "canceled",
            Appointment.starts_at >= mo_start, Appointment.starts_at < mo_end,
        )
    ) or 0
    appts_prev = db.scalar(
        select(func.count(Appointment.id)).where(
            Appointment.studio_id == ctx.studio_id, Appointment.status != "canceled",
            Appointment.starts_at >= prev_mo_start, Appointment.starts_at < mo_start,
        )
    ) or 0
    appts_growth = round((appts_this - appts_prev) / appts_prev * 100) if appts_prev > 0 else 0

    # LTV: avg total paid per active client
    ltv_row = db.execute(_t("""
        SELECT AVG(client_total) FROM (
            SELECT client_id, SUM(amount_cents) AS client_total
            FROM payments
            WHERE studio_id = :sid AND status = 'paid' AND type != 'refund'
            GROUP BY client_id
        ) sub
    """), {"sid": sid}).scalar() or 0

    # Retention: % clients with ≥2 appointments in last 3 months
    three_mo_ago = now - timedelta(days=90)
    retention_row = db.execute(_t("""
        SELECT
            COUNT(*) FILTER (WHERE appt_count >= 2) AS retained,
            COUNT(*) AS total_active
        FROM (
            SELECT client_id, COUNT(*) AS appt_count
            FROM appointments
            WHERE studio_id = :sid AND status != 'canceled'
              AND starts_at >= :since
            GROUP BY client_id
        ) sub
    """), {"sid": sid, "since": three_mo_ago}).fetchone()
    retained = retention_row[0] or 0
    total_active = retention_row[1] or 0
    retention_rate = round(retained / total_active * 100) if total_active > 0 else 0

    # Churn: clients with last appointment > 60 days ago
    sixty_ago = now - timedelta(days=60)
    churn_count = db.execute(_t("""
        SELECT COUNT(*) FROM (
            SELECT client_id, MAX(starts_at) AS last_appt
            FROM appointments
            WHERE studio_id = :sid AND status NOT IN ('canceled','no_show')
            GROUP BY client_id
            HAVING MAX(starts_at) < :cutoff
        ) sub
    """), {"sid": sid, "cutoff": sixty_ago}).scalar() or 0

    # Avg appt value last 30 days
    thirty_ago = now - timedelta(days=30)
    avg_value_row = db.execute(_t("""
        SELECT COALESCE(AVG(amount_cents), 0)
        FROM payments
        WHERE studio_id = :sid AND status = 'paid' AND type != 'refund'
          AND created_at >= :since
          AND (notes IS NULL OR notes NOT ILIKE '[מערכת]%%')
    """), {"sid": sid, "since": thirty_ago}).scalar() or 0

    # ── Retention trend (last 6 months) ───────────────────────────────────────
    retention_trend = []
    for i in range(5, -1, -1):
        m = now.month - i
        y = now.year
        while m <= 0:
            m += 12; y -= 1
        ms = tz.localize(datetime(y, m, 1))
        me = tz.localize(datetime(y, m + 1, 1)) if m < 12 else tz.localize(datetime(y + 1, 1, 1))
        label = ms.strftime("%m/%y")

        rows = db.execute(_t("""
            SELECT
                COUNT(DISTINCT client_id) FILTER (WHERE is_new) AS new_c,
                COUNT(DISTINCT client_id) FILTER (WHERE NOT is_new) AS ret_c
            FROM (
                SELECT
                    a.client_id,
                    (SELECT MIN(starts_at) FROM appointments a2
                     WHERE a2.client_id = a.client_id AND a2.studio_id = :sid
                       AND a2.status != 'canceled') >= :ms AS is_new
                FROM appointments a
                WHERE a.studio_id = :sid AND a.status != 'canceled'
                  AND a.starts_at >= :ms AND a.starts_at < :me
            ) sub
        """), {"sid": sid, "ms": ms, "me": me}).fetchone()

        new_c = rows[0] or 0
        ret_c = rows[1] or 0
        total = new_c + ret_c
        retention_trend.append({
            "month": label,
            "new": new_c,
            "returning": ret_c,
            "total": total,
            "retention_pct": round(ret_c / total * 100) if total > 0 else 0,
        })

    # ── Hourly heatmap (last 90 days) ─────────────────────────────────────────
    hour_rows = db.execute(_t("""
        SELECT
            EXTRACT(DOW FROM starts_at AT TIME ZONE 'Asia/Jerusalem')::int AS dow,
            EXTRACT(HOUR FROM starts_at AT TIME ZONE 'Asia/Jerusalem')::int AS hour,
            COUNT(*) AS cnt
        FROM appointments
        WHERE studio_id = :sid AND status != 'canceled'
          AND starts_at >= :since
        GROUP BY dow, hour
        ORDER BY dow, hour
    """), {"sid": sid, "since": three_mo_ago}).fetchall()

    day_names = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
    heatmap: dict = {}
    for r in hour_rows:
        key = f"{r[0]}-{r[1]}"
        heatmap[key] = {"dow": r[0], "hour": r[1], "count": r[2],
                        "day_label": day_names[r[0]]}

    # Also aggregate by hour only (simpler chart)
    hourly = {}
    for r in hour_rows:
        h = r[1]
        hourly[h] = hourly.get(h, 0) + r[2]
    hourly_list = [{"hour": h, "label": f"{h:02d}:00", "count": hourly.get(h, 0)} for h in range(8, 23)]

    # ── Revenue by service (top 10, last 90 days) ─────────────────────────────
    svc_rows = db.execute(_t("""
        SELECT a.title,
               COUNT(*) AS cnt,
               COALESCE(SUM(p.amount_cents), 0) AS rev
        FROM appointments a
        LEFT JOIN payments p ON p.appointment_id = a.id AND p.status='paid' AND p.type!='refund'
        WHERE a.studio_id = :sid AND a.status != 'canceled'
          AND a.starts_at >= :since
        GROUP BY a.title
        ORDER BY rev DESC
        LIMIT 10
    """), {"sid": sid, "since": three_mo_ago}).fetchall()

    # ── Top clients by revenue (all time) ─────────────────────────────────────
    top_clients = db.execute(_t("""
        SELECT c.full_name, COUNT(DISTINCT a.id) AS appts,
               COALESCE(SUM(p.amount_cents), 0) AS rev
        FROM clients c
        LEFT JOIN appointments a ON a.client_id = c.id AND a.status != 'canceled'
        LEFT JOIN payments p ON p.client_id = c.id AND p.status='paid' AND p.type!='refund'
        WHERE c.studio_id = :sid AND c.is_active = true
        GROUP BY c.id, c.full_name
        ORDER BY rev DESC
        LIMIT 10
    """), {"sid": sid}).fetchall()

    # ── Avg appointment value trend (6 months) ────────────────────────────────
    avg_trend = []
    for i in range(5, -1, -1):
        m = now.month - i; y = now.year
        while m <= 0: m += 12; y -= 1
        ms = tz.localize(datetime(y, m, 1))
        me = tz.localize(datetime(y, m + 1, 1)) if m < 12 else tz.localize(datetime(y + 1, 1, 1))
        avg = db.execute(_t("""
            SELECT COALESCE(AVG(amount_cents), 0) FROM payments
            WHERE studio_id = :sid AND status='paid' AND type!='refund'
              AND created_at >= :ms AND created_at < :me
              AND (notes IS NULL OR notes NOT ILIKE '[מערכת]%%')
        """), {"sid": sid, "ms": ms, "me": me}).scalar() or 0
        avg_trend.append({"month": ms.strftime("%m/%y"), "avg_ils": round(avg / 100)})

    return {
        "kpis": {
            "revenue_this_month_ils": round(rev_this / 100),
            "revenue_growth_pct": rev_growth,
            "appts_this_month": appts_this,
            "appts_growth_pct": appts_growth,
            "retention_rate_pct": retention_rate,
            "ltv_ils": round(ltv_row / 100),
            "avg_appt_value_ils": round(avg_value_row / 100),
            "churn_count": int(churn_count),
        },
        "retention_trend": retention_trend,
        "hourly_heatmap": hourly_list,
        "heatmap_grid": list(heatmap.values()),
        "revenue_by_service": [
            {"service": r[0], "count": r[1], "revenue_ils": round(r[2] / 100)}
            for r in svc_rows
        ],
        "top_clients": [
            {"name": r[0], "appointments": r[1], "revenue_ils": round(r[2] / 100)}
            for r in top_clients
        ],
        "avg_value_trend": avg_trend,
    }


@router.get("/occupancy")
def get_calendar_occupancy(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Calendar occupancy %: booked hours vs total working hours per period."""
    tz = pytz.timezone("Asia/Jerusalem")
    now = datetime.now(tz)
    today = now.date()

    settings = db.get(StudioSettings, ctx.studio_id)
    start_str = getattr(settings, "calendar_start_hour", None) or "08:00"
    end_str   = getattr(settings, "calendar_end_hour",   None) or "23:00"
    try:
        sh, sm = map(int, start_str.split(":"))
        eh, em = map(int, end_str.split(":"))
        work_min_per_day = (eh * 60 + em) - (sh * 60 + sm)
    except Exception:
        work_min_per_day = 0
    if work_min_per_day <= 0:
        # Fallback: 08:00–23:00 = 15 hours
        work_min_per_day = 15 * 60

    def period_data(p_start, p_end):
        days = max(1, (p_end - p_start).days)
        total_min = days * work_min_per_day

        utc_start = tz.localize(datetime(p_start.year, p_start.month, p_start.day)).astimezone(pytz.utc).replace(tzinfo=None)
        utc_end   = tz.localize(datetime(p_end.year,   p_end.month,   p_end.day)).astimezone(pytz.utc).replace(tzinfo=None)

        appts = db.scalars(
            select(Appointment).where(
                Appointment.studio_id == ctx.studio_id,
                Appointment.status.notin_(["canceled", "no_show"]),
                Appointment.starts_at >= utc_start,
                Appointment.starts_at <  utc_end,
                Appointment.ends_at.isnot(None),
            )
        ).all()

        booked_min = sum(
            max(0, int((a.ends_at - a.starts_at).total_seconds() / 60))
            for a in appts
        )
        pct = min(100, round(booked_min / total_min * 100))
        return {"booked_minutes": booked_min, "total_minutes": total_min, "percent": pct, "count": len(appts)}

    # Week: Sunday–Saturday (Israel week)
    days_since_sun = (today.weekday() + 1) % 7
    week_start      = today - timedelta(days=days_since_sun)
    week_end        = week_start + timedelta(days=7)
    last_week_start = week_start - timedelta(days=7)
    last_week_end   = week_start

    # Month
    from datetime import date as _date
    month_start      = today.replace(day=1)
    next_month       = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    if month_start.month == 1:
        last_month_start = month_start.replace(year=month_start.year - 1, month=12)
    else:
        last_month_start = month_start.replace(month=month_start.month - 1)
    last_month_end = month_start

    work_hours = round(work_min_per_day / 60, 1)

    return {
        "this_week":   period_data(week_start,       week_end),
        "last_week":   period_data(last_week_start,  last_week_end),
        "this_month":  period_data(month_start,      next_month),
        "last_month":  period_data(last_month_start, last_month_end),
        "work_hours_per_day": work_hours,
    }
