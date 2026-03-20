from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db
from app.models.payment import Payment
from app.models.expense import Expense
from app.services.export_service import generate_accounting_excel

router = APIRouter(prefix="/exports", tags=["Accounting Exports"])

@router.get("/accounting")
def export_accounting(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """
    Export all income and expenses for the given period to an Excel file.
    """
    # Fetch Payments (Income)
    payments_stmt = select(Payment).where(
        and_(
            Payment.studio_id == ctx.studio_id,
            Payment.status == "paid",
            Payment.created_at >= start_date,
            Payment.created_at <= end_date
        )
    )
    payments = db.execute(payments_stmt).scalars().all()
    
    income_data = []
    for p in payments:
        income_data.append({
            "created_at": p.created_at,
            "client_name": p.client.full_name if p.client else "N/A",
            "amount": Decimal(p.amount_cents) / Decimal(100),
            "method": p.method,
            "type": p.type,
            "notes": p.notes
        })

    # Fetch Expenses
    expenses_stmt = select(Expense).where(
        and_(
            Expense.studio_id == ctx.studio_id,
            Expense.expense_date >= start_date.date(),
            Expense.expense_date <= end_date.date()
        )
    )
    expenses = db.execute(expenses_stmt).scalars().all()
    
    expense_data = []
    for e in expenses:
        expense_data.append({
            "expense_date": e.expense_date,
            "supplier_name": e.supplier_name,
            "invoice_number": e.invoice_number,
            "category": e.category,
            "amount": e.amount,
            "vat_amount": e.vat_amount,
            "notes": e.notes
        })

    # Generate Excel
    excel_file = generate_accounting_excel(income_data, expense_data)
    
    filename = f"BizControl_Accounting_{start_date.strftime('%Y%m%d')}_{end_date.strftime('%Y%m%d')}.xlsx"
    
    return Response(
        content=excel_file.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )
