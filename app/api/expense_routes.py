"""
Expense management routes for the SaaS Business Management module.
All queries are strictly filtered by studio_id for multi-tenant data isolation.
"""
from __future__ import annotations

import os
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db
from app.repositories.expense_repository import ExpenseRepository
from app.schemas.expense import ExpenseCreate, ExpenseResponse, ExpenseUpdate, ExpenseSummary
from app.services.ai_invoice_service import AIInvoiceService
from datetime import datetime

router = APIRouter(prefix="/expenses", tags=["Expenses"])


def get_expense_repo(db: Session = Depends(get_db)) -> ExpenseRepository:
    return ExpenseRepository(db)


# ── List / Filter ───────────────────────────────────────────────────────────
@router.get("", response_model=list[ExpenseResponse])
def list_expenses(
    month: Optional[int] = Query(None, ge=1, le=12, description="Filter by month (1-12)"),
    year: Optional[int] = Query(None, ge=2000, le=2100, description="Filter by year"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: ExpenseRepository = Depends(get_expense_repo),
):
    return repo.get_multi(
        studio_id=ctx.studio_id,
        skip=skip,
        limit=limit,
        month=month,
        year=year,
    )


# ── Monthly Summary (Dashboard Cards) ────────────────────────────────────────
@router.get("/summary", response_model=ExpenseSummary)
def expense_summary(
    month: int = Query(..., ge=1, le=12, description="Month to summarize"),
    year: int = Query(..., ge=2000, le=2100, description="Year to summarize"),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: ExpenseRepository = Depends(get_expense_repo),
):
    total, vat, count = repo.get_monthly_summary(
        studio_id=ctx.studio_id,
        month=month,
        year=year,
    )
    return ExpenseSummary(total_expenses=total, total_vat=vat, invoice_count=count)


# ── Create (Manual Entry) ────────────────────────────────────────────────────
@router.post("", response_model=ExpenseResponse, status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseCreate,
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: ExpenseRepository = Depends(get_expense_repo),
):
    return repo.create(studio_id=ctx.studio_id, expense_in=payload)


# ── AI Invoice Scan ──────────────────────────────────────────────────────────
@router.post("/scan", status_code=status.HTTP_200_OK)
async def scan_invoice(
    file: UploadFile = File(..., description="Invoice image (JPG, PNG, WEBP)"),
    ctx: AuthContext = Depends(require_studio_ctx),
):
    """
    Upload a invoice image and use OpenAI Vision to extract:
    business_name, invoice_number, total_amount, vat_amount, invoice_date.
    Returns extracted data for user confirmation – does NOT save automatically.
    """
    allowed_types = {"image/jpeg", "image/png", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{file.content_type}'. Please upload JPG, PNG, or WEBP.",
        )

    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI scanning is not configured. Please set OPENAI_API_KEY.",
        )

    image_bytes = await file.read()

    try:
        service = AIInvoiceService()
        result = service.parse_invoice_from_bytes(image_bytes, content_type=file.content_type)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI parsing failed: {str(e)}",
        )

    return {
        "business_name": result.business_name,
        "invoice_number": result.invoice_number,
        "total_amount": float(result.total_amount) if result.total_amount else None,
        "vat_amount": float(result.vat_amount) if result.vat_amount else None,
        "invoice_date": result.invoice_date.isoformat() if result.invoice_date else None,
    }


# ── Update ───────────────────────────────────────────────────────────────────
@router.put("/{expense_id}", response_model=ExpenseResponse)
def update_expense(
    expense_id: uuid.UUID,
    payload: ExpenseUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: ExpenseRepository = Depends(get_expense_repo),
):
    updated = repo.update(studio_id=ctx.studio_id, expense_id=expense_id, expense_in=payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Expense not found")
    return updated


# ── Delete ───────────────────────────────────────────────────────────────────
@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: ExpenseRepository = Depends(get_expense_repo),
):
    ok = repo.delete(studio_id=ctx.studio_id, expense_id=expense_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Expense not found")
    return None
