"""
Expense management routes for the SaaS Business Management module.
All queries are strictly filtered by studio_id for multi-tenant data isolation.
"""
from __future__ import annotations

import logging
import os
import uuid

_log = logging.getLogger(__name__)
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
    db: Session = Depends(get_db),
):
    """
    Upload an invoice image and extract structured data via Document AI.
    Requires feature flag 'invoice_ai_scan' enabled and quota not exceeded.
    """
    from app.models.studio import Studio
    from app.models.studio_feature import StudioFeature
    from datetime import datetime

    # Check feature flag
    feature = db.query(StudioFeature).filter_by(
        studio_id=ctx.studio_id, feature="invoice_ai_scan"
    ).first()
    if not feature or not feature.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="סריקת חשבוניות AI אינה מופעלת לסטודיו זה. צרו קשר עם התמיכה.",
        )

    # Check quota + reset monthly
    studio = db.query(Studio).filter_by(id=ctx.studio_id).first()
    if studio:
        current_month = datetime.utcnow().strftime("%Y-%m")
        if studio.invoice_scan_reset_month != current_month:
            studio.invoice_scan_used = 0
            studio.invoice_scan_reset_month = current_month
            db.commit()
        if studio.invoice_scan_quota > 0 and studio.invoice_scan_used >= studio.invoice_scan_quota:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"חרגתם ממכסת הסריקות החודשית ({studio.invoice_scan_quota} סריקות). פנו לתמיכה להגדלת המכסה.",
            )

    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"סוג קובץ לא נתמך '{content_type}'. יש להעלות JPG, PNG, WEBP.",
        )

    adc_json = os.getenv("GOOGLE_ADC_JSON", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    project_id = os.getenv("DOCUMENT_AI_PROJECT_ID", "").strip()
    processor_id = os.getenv("DOCUMENT_AI_PROCESSOR_ID", "").strip()
    has_vision_key = (
        (adc_json and project_id and processor_id) or
        (openai_key and openai_key.startswith("sk-")) or
        (gemini_key and gemini_key.startswith("AIza")) or
        (openai_key and openai_key.startswith("AIza"))
    )
    if not has_vision_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="סריקת חשבוניות דורשת GEMINI_API_KEY, OPENAI_API_KEY (sk-...) או Google Document AI.",
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

    # Save receipt image to disk
    receipt_url = None
    try:
        import os as _os
        upload_dir = _os.path.join("uploads", "receipts", str(ctx.studio_id))
        _os.makedirs(upload_dir, exist_ok=True)
        ext = content_type.split("/")[-1].replace("jpeg", "jpg")
        fname = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"
        fpath = _os.path.join(upload_dir, fname)
        with open(fpath, "wb") as f:
            f.write(image_bytes)
        receipt_url = f"/uploads/receipts/{ctx.studio_id}/{fname}"
    except Exception as e:
        _log.warning("Could not save receipt image: %s", e)

    # Increment usage counter
    if studio:
        studio.invoice_scan_used = (studio.invoice_scan_used or 0) + 1
        db.commit()

    return {
        "business_name": result.business_name,
        "invoice_number": result.invoice_number,
        "total_amount": float(result.total_amount) if result.total_amount else None,
        "vat_amount": float(result.vat_amount) if result.vat_amount else None,
        "pretax_amount": float(result.pretax_amount) if result.pretax_amount else None,
        "invoice_date": result.invoice_date.isoformat() if result.invoice_date else None,
        "payment_method": result.payment_method,
        "receipt_url": receipt_url,
    }


# ── Mark as sent to accountant ───────────────────────────────────────────────
@router.post("/{expense_id}/mark-sent", response_model=ExpenseResponse)
def mark_sent_to_accountant(
    expense_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from app.models.expense import Expense as ExpenseModel
    exp = db.query(ExpenseModel).filter_by(id=expense_id, studio_id=ctx.studio_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Expense not found")
    exp.sent_to_accountant = True
    exp.sent_to_accountant_at = datetime.utcnow()
    db.commit()
    db.refresh(exp)
    return exp


@router.post("/{expense_id}/unmark-sent", response_model=ExpenseResponse)
def unmark_sent_to_accountant(
    expense_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from app.models.expense import Expense as ExpenseModel
    exp = db.query(ExpenseModel).filter_by(id=expense_id, studio_id=ctx.studio_id).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Expense not found")
    exp.sent_to_accountant = False
    exp.sent_to_accountant_at = None
    db.commit()
    db.refresh(exp)
    return exp


# ── Mark ALL in month as sent ────────────────────────────────────────────────
@router.post("/mark-month-sent", status_code=status.HTTP_200_OK)
def mark_month_sent(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2000),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from app.models.expense import Expense as ExpenseModel
    from sqlalchemy import and_, extract
    now = datetime.utcnow()
    db.query(ExpenseModel).filter(
        ExpenseModel.studio_id == ctx.studio_id,
        ExpenseModel.sent_to_accountant == False,
        extract("month", ExpenseModel.expense_date) == month,
        extract("year", ExpenseModel.expense_date) == year,
    ).update({"sent_to_accountant": True, "sent_to_accountant_at": now}, synchronize_session=False)
    db.commit()
    return {"ok": True}


# ── Export month as Excel ────────────────────────────────────────────────────
@router.get("/export/excel")
def export_excel(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2000),
    ctx: AuthContext = Depends(require_studio_ctx),
    repo: ExpenseRepository = Depends(get_expense_repo),
):
    from fastapi.responses import StreamingResponse
    import io
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    expenses = repo.get_multi(studio_id=ctx.studio_id, month=month, year=year, limit=1000)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"{month:02d}-{year}"
    ws.sheet_view.rightToLeft = True

    headers = ["תאריך", "ספק", "קטגוריה", "מספר מסמך", "לפני מע\"מ", "מע\"מ", "סה\"כ", "אמצעי תשלום", "הערות", "נשלח לרו\"ח"]
    header_fill = PatternFill("solid", fgColor="4F46E5")
    header_font = Font(bold=True, color="FFFFFF")
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")

    for row, e in enumerate(expenses, 2):
        ws.cell(row=row, column=1, value=str(e.expense_date))
        ws.cell(row=row, column=2, value=e.supplier_name or e.title)
        ws.cell(row=row, column=3, value=e.category or "")
        ws.cell(row=row, column=4, value=e.invoice_number or "")
        ws.cell(row=row, column=5, value=float(e.pretax_amount) if e.pretax_amount else "")
        ws.cell(row=row, column=6, value=float(e.vat_amount))
        ws.cell(row=row, column=7, value=float(e.amount))
        ws.cell(row=row, column=8, value=e.payment_method or "")
        ws.cell(row=row, column=9, value=e.notes or "")
        ws.cell(row=row, column=10, value="✓" if e.sent_to_accountant else "")

    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = 16

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"expenses_{year}_{month:02d}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
