import uuid
from typing import List, Optional, Tuple
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select, and_, extract
from sqlalchemy.orm import Session
from sqlalchemy.exc import NoResultFound

from app.models.expense import Expense
from app.schemas.expense import ExpenseCreate, ExpenseUpdate

class ExpenseRepository:
    def __init__(self, session: Session):
        self.session = session

    def create(self, studio_id: uuid.UUID, expense_in: ExpenseCreate) -> Expense:
        """Create a new expense for a specific studio."""
        db_expense = Expense(
            studio_id=studio_id,
            **expense_in.model_dump()
        )
        self.session.add(db_expense)
        self.session.commit()
        self.session.refresh(db_expense)
        return db_expense

    def get_by_id(self, studio_id: uuid.UUID, expense_id: uuid.UUID) -> Optional[Expense]:
        """Get an expense by ID, strictly filtered by studio_id."""
        stmt = select(Expense).where(
            and_(
                Expense.id == expense_id,
                Expense.studio_id == studio_id
            )
        )
        return self.session.execute(stmt).scalar_one_or_none()

    def get_multi(
        self, 
        studio_id: uuid.UUID, 
        skip: int = 0, 
        limit: int = 100,
        month: Optional[int] = None,
        year: Optional[int] = None
    ) -> List[Expense]:
        """Get list of expenses for a studio, with optional month/year filtering."""
        query = select(Expense).where(Expense.studio_id == studio_id)
        
        if month is not None:
            query = query.where(extract('month', Expense.expense_date) == month)
        if year is not None:
            query = query.where(extract('year', Expense.expense_date) == year)
            
        query = query.order_by(Expense.expense_date.desc()).offset(skip).limit(limit)
        
        result = self.session.execute(query)
        return list(result.scalars().all())

    def update(
        self, 
        studio_id: uuid.UUID, 
        expense_id: uuid.UUID, 
        expense_in: ExpenseUpdate
    ) -> Optional[Expense]:
        """Update an expense, strictly checking studio_id."""
        db_expense = self.get_by_id(studio_id=studio_id, expense_id=expense_id)
        if not db_expense:
            return None
            
        update_data = expense_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_expense, field, value)
            
        self.session.commit()
        self.session.refresh(db_expense)
        return db_expense

    def delete(self, studio_id: uuid.UUID, expense_id: uuid.UUID) -> bool:
        """Delete an expense, strictly checking studio_id."""
        db_expense = self.get_by_id(studio_id=studio_id, expense_id=expense_id)
        if not db_expense:
            return False
            
        self.session.delete(db_expense)
        self.session.commit()
        return True

    def get_monthly_summary(
        self, 
        studio_id: uuid.UUID, 
        month: int, 
        year: int
    ) -> Tuple[Decimal, Decimal, int]:
        """Calculate total amount, total VAT, and count of invoices for a given month."""
        stmt = select(
            func.coalesce(func.sum(Expense.amount), Decimal('0.00')).label('total_amount'),
            func.coalesce(func.sum(Expense.vat_amount), Decimal('0.00')).label('total_vat'),
            func.count(Expense.id).label('invoice_count')
        ).where(
            and_(
                Expense.studio_id == studio_id,
                extract('month', Expense.expense_date) == month,
                extract('year', Expense.expense_date) == year
            )
        )
        
        result = self.session.execute(stmt).first()
        
        if result:
            return result.total_amount, result.total_vat, result.invoice_count
            
        return Decimal('0.00'), Decimal('0.00'), 0
