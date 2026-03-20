import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy import select, and_, func
from sqlalchemy.orm import Session

from app.models.work_session import WorkSession
from app.models.user import User
from app.models.payment import Payment
from app.models.appointment import Appointment

class StaffRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_active_session(self, studio_id: uuid.UUID, user_id: uuid.UUID) -> Optional[WorkSession]:
        """Find the currently open work session for a user."""
        stmt = select(WorkSession).where(
            and_(
                WorkSession.studio_id == studio_id,
                WorkSession.user_id == user_id,
                WorkSession.end_time.is_(None)
            )
        )
        return self.session.execute(stmt).scalar_one_or_none()

    def clock_in(self, studio_id: uuid.UUID, user_id: uuid.UUID) -> WorkSession:
        """Create a new work session (clock-in)."""
        # Check if already clocked in
        existing = self.get_active_session(studio_id, user_id)
        if existing:
            return existing

        db_session = WorkSession(
            studio_id=studio_id,
            user_id=user_id,
            start_time=datetime.now(timezone.utc)
        )
        self.session.add(db_session)
        self.session.commit()
        self.session.refresh(db_session)
        return db_session

    def clock_out(self, studio_id: uuid.UUID, user_id: uuid.UUID) -> Optional[WorkSession]:
        """Close an active work session (clock-out) and calculate session pay."""
        db_session = self.get_active_session(studio_id, user_id)
        if not db_session:
            return None

        # Fetch user's hourly rate
        user = self.session.get(User, user_id)
        
        db_session.end_time = datetime.now(timezone.utc)
        
        # Calculate hourly pay if applicable
        if user and user.pay_type == "hourly" and user.hourly_rate > 0:
            duration = db_session.end_time - db_session.start_time
            hours = Decimal(duration.total_seconds()) / Decimal(3600)
            db_session.session_pay = (hours * user.hourly_rate).quantize(Decimal("0.01"))

        self.session.commit()
        self.session.refresh(db_session)
        return db_session

    def get_user_payroll_summary(
        self, 
        studio_id: uuid.UUID, 
        start_date: datetime, 
        end_date: datetime
    ) -> List[dict]:
        """Calculate payroll for all staff in the studio for a given period."""
        # 1. Get all users in studio
        users = self.session.execute(
            select(User).where(and_(User.studio_id == studio_id, User.is_active == True))
        ).scalars().all()
        
        results = []
        
        for user in users:
            # 2. Sum hourly pay from work sessions
            hourly_stmt = select(
                func.sum(WorkSession.session_pay),
                func.sum(func.extract('epoch', WorkSession.end_time - WorkSession.start_time))
            ).where(
                and_(
                    WorkSession.user_id == user.id,
                    WorkSession.start_time >= start_date,
                    WorkSession.start_time <= end_date,
                    WorkSession.end_time.is_not(None)
                )
            )
            h_pay, h_seconds = self.session.execute(hourly_stmt).first()
            h_pay = Decimal(h_pay or 0).quantize(Decimal("0.01"))
            h_hours = float(Decimal(h_seconds or 0) / Decimal(3600))
            
            # 3. Sum commission pay (if applicable)
            c_pay = Decimal("0.00")
            if user.pay_type == "commission" and user.commission_rate > 0:
                # Sum payments from appointments where user is the artist
                commission_stmt = select(
                    func.sum(Payment.amount_cents)
                ).join(
                    Appointment, Appointment.id == Payment.appointment_id
                ).where(
                    and_(
                        Appointment.artist_id == user.id,
                        Payment.studio_id == studio_id,
                        Payment.status == "paid",
                        Payment.created_at >= start_date,
                        Payment.created_at <= end_date
                    )
                )
                total_cents = self.session.execute(commission_stmt).scalar() or 0
                total_amount = Decimal(total_cents) / Decimal(100)
                # Apply commission percentage
                c_pay = (total_amount * (user.commission_rate / Decimal(100))).quantize(Decimal("0.01"))

            results.append({
                "user_id": user.id,
                "display_name": user.display_name or user.email,
                "pay_type": user.pay_type,
                "hourly_rate": user.hourly_rate,
                "commission_rate": user.commission_rate,
                "total_hours": h_hours,
                "hourly_pay": h_pay,
                "commission_pay": c_pay,
                "total_pay": h_pay + c_pay
            })
            
        return results
