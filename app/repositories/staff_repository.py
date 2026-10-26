import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy import select, and_, case, func
from sqlalchemy.orm import Session

from app.models.work_session import WorkSession
from app.models.user import User
from app.models.payment import Payment
from app.models.appointment import Appointment

def paid_start(shift: WorkSession) -> datetime:
    """From when the shift counts — the opening hour when clocked in before it (services/nfc_clock.paid_from)."""
    return shift.paid_from or shift.start_time


def worked_seconds(shift: WorkSession) -> float:
    """A closed shift's counted time: from when it counts to the clock-out, less its breaks (an open shift: 0)."""
    if not shift.end_time:
        return 0.0
    return max((shift.end_time - paid_start(shift)).total_seconds() - (shift.break_minutes or 0) * 60, 0)


def start_break(shift: WorkSession, at: datetime) -> None:
    """The worker went on a break (the owner, 2026-10-19) — until it ends, the time isn't counted."""
    if shift.break_started_at is None:
        shift.break_started_at = at


def end_break(shift: WorkSession, at: datetime) -> int:
    """Back from the break (or the shift ended during it): its minutes are added to the shift's breaks. Its minutes."""
    if shift.break_started_at is None:
        return 0
    minutes = max(round((at - shift.break_started_at).total_seconds() / 60), 0)
    shift.break_minutes = (shift.break_minutes or 0) + minutes
    shift.break_started_at = None
    return minutes


def price_shift(shift: WorkSession, user: User | None) -> None:
    """A shift's pay — its hours (less the breaks) at the worker's hourly rate (hourly pay only; an open shift: 0)."""
    shift.session_pay = Decimal("0.00")
    if shift.end_time and user and user.pay_type == "hourly" and user.hourly_rate and user.hourly_rate > 0:
        seconds = worked_seconds(shift)
        hours = Decimal(seconds) / Decimal(3600)
        shift.session_pay = (hours * user.hourly_rate).quantize(Decimal("0.01"))


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

        from app.services.nfc_clock import paid_from
        now = datetime.now(timezone.utc)
        db_session = WorkSession(
            studio_id=studio_id,
            user_id=user_id,
            start_time=now,
            paid_from=paid_from(self.session, studio_id, now, user_id),
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

        db_session.end_time = datetime.now(timezone.utc)
        end_break(db_session, db_session.end_time)           # left during a break — the break lasted until now
        price_shift(db_session, self.session.get(User, user_id))

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
                func.sum(func.greatest(func.extract('epoch', WorkSession.end_time - func.coalesce(WorkSession.paid_from, WorkSession.start_time))
                                       - WorkSession.break_minutes * 60, 0))
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
                # Sum payments from appointments where user is the artist, less
                # the money given back: a refund is a SECOND, separate positive-
                # amount Payment row (crud/payment.record_refund — every credit
                # note), so it counts as minus. Summing it as plus paid commission
                # twice; leaving it out paid commission on credited work (the
                # owner, 2026-10-26: "everything resets when a payment is
                # credited"). A refund in a later month comes off that month.
                commission_stmt = select(
                    func.sum(case((Payment.type == "refund", -Payment.amount_cents), else_=Payment.amount_cents))
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

            g_pay = user.global_salary if user.pay_type == "global" else Decimal("0.00")
            # teaching group classes — the owner's choice, on top of the regular pay (app/services/class_payroll.py)
            from app.services.class_payroll import class_pay
            classes = class_pay(self.session, studio_id, user, start_date, end_date)
            results.append({
                "user_id": user.id,
                "display_name": user.display_name or user.email,
                "pay_type": user.pay_type,
                "hourly_rate": user.hourly_rate,
                "commission_rate": user.commission_rate,
                "global_salary": user.global_salary,
                "total_hours": h_hours,
                "hourly_pay": h_pay,
                "commission_pay": c_pay,
                "class_pay_mode": user.class_pay_mode or "none",
                **classes,
                "total_pay": h_pay + c_pay + g_pay + classes["class_pay"],
            })
            
        return results
