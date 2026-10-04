import uuid
import calendar
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Optional, Tuple

from sqlalchemy import Date, and_, cast, func, literal_column, select
from sqlalchemy.orm import Session

from app.models.monthly_goal import MonthlyGoal
from app.models.payment import Payment
from app.crud.payment import money_received
from app.models.pos_transaction import PosTransaction
from app.models.studio_settings import StudioSettings
from app.services.classes import at_il, js_weekday, today_il

class GoalRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_goal(self, studio_id: uuid.UUID, year: int, month: int) -> Optional[MonthlyGoal]:
        """Get the goal for a specific month/year."""
        stmt = select(MonthlyGoal).where(
            and_(
                MonthlyGoal.studio_id == studio_id,
                MonthlyGoal.year == year,
                MonthlyGoal.month == month
            )
        )
        return self.session.execute(stmt).scalar_one_or_none()

    def set_goal(self, studio_id: uuid.UUID, year: int, month: int, target: Decimal) -> MonthlyGoal:
        """Create or update a monthly goal."""
        db_goal = self.get_goal(studio_id, year, month)
        if db_goal:
            db_goal.target_amount = target
        else:
            db_goal = MonthlyGoal(
                studio_id=studio_id,
                year=year,
                month=month,
                target_amount=target
            )
            self.session.add(db_goal)
        
        self.session.commit()
        self.session.refresh(db_goal)
        return db_goal

    def _cents_by_day(self, studio_id: uuid.UUID, start: datetime, end: datetime) -> dict[date, int]:
        """Money in (paid payments without club points, and paid till sales) per day on the clock in Israel."""
        def il_day(col):
            # a literal zone, not a bound value — GROUP BY must repeat the exact same expression
            return cast(func.timezone(literal_column("'Asia/Jerusalem'"), col), Date)

        payments = select(il_day(Payment.created_at), func.sum(Payment.amount_cents)).where(
            Payment.studio_id == studio_id, Payment.status == "paid", money_received(),
            Payment.created_at >= start, Payment.created_at < end,
        ).group_by(il_day(Payment.created_at))
        sales = select(il_day(PosTransaction.created_at), func.sum(PosTransaction.total_cents)).where(
            PosTransaction.studio_id == studio_id, PosTransaction.status == "paid",
            PosTransaction.created_at >= start, PosTransaction.created_at < end,
        ).group_by(il_day(PosTransaction.created_at))

        by_day: dict[date, int] = {}
        for day, cents in [*self.session.execute(payments).all(), *self.session.execute(sales).all()]:
            by_day[day] = by_day.get(day, 0) + int(cents or 0)
        return by_day

    def get_progress(self, studio_id: uuid.UUID, year: int, month: int) -> dict:
        """Calculate revenue progress for a specific month."""
        goal = self.get_goal(studio_id, year, month)
        target = goal.target_amount if goal else Decimal("0.00")

        last_day = calendar.monthrange(year, month)[1]
        month_days = [date(year, month, d) for d in range(1, last_day + 1)]
        # the month on the clock in Israel — a payment at 01:00 on the 1st belongs to the new month
        by_day = self._cents_by_day(studio_id, at_il(month_days[0], time(0)), at_il(month_days[-1] + timedelta(days=1), time(0)))
        current_revenue = Decimal(sum(by_day.values())) / Decimal(100)

        # Calculations
        remaining = max(Decimal("0.00"), target - current_revenue)
        progress_pct = (float(current_revenue / target) * 100) if target > 0 else 0.0

        # Only the business's own working days count (a business closed on Saturday has no Saturdays to fill).
        # Today counts as worked once money came in today; until then it is still one of the days left — so the
        # morning does not show a day with no income yet, and the evening does not leave out the day's income.
        settings = self.session.get(StudioSettings, studio_id)
        work_days = sorted(settings.work_days) if settings and settings.work_days else [0, 1, 2, 3, 4, 5, 6]
        working = [d for d in month_days if js_weekday(d) in work_days]
        today = today_il()
        today_worked = by_day.get(today, 0) > 0
        days_elapsed = sum(1 for d in working if d < today or (d == today and today_worked))
        days_remaining = len(working) - days_elapsed
        revenue_so_far = Decimal(sum(c for d, c in by_day.items() if d <= today)) / Decimal(100)

        current_daily_avg = (revenue_so_far / Decimal(days_elapsed)) if days_elapsed > 0 else Decimal("0.00")
        required_daily_avg = (remaining / Decimal(days_remaining)) if days_remaining > 0 else Decimal("0.00")
        daily_revenue = [{"day": d.day, "amount": Decimal(by_day.get(d, 0)) / Decimal(100)} for d in month_days if d <= today]

        return {
            "year": year,
            "month": month,
            "target_amount": target,
            "current_revenue": current_revenue,
            "remaining_amount": remaining,
            "progress_percentage": round(progress_pct, 2),
            "days_in_month": len(working),
            "days_elapsed": days_elapsed,
            "days_remaining": days_remaining,
            "work_days": work_days,
            "daily_revenue": daily_revenue,
            "required_daily_avg": required_daily_avg.quantize(Decimal("0.01")),
            "current_daily_avg": current_daily_avg.quantize(Decimal("0.01"))
        }
