import uuid
import calendar
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, Tuple

from sqlalchemy import select, and_, func
from sqlalchemy.orm import Session

from app.models.monthly_goal import MonthlyGoal
from app.models.payment import Payment

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

    def get_progress(self, studio_id: uuid.UUID, year: int, month: int) -> dict:
        """Calculate revenue progress for a specific month."""
        goal = self.get_goal(studio_id, year, month)
        target = goal.target_amount if goal else Decimal("0.00")

        # Sum paid payments in this month
        start_date = datetime(year, month, 1)
        last_day = calendar.monthrange(year, month)[1]
        end_date = datetime(year, month, last_day, 23, 59, 59)

        stmt = select(func.sum(Payment.amount_cents)).where(
            and_(
                Payment.studio_id == studio_id,
                Payment.status == "paid",
                Payment.created_at >= start_date,
                Payment.created_at <= end_date
            )
        )
        total_cents = self.session.execute(stmt).scalar() or 0
        current_revenue = Decimal(total_cents) / Decimal(100)

        # Calculations
        remaining = max(Decimal("0.00"), target - current_revenue)
        progress_pct = (float(current_revenue / target) * 100) if target > 0 else 0.0

        today = date.today()
        if today.year == year and today.month == month:
            days_elapsed = today.day
        elif today > end_date.date():
            days_elapsed = last_day
        else:
            days_elapsed = 0

        days_remaining = max(0, last_day - days_elapsed)
        
        current_daily_avg = (current_revenue / Decimal(days_elapsed)) if days_elapsed > 0 else Decimal("0.00")
        required_daily_avg = (remaining / Decimal(days_remaining)) if days_remaining > 0 else Decimal("0.00")

        return {
            "year": year,
            "month": month,
            "target_amount": target,
            "current_revenue": current_revenue,
            "remaining_amount": remaining,
            "progress_percentage": round(progress_pct, 2),
            "days_in_month": last_day,
            "days_elapsed": days_elapsed,
            "days_remaining": days_remaining,
            "required_daily_avg": required_daily_avg.quantize(Decimal("0.01")),
            "current_daily_avg": current_daily_avg.quantize(Decimal("0.01"))
        }
