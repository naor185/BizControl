from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.models.payment import Payment

class PaymentRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, studio_id: UUID, payment_id: UUID) -> Payment | None:
        return self.db.scalar(
            select(Payment).where(
                Payment.id == payment_id,
                Payment.studio_id == studio_id
            )
        )
