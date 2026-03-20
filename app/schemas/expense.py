import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ExpenseBase(BaseModel):
    title: str = Field(..., max_length=255)
    supplier_name: Optional[str] = Field(None, max_length=255)
    category: Optional[str] = Field(None, max_length=100)
    invoice_number: Optional[str] = Field(None, max_length=100)
    
    amount: Decimal = Field(..., ge=0)
    vat_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    
    expense_date: date
    
    receipt_url: Optional[str] = None
    is_ai_parsed: bool = False


class ExpenseCreate(ExpenseBase):
    pass


class ExpenseUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    supplier_name: Optional[str] = Field(None, max_length=255)
    category: Optional[str] = Field(None, max_length=100)
    invoice_number: Optional[str] = Field(None, max_length=100)
    
    amount: Optional[Decimal] = Field(None, ge=0)
    vat_amount: Optional[Decimal] = Field(None, ge=0)
    
    expense_date: Optional[date] = None
    
    receipt_url: Optional[str] = None
    is_ai_parsed: Optional[bool] = None


class ExpenseResponse(ExpenseBase):
    id: uuid.UUID
    studio_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ExpenseSummary(BaseModel):
    total_expenses: Decimal
    total_vat: Decimal
    invoice_count: int
