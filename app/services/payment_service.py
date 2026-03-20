from uuid import UUID
from sqlalchemy.orm import Session
from app.repositories.payment_repository import PaymentRepository
from app.models.client import Client
from app.models.client_points_ledger import ClientPointsLedger
from sqlalchemy import select, delete

class PaymentService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = PaymentRepository(db)

    def delete_payment(self, studio_id: UUID, payment_id: UUID) -> bool:
        payment = self.repo.get_by_id(studio_id, payment_id)
        if not payment:
            return False

        # 1. Revert cashback
        ledger_entries = self.db.scalars(
            select(ClientPointsLedger).where(
                ClientPointsLedger.studio_id == studio_id,
                ClientPointsLedger.client_id == payment.client_id,
                ClientPointsLedger.reason.ilike(f"%Cashback for payment {payment.id}%")
            )
        ).all()

        if ledger_entries:
            client = self.db.get(Client, payment.client_id)
            if client:
                total_revert = sum(entry.delta_points for entry in ledger_entries)
                client.loyalty_points = (client.loyalty_points or 0) - total_revert
                for entry in ledger_entries:
                    self.db.delete(entry)

        # 2. Delete payment
        self.db.delete(payment)
        self.db.commit()
        return True
