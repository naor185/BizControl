"""
Invoice / Document System
- Immutable after issue (no update/delete, only credit note)
- VAT rate snapshotted at issue time
- Sequential series per doc_type per studio
- PDF generation with Hebrew RTL support
"""
from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone, date
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.security import decode_token
from app.models.user import User
from app.models.studio_settings import StudioSettings
from app.utils.email_utils import send_email_sync

router = APIRouter(prefix="/invoices", tags=["Invoices"])

# ── Constants ─────────────────────────────────────────────────────────────────

DOC_TYPES = {
    "invoice_tax":         "חשבונית מס",
    "receipt":             "קבלה",
    "invoice_tax_receipt": "חשבונית מס/קבלה",
    "credit":              "זיכוי",
    "transaction":         "חשבונית עסקה",
}

# Allowed doc types per business type
ALLOWED_DOCS = {
    "osek_patur":   ["receipt", "transaction", "credit"],
    "osek_murshe":  ["invoice_tax", "receipt", "invoice_tax_receipt", "credit"],
    "chevra_baam":  ["invoice_tax", "receipt", "invoice_tax_receipt", "credit"],
}

BIZ_TYPE_LABELS = {
    "osek_patur":  "עוסק פטור",
    "osek_murshe": "עוסק מורשה",
    "chevra_baam": "חברה בע\"מ",
}

METHOD_LABELS = {
    "cash": "מזומן", "bit": "Bit", "paybox": "PayBox",
    "credit_card": "כרטיס אשראי", "bank_transfer": "העברה בנקאית",
    "check": "צ'ק", "other": "אחר",
}

# ── Schemas ───────────────────────────────────────────────────────────────────

class InvoiceSettingsIn(BaseModel):
    business_type: str = "osek_patur"
    business_name: Optional[str] = None
    business_number: Optional[str] = None
    vat_rate: float = 18.00
    business_address: Optional[str] = None
    business_city: Optional[str] = None
    business_phone: Optional[str] = None
    business_email: Optional[str] = None
    logo_url: Optional[str] = None
    signature_url: Optional[str] = None
    payment_terms: Optional[str] = None
    default_notes: Optional[str] = None

class SeriesUpdateItem(BaseModel):
    doc_type: str
    next_number: int

class InvoiceItemIn(BaseModel):
    description: str
    quantity: float = 1.0
    unit_price_cents: int
    product_id: Optional[str] = None
    service_id: Optional[str] = None

class CreateInvoiceIn(BaseModel):
    doc_type: str
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    client_address: Optional[str] = None
    client_business_number: Optional[str] = None
    items: List[InvoiceItemIn]
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    payment_date: Optional[date] = None
    notes: Optional[str] = None
    payment_terms: Optional[str] = None
    tip_cents: int = 0
    source: str = "manual"
    source_id: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_create_settings(studio_id: str, studio_name: str, db: Session) -> dict:
    row = db.execute(
        text("SELECT * FROM invoice_settings WHERE studio_id = :sid"),
        {"sid": studio_id}
    ).fetchone()
    if row:
        return dict(row._mapping)
    db.execute(
        text("""INSERT INTO invoice_settings (id, studio_id, business_name)
                VALUES (:id, :sid, :name)
                ON CONFLICT (studio_id) DO NOTHING"""),
        {"id": str(uuid.uuid4()), "sid": studio_id, "name": studio_name}
    )
    db.commit()
    row = db.execute(
        text("SELECT * FROM invoice_settings WHERE studio_id = :sid"),
        {"sid": studio_id}
    ).fetchone()
    return dict(row._mapping)


def _next_doc_number(studio_id: str, doc_type: str, db: Session) -> int:
    """Atomically get and increment the next doc number for this series."""
    result = db.execute(
        text("""
            INSERT INTO invoice_series (studio_id, doc_type, next_number)
            VALUES (:sid, :dt, 1001)
            ON CONFLICT (studio_id, doc_type)
            DO UPDATE SET next_number = invoice_series.next_number + 1
            RETURNING next_number - 1
        """),
        {"sid": studio_id, "dt": doc_type}
    ).fetchone()
    db.commit()
    return result[0]


def _invoice_to_dict(row, items=None) -> dict:
    d = dict(row._mapping)
    d["doc_type_label"] = DOC_TYPES.get(d.get("doc_type", ""), d.get("doc_type", ""))
    d["total_ils"] = round((d.get("total_cents") or 0) / 100, 2)
    d["subtotal_ils"] = round((d.get("subtotal_cents") or 0) / 100, 2)
    d["vat_amount_ils"] = round((d.get("vat_amount_cents") or 0) / 100, 2)
    d["tip_ils"] = round((d.get("tip_cents") or 0) / 100, 2)
    if items is not None:
        d["items"] = items
    return d


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT * FROM invoice_settings WHERE studio_id = :sid"),
        {"sid": ctx.studio_id}
    ).fetchone()
    if not row:
        return {
            "business_type": "osek_patur", "vat_rate": 18.0,
            "settings_completed": False,
            "allowed_doc_types": ALLOWED_DOCS["osek_patur"],
        }
    d = dict(row._mapping)
    d["allowed_doc_types"] = ALLOWED_DOCS.get(d.get("business_type", "osek_patur"), [])
    d["business_type_label"] = BIZ_TYPE_LABELS.get(d.get("business_type", ""), "")
    return d


@router.put("/settings")
def upsert_settings(
    body: InvoiceSettingsIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if body.business_type not in ALLOWED_DOCS:
        raise HTTPException(400, "סוג עסק לא תקין")

    # Only allow editing if not yet completed (or superadmin)
    existing = db.execute(
        text("SELECT settings_completed FROM invoice_settings WHERE studio_id = :sid"),
        {"sid": ctx.studio_id}
    ).fetchone()
    if existing and existing[0] and ctx.role != "superadmin":
        raise HTTPException(403, "הגדרות החשבונית נעולות. פנה לתמיכה לפתיחתן.")

    db.execute(
        text("""
            INSERT INTO invoice_settings
                (id, studio_id, business_type, business_name, business_number, vat_rate,
                 business_address, business_city, business_phone, business_email,
                 logo_url, signature_url, payment_terms, default_notes, updated_at)
            VALUES
                (:id, :sid, :bt, :bname, :bn, :vr, :addr, :city, :phone, :email,
                 :logo, :sig, :terms, :notes, NOW())
            ON CONFLICT (studio_id) DO UPDATE SET
                business_type=EXCLUDED.business_type,
                business_name=EXCLUDED.business_name,
                business_number=EXCLUDED.business_number,
                vat_rate=EXCLUDED.vat_rate,
                business_address=EXCLUDED.business_address,
                business_city=EXCLUDED.business_city,
                business_phone=EXCLUDED.business_phone,
                business_email=EXCLUDED.business_email,
                logo_url=EXCLUDED.logo_url,
                signature_url=EXCLUDED.signature_url,
                payment_terms=EXCLUDED.payment_terms,
                default_notes=EXCLUDED.default_notes,
                updated_at=NOW()
        """),
        {
            "id": str(uuid.uuid4()), "sid": ctx.studio_id,
            "bt": body.business_type, "bname": body.business_name,
            "bn": body.business_number,
            "vr": body.vat_rate, "addr": body.business_address,
            "city": body.business_city, "phone": body.business_phone,
            "email": body.business_email, "logo": body.logo_url,
            "sig": body.signature_url, "terms": body.payment_terms,
            "notes": body.default_notes,
        }
    )
    db.commit()
    return {"ok": True}


class CompleteSetupIn(BaseModel):
    business_type: str
    business_name: Optional[str] = None
    business_number: Optional[str] = None
    business_address: Optional[str] = None
    business_city: Optional[str] = None
    business_phone: Optional[str] = None
    business_email: Optional[str] = None
    series: dict = {}  # {doc_type: next_number}


@router.post("/settings/complete")
def complete_setup(
    body: CompleteSetupIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """First-time wizard completion — saves settings + series, then locks."""
    if body.business_type not in ALLOWED_DOCS:
        raise HTTPException(400, "סוג עסק לא תקין")

    # Upsert settings
    db.execute(
        text("""
            INSERT INTO invoice_settings
                (id, studio_id, business_type, business_name, business_number, vat_rate,
                 business_address, business_city, business_phone, business_email,
                 settings_completed, updated_at)
            VALUES
                (:id, :sid, :bt, :bname, :bn, 18.00, :addr, :city, :phone, :email,
                 TRUE, NOW())
            ON CONFLICT (studio_id) DO UPDATE SET
                business_type=EXCLUDED.business_type,
                business_name=EXCLUDED.business_name,
                business_number=EXCLUDED.business_number,
                business_address=EXCLUDED.business_address,
                business_city=EXCLUDED.business_city,
                business_phone=EXCLUDED.business_phone,
                business_email=EXCLUDED.business_email,
                settings_completed=TRUE,
                updated_at=NOW()
        """),
        {
            "id": str(uuid.uuid4()), "sid": ctx.studio_id,
            "bt": body.business_type, "bname": body.business_name,
            "bn": body.business_number, "addr": body.business_address,
            "city": body.business_city, "phone": body.business_phone,
            "email": body.business_email,
        }
    )

    # Save series starting numbers
    for doc_type, next_number in body.series.items():
        if doc_type in DOC_TYPES and isinstance(next_number, int) and next_number >= 1:
            db.execute(
                text("""
                    INSERT INTO invoice_series (studio_id, doc_type, next_number)
                    VALUES (:sid, :dt, :num)
                    ON CONFLICT (studio_id, doc_type) DO UPDATE SET next_number = EXCLUDED.next_number
                """),
                {"sid": ctx.studio_id, "dt": doc_type, "num": next_number}
            )

    db.commit()
    return {"ok": True}


@router.post("/settings/unlock")
def unlock_settings(
    studio_id_target: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Superadmin only: unlock invoice settings for a studio."""
    if ctx.role != "superadmin":
        raise HTTPException(403, "אין הרשאה")
    db.execute(
        text("UPDATE invoice_settings SET settings_completed=FALSE, updated_at=NOW() WHERE studio_id=:sid"),
        {"sid": studio_id_target}
    )
    db.commit()
    return {"ok": True}


@router.patch("/settings/accountant-email")
def update_accountant_email(
    body: dict,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Update accountant email — always editable, not locked with main settings."""
    email = body.get("accountant_email", "").strip() or None
    db.execute(
        text("UPDATE invoice_settings SET accountant_email=:email, updated_at=NOW() WHERE studio_id=:sid"),
        {"email": email, "sid": ctx.studio_id}
    )
    db.commit()
    return {"ok": True, "accountant_email": email}


@router.post("/send-to-accountant")
def send_to_accountant(
    body: dict,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Manually send invoices for a date range to the studio's accountant email."""
    inv_settings = db.execute(
        text("SELECT accountant_email FROM invoice_settings WHERE studio_id = :sid"),
        {"sid": ctx.studio_id}
    ).fetchone()
    accountant_email = inv_settings[0] if inv_settings else None
    if not accountant_email:
        raise HTTPException(400, "לא הוגדר מייל רואה חשבון. הגדר אותו בטאב ההגדרות.")

    studio_settings = db.get(StudioSettings, ctx.studio_id)
    resend_key = getattr(studio_settings, "resend_api_key", None)
    from_email = getattr(studio_settings, "resend_from_email", None) or "onboarding@resend.dev"
    if not resend_key:
        raise HTTPException(400, "לא הוגדר Resend API Key. הגדר אותו בהגדרות מייל.")

    date_from = body.get("date_from")
    date_to = body.get("date_to")
    if not date_from or not date_to:
        raise HTTPException(400, "חסרים תאריכים")

    rows = db.execute(
        text("""
            SELECT doc_type, doc_number, client_name, total_cents, vat_amount_cents,
                   payment_method, issued_at
            FROM invoices
            WHERE studio_id = :sid
              AND issued_at >= :df AND issued_at <= :dt
              AND status != 'voided'
            ORDER BY issued_at
        """),
        {"sid": ctx.studio_id, "df": date_from, "dt": date_to}
    ).fetchall()

    method_labels = {
        "cash": "מזומן", "bit": "Bit", "paybox": "PayBox",
        "credit_card": "כרטיס אשראי", "bank_transfer": "העברה בנקאית",
        "check": "צ'ק", "other": "אחר",
    }
    doc_labels = {
        "invoice_tax": "חשבונית מס", "receipt": "קבלה",
        "invoice_tax_receipt": "חשבונית מס/קבלה", "credit": "זיכוי",
        "transaction": "חשבונית עסקה",
    }

    rows_html = ""
    total_sum = 0
    vat_sum = 0
    for r in rows:
        total_ils = round((r[3] or 0) / 100, 2)
        vat_ils = round((r[4] or 0) / 100, 2)
        total_sum += total_ils
        vat_sum += vat_ils
        issued = r[6].strftime("%d/%m/%Y") if r[6] else ""
        rows_html += f"""
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">{doc_labels.get(r[0], r[0])} #{r[1]}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">{r[2] or '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">{issued}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">{method_labels.get(r[5] or '', r[5] or '—')}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:left;font-weight:700">₪{total_ils:.2f}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:left">₪{vat_ils:.2f}</td>
        </tr>"""

    biz_name = getattr(studio_settings, "studio_name", "") or ""
    html = f"""
    <html dir="rtl" lang="he"><head><meta charset="UTF-8">
    <style>body{{font-family:Arial,sans-serif;direction:rtl;color:#1a1a2e}}
    table{{width:100%;border-collapse:collapse}}th{{background:#1a1a2e;color:#fff;padding:10px 12px;font-size:13px}}</style>
    </head><body>
    <div style="max-width:700px;margin:0 auto;padding:20px">
      <h2 style="color:#1a1a2e;margin-bottom:4px">דוח מסמכים — {biz_name}</h2>
      <p style="color:#64748b;font-size:13px;margin-bottom:20px">
        תקופה: {date_from[:10]} עד {date_to[:10]} | סה"כ {len(rows)} מסמכים
      </p>
      <table>
        <thead><tr>
          <th>מסמך</th><th>לקוח</th><th>תאריך</th><th>אמצעי תשלום</th>
          <th style="text-align:left">סכום</th><th style="text-align:left">מע"מ</th>
        </tr></thead>
        <tbody>{rows_html}</tbody>
        <tfoot><tr style="background:#f8fafc;font-weight:700">
          <td colspan="4" style="padding:10px 12px;text-align:right">סה"כ</td>
          <td style="padding:10px 12px;text-align:left">₪{total_sum:.2f}</td>
          <td style="padding:10px 12px;text-align:left">₪{vat_sum:.2f}</td>
        </tr></tfoot>
      </table>
      <p style="color:#94a3b8;font-size:11px;margin-top:20px">נשלח ממערכת BizControl</p>
    </div></body></html>"""

    ok = send_email_sync(
        api_key=resend_key,
        from_email=from_email,
        to_email=accountant_email,
        subject=f"דוח מסמכים {date_from[:10]}–{date_to[:10]} | {biz_name}",
        html_content=html,
    )
    if not ok:
        raise HTTPException(500, "שגיאה בשליחת המייל. בדוק את הגדרות ה-Resend.")
    return {"sent": len(rows)}


@router.get("/series")
def get_series(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    rows = db.execute(
        text("SELECT doc_type, next_number FROM invoice_series WHERE studio_id = :sid"),
        {"sid": ctx.studio_id}
    ).fetchall()
    existing = {r[0]: r[1] for r in rows}
    result = {}
    for dt in ["invoice_tax", "receipt", "invoice_tax_receipt", "credit", "transaction"]:
        result[dt] = {"label": DOC_TYPES[dt], "next_number": existing.get(dt, 1000)}
    return result


@router.put("/series")
def update_series(
    items: List[SeriesUpdateItem],
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    for item in items:
        if item.doc_type not in DOC_TYPES:
            raise HTTPException(400, f"סוג מסמך לא תקין: {item.doc_type}")
        if item.next_number < 1:
            raise HTTPException(400, "מספר התחלתי חייב להיות חיובי")
        db.execute(
            text("""
                INSERT INTO invoice_series (studio_id, doc_type, next_number)
                VALUES (:sid, :dt, :num)
                ON CONFLICT (studio_id, doc_type) DO UPDATE SET next_number = EXCLUDED.next_number
            """),
            {"sid": ctx.studio_id, "dt": item.doc_type, "num": item.next_number}
        )
    db.commit()
    return {"ok": True}


# ── Invoice CRUD ──────────────────────────────────────────────────────────────

@router.post("/from-payment/{payment_id}")
def create_invoice_from_payment(
    payment_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Manually create an invoice from an existing payment (retroactive / retry)."""
    from app.models.payment import Payment as _Payment
    from app.models.appointment import Appointment as _Appointment
    from app.models.client import Client as _Client
    from app.crud.payment import _auto_create_invoice
    import logging as _log
    _logger = _log.getLogger(__name__)

    payment = db.execute(
        text("SELECT * FROM payments WHERE id = :pid AND studio_id = :sid"),
        {"pid": payment_id, "sid": ctx.studio_id},
    ).fetchone()
    if not payment:
        raise HTTPException(404, "תשלום לא נמצא")

    # Check if invoice already exists for this payment
    existing = db.execute(
        text("SELECT id FROM invoices WHERE source_id = :sid AND doc_type != 'credit' AND studio_id = :stid"),
        {"sid": payment_id, "stid": ctx.studio_id},
    ).fetchone()
    if existing:
        return {"invoice_id": str(existing[0]), "already_existed": True}

    # Load ORM objects for _auto_create_invoice
    payment_obj = db.get(_Payment, payment_id)
    if not payment_obj:
        raise HTTPException(404, "תשלום לא נמצא")

    appt = None
    if payment_obj.appointment_id:
        appt = db.get(_Appointment, payment_obj.appointment_id)

    client = None
    if payment_obj.client_id:
        client = db.get(_Client, payment_obj.client_id)

    if not client:
        raise HTTPException(400, "לקוח לא נמצא לתשלום זה")
    if not appt:
        raise HTTPException(400, "תור לא נמצא לתשלום זה")

    try:
        invoice_id = _auto_create_invoice(db, ctx.studio_id, payment_obj, appt, client)
    except Exception:
        _logger.exception("[from-payment] _auto_create_invoice failed for payment %s", payment_id)
        raise HTTPException(500, "שגיאה ביצירת קבלה — בדוק לוגים")

    return {"invoice_id": invoice_id, "already_existed": False}


@router.post("/backfill-missing")
def backfill_missing_invoices(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Find every paid payment that has no invoice and generate one for each."""
    from app.models.payment import Payment as _Payment
    from app.models.appointment import Appointment as _Appointment
    from app.models.client import Client as _Client
    from app.crud.payment import _auto_create_invoice
    import logging as _log
    _logger = _log.getLogger(__name__)

    # Payments that are paid (payment or deposit) but have no matching invoice
    rows = db.execute(
        text("""
            SELECT p.id, p.appointment_id, p.client_id, p.amount_cents, p.type, p.method
            FROM payments p
            WHERE p.studio_id = :sid
              AND p.status = 'paid'
              AND p.type IN ('payment', 'deposit')
              AND p.amount_cents > 0
              AND NOT EXISTS (
                  SELECT 1 FROM invoices i
                  WHERE i.source_id = p.id::text
                    AND i.doc_type != 'credit'
              )
            ORDER BY p.created_at ASC
        """),
        {"sid": ctx.studio_id},
    ).fetchall()

    created = []
    failed = []

    for row in rows:
        payment_id = str(row[0])
        try:
            payment_obj = db.get(_Payment, payment_id)
            if not payment_obj:
                failed.append({"payment_id": payment_id, "reason": "payment not found"})
                continue

            appt = db.get(_Appointment, payment_obj.appointment_id) if payment_obj.appointment_id else None
            client = db.get(_Client, payment_obj.client_id) if payment_obj.client_id else None

            if not client or not appt:
                failed.append({"payment_id": payment_id, "reason": "missing client or appointment"})
                continue

            invoice_id = _auto_create_invoice(db, ctx.studio_id, payment_obj, appt, client)
            created.append({"payment_id": payment_id, "invoice_id": invoice_id})
        except Exception as e:
            _logger.exception("[backfill] failed for payment %s", payment_id)
            # Roll back the current aborted transaction so next iteration can proceed
            try:
                db.rollback()
            except Exception:
                pass
            failed.append({"payment_id": payment_id, "reason": str(e)})

    return {
        "created": len(created),
        "failed": len(failed),
        "details_created": created,
        "details_failed": failed,
    }


@router.get("")
def list_invoices(
    doc_type: Optional[str] = None,
    client_id: Optional[str] = None,
    appointment_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    where = ["studio_id = :sid"]
    params: dict = {"sid": ctx.studio_id, "limit": limit, "offset": offset}

    if doc_type:
        where.append("doc_type = :dt")
        params["dt"] = doc_type
    if client_id:
        where.append("client_id = :cid")
        params["cid"] = client_id
    if appointment_id:
        where.append("appointment_id = :appt_id")
        params["appt_id"] = appointment_id
    if status:
        where.append("status = :status")
        params["status"] = status
    if date_from:
        where.append("issued_at >= :df")
        params["df"] = date_from
    if date_to:
        where.append("issued_at <= :dt2")
        params["dt2"] = date_to

    sql = f"""
        SELECT * FROM invoices
        WHERE {' AND '.join(where)}
        ORDER BY issued_at DESC
        LIMIT :limit OFFSET :offset
    """
    rows = db.execute(text(sql), params).fetchall()
    total = db.execute(
        text(f"SELECT COUNT(*) FROM invoices WHERE {' AND '.join(where)}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")}
    ).scalar()

    return {"items": [_invoice_to_dict(r) for r in rows], "total": total}


@router.post("")
def create_invoice(
    body: CreateInvoiceIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    # Validate doc type
    settings_row = db.execute(
        text("SELECT * FROM invoice_settings WHERE studio_id = :sid"),
        {"sid": ctx.studio_id}
    ).fetchone()
    settings = dict(settings_row._mapping) if settings_row else {}
    biz_type = settings.get("business_type", "osek_patur")

    # For osek_patur: force to "receipt" (never invoice_tax_receipt which implies VAT)
    if biz_type == "osek_patur" and body.doc_type in ("invoice_tax_receipt", "invoice_tax"):
        body = body.model_copy(update={"doc_type": "receipt"})

    allowed = ALLOWED_DOCS.get(biz_type, [])
    if body.doc_type not in allowed:
        raise HTTPException(400, f"סוג מסמך '{DOC_TYPES.get(body.doc_type, body.doc_type)}' לא מותר לסוג עסק זה")

    if not body.items:
        raise HTTPException(400, "חייב להיות לפחות פריט אחד")

    # Get studio name
    studio = db.execute(
        text("SELECT name, logo_url FROM studios WHERE id = :sid"),
        {"sid": ctx.studio_id}
    ).fetchone()
    if not studio:
        raise HTTPException(404, "סטודיו לא נמצא")

    # Resolve client info
    client_name = body.client_name
    client_phone = body.client_phone
    client_email = body.client_email
    if body.client_id:
        client_row = db.execute(
            text("SELECT full_name, phone, email FROM clients WHERE id = :cid AND studio_id = :sid"),
            {"cid": body.client_id, "sid": ctx.studio_id}
        ).fetchone()
        if client_row:
            client_name = client_name or client_row[0]
            client_phone = client_phone or client_row[1]
            client_email = client_email or client_row[2]

    # Calculate totals
    subtotal_cents = 0
    item_rows = []
    for item in body.items:
        total = int(round(item.quantity * item.unit_price_cents))
        subtotal_cents += total
        item_rows.append({
            "id": str(uuid.uuid4()),
            "description": item.description,
            "quantity": float(item.quantity),
            "unit_price_cents": item.unit_price_cents,
            "total_price_cents": total,
            "product_id": item.product_id,
            "service_id": item.service_id,
        })

    vat_rate = float(settings.get("vat_rate") or 18.0)
    # osek_patur has no VAT
    if biz_type == "osek_patur":
        vat_amount_cents = 0
    else:
        vat_amount_cents = int(round(subtotal_cents * vat_rate / 100))

    total_cents = subtotal_cents + vat_amount_cents + body.tip_cents

    # Get next doc number (atomic)
    doc_number = _next_doc_number(ctx.studio_id, body.doc_type, db)

    invoice_id = str(uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO invoices (
                id, studio_id, doc_type, doc_number, status,
                client_id, client_name, client_phone, client_email,
                client_address, client_business_number,
                business_name, business_type, business_number,
                business_address, business_city, business_phone, business_email, business_logo_url,
                subtotal_cents, vat_rate, vat_amount_cents, total_cents, tip_cents,
                payment_method, payment_reference, payment_date,
                notes, payment_terms, signature_url, source, source_id,
                issued_by_id, issued_at
            ) VALUES (
                :id, :sid, :dt, :dn, 'issued',
                :cid, :cname, :cphone, :cemail,
                :caddr, :cbn,
                :bname, :btype, :bnum,
                :baddr, :bcity, :bphone, :bemail, :blogo,
                :sub, :vr, :vat, :total, :tip,
                :method, :ref, :pdate,
                :notes, :terms, :sig, :src, :srcid,
                :uid, NOW()
            )
        """),
        {
            "id": invoice_id, "sid": ctx.studio_id, "dt": body.doc_type,
            "dn": doc_number, "cid": body.client_id, "cname": client_name,
            "cphone": client_phone, "cemail": client_email,
            "caddr": body.client_address, "cbn": body.client_business_number,
            "bname": settings.get("business_name") or studio[0],
            "btype": biz_type,
            "bnum": settings.get("business_number"),
            "baddr": settings.get("business_address"),
            "bcity": settings.get("business_city"),
            "bphone": settings.get("business_phone"),
            "bemail": settings.get("business_email"),
            "blogo": settings.get("logo_url") or studio[1],
            "sub": subtotal_cents, "vr": vat_rate,
            "vat": vat_amount_cents, "total": total_cents, "tip": body.tip_cents,
            "method": body.payment_method, "ref": body.payment_reference,
            "pdate": body.payment_date, "notes": body.notes,
            "terms": body.payment_terms or settings.get("payment_terms"),
            "sig": settings.get("signature_url"),
            "src": body.source, "srcid": body.source_id,
            "uid": ctx.user_id,
        }
    )

    for i, item in enumerate(item_rows):
        db.execute(
            text("""
                INSERT INTO invoice_items
                    (id, invoice_id, description, quantity, unit_price_cents,
                     total_price_cents, product_id, service_id, sort_order)
                VALUES (:id, :inv, :desc, :qty, :up, :tp, :pid, :sid2, :sort)
            """),
            {
                "id": item["id"], "inv": invoice_id,
                "desc": item["description"], "qty": item["quantity"],
                "up": item["unit_price_cents"], "tp": item["total_price_cents"],
                "pid": item["product_id"], "sid2": item["service_id"], "sort": i,
            }
        )

    # Auto-deduct inventory for products
    for item in item_rows:
        if item["product_id"]:
            db.execute(
                text("""
                    UPDATE products SET stock_quantity = stock_quantity - :qty
                    WHERE id = :pid AND studio_id = :sid AND stock_quantity IS NOT NULL
                """),
                {"qty": int(item["quantity"]), "pid": item["product_id"], "sid": ctx.studio_id}
            )

    db.commit()

    inv_row = db.execute(text("SELECT * FROM invoices WHERE id = :id"), {"id": invoice_id}).fetchone()
    return _invoice_to_dict(inv_row)


@router.get("/report-summary")
def reports_summary(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    params: dict = {"sid": ctx.studio_id}
    date_filter = ""
    if date_from:
        date_filter += " AND issued_at >= :df"
        params["df"] = date_from
    if date_to:
        date_filter += " AND issued_at <= :dt"
        params["dt"] = date_to

    base = f"studio_id=:sid AND doc_type != 'credit' AND status != 'credited' {date_filter}"

    total = db.execute(
        text(f"SELECT COALESCE(SUM(total_cents),0) FROM invoices WHERE {base}"),
        params
    ).scalar() or 0

    vat = db.execute(
        text(f"SELECT COALESCE(SUM(vat_amount_cents),0) FROM invoices WHERE {base}"),
        params
    ).scalar() or 0

    stats = db.execute(
        text(f"SELECT COUNT(*), COALESCE(AVG(total_cents),0) FROM invoices WHERE {base}"),
        params
    ).fetchone()
    count = stats[0] or 0
    avg = int(stats[1]) if stats[1] else 0

    by_method = db.execute(
        text(f"""
            SELECT payment_method, COUNT(*), COALESCE(SUM(total_cents),0)
            FROM invoices WHERE {base}
            GROUP BY payment_method ORDER BY 3 DESC
        """),
        params
    ).fetchall()

    by_type = db.execute(
        text(f"""
            SELECT doc_type, COUNT(*), COALESCE(SUM(total_cents),0)
            FROM invoices WHERE {base}
            GROUP BY doc_type ORDER BY 3 DESC
        """),
        params
    ).fetchall()

    by_service = db.execute(
        text(f"""
            SELECT ii.description, COUNT(*), COALESCE(SUM(ii.total_price_cents),0)
            FROM invoice_items ii
            JOIN invoices inv ON inv.id = ii.invoice_id
            WHERE inv.studio_id=:sid AND inv.doc_type != 'credit'
              AND inv.status != 'credited' {date_filter}
              AND ii.service_id IS NOT NULL
            GROUP BY ii.description ORDER BY 3 DESC LIMIT 20
        """),
        params
    ).fetchall()

    by_product = db.execute(
        text(f"""
            SELECT ii.description, COUNT(*), COALESCE(SUM(ii.total_price_cents),0)
            FROM invoice_items ii
            JOIN invoices inv ON inv.id = ii.invoice_id
            WHERE inv.studio_id=:sid AND inv.doc_type != 'credit'
              AND inv.status != 'credited' {date_filter}
              AND ii.product_id IS NOT NULL
            GROUP BY ii.description ORDER BY 3 DESC LIMIT 20
        """),
        params
    ).fetchall()

    by_employee = db.execute(
        text(f"""
            SELECT u.display_name, COUNT(inv.id), COALESCE(SUM(inv.total_cents),0)
            FROM invoices inv
            LEFT JOIN users u ON u.id = inv.issued_by_id
            WHERE {base}
            GROUP BY u.display_name ORDER BY 3 DESC
        """),
        params
    ).fetchall()

    def rows_to_list(rows):
        return [{"label": r[0] or "—", "count": r[1], "total_ils": round(r[2]/100, 2)} for r in rows]

    return {
        "total_ils": round(total / 100, 2),
        "vat_ils": round(vat / 100, 2),
        "count": count,
        "avg_ils": round(avg / 100, 2),
        "by_method": rows_to_list(by_method),
        "by_doc_type": [
            {"label": DOC_TYPES.get(r[0], r[0]), "count": r[1], "total_ils": round(r[2]/100, 2)}
            for r in by_type
        ],
        "by_service": rows_to_list(by_service),
        "by_product": rows_to_list(by_product),
        "by_employee": rows_to_list(by_employee),
    }


@router.get("/{invoice_id}")
def get_invoice(
    invoice_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text("SELECT * FROM invoices WHERE id = :id AND studio_id = :sid"),
        {"id": invoice_id, "sid": ctx.studio_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "מסמך לא נמצא")

    items = db.execute(
        text("SELECT * FROM invoice_items WHERE invoice_id = :id ORDER BY sort_order"),
        {"id": invoice_id}
    ).fetchall()

    item_list = [dict(r._mapping) for r in items]
    for it in item_list:
        it["unit_price_ils"] = round(it["unit_price_cents"] / 100, 2)
        it["total_price_ils"] = round(it["total_price_cents"] / 100, 2)

    result = _invoice_to_dict(row, item_list)

    # Add original invoice info if this is a credit note
    if result.get("credits_invoice_id"):
        orig = db.execute(
            text("SELECT doc_type, doc_number FROM invoices WHERE id = :id"),
            {"id": result["credits_invoice_id"]}
        ).fetchone()
        if orig:
            result["credits_invoice_display"] = f"{DOC_TYPES.get(orig[0], orig[0])} #{orig[1]}"

    # Add credit note info if this was credited
    if result.get("credited_by_id"):
        credit = db.execute(
            text("SELECT doc_number FROM invoices WHERE id = :id"),
            {"id": result["credited_by_id"]}
        ).fetchone()
        if credit:
            result["credited_by_display"] = f"זיכוי #{credit[0]}"

    return result


@router.delete("/{invoice_id}")
def delete_invoice(
    invoice_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Superadmin only: permanently delete an invoice and its items."""
    if ctx.role != "superadmin":
        raise HTTPException(403, "מחיקת מסמכים מותרת לסופר-אדמין בלבד")
    row = db.execute(
        text("SELECT id FROM invoices WHERE id = :id AND studio_id = :sid"),
        {"id": invoice_id, "sid": ctx.studio_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "מסמך לא נמצא")
    db.execute(text("DELETE FROM invoice_items WHERE invoice_id = :id"), {"id": invoice_id})
    db.execute(text("DELETE FROM invoices WHERE id = :id"), {"id": invoice_id})
    db.commit()
    return {"ok": True}


class CreditNoteRequest(BaseModel):
    payment_method: Optional[str] = None
    notes: Optional[str] = None


@router.post("/{invoice_id}/credit")
def create_credit_note(
    invoice_id: str,
    body: CreditNoteRequest = CreditNoteRequest(),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    orig = db.execute(
        text("SELECT * FROM invoices WHERE id = :id AND studio_id = :sid"),
        {"id": invoice_id, "sid": ctx.studio_id}
    ).fetchone()
    if not orig:
        raise HTTPException(404, "מסמך לא נמצא")
    if orig.status == "credited":
        raise HTTPException(400, "מסמך זה כבר זוכה")
    if orig.doc_type == "credit":
        raise HTTPException(400, "לא ניתן לזכות זיכוי")

    orig_items = db.execute(
        text("SELECT * FROM invoice_items WHERE invoice_id = :id ORDER BY sort_order"),
        {"id": invoice_id}
    ).fetchall()

    credit_number = _next_doc_number(ctx.studio_id, "credit", db)
    credit_id = str(uuid.uuid4())

    db.execute(
        text("""
            INSERT INTO invoices (
                id, studio_id, doc_type, doc_number, status,
                client_id, client_name, client_phone, client_email,
                business_name, business_type, business_number,
                business_address, business_city, business_phone, business_email, business_logo_url,
                subtotal_cents, vat_rate, vat_amount_cents, total_cents, tip_cents,
                payment_method, notes,
                credits_invoice_id, issued_by_id, issued_at
            ) VALUES (
                :id, :sid, 'credit', :dn, 'issued',
                :cid, :cname, :cphone, :cemail,
                :bname, :btype, :bnum,
                :baddr, :bcity, :bphone, :bemail, :blogo,
                :sub, :vr, :vat, :total, 0,
                :method, :notes,
                :orig_id, :uid, NOW()
            )
        """),
        {
            "id": credit_id, "sid": ctx.studio_id, "dn": credit_number,
            "cid": orig.client_id, "cname": orig.client_name,
            "cphone": orig.client_phone, "cemail": orig.client_email,
            "bname": orig.business_name, "btype": orig.business_type,
            "bnum": orig.business_number, "baddr": orig.business_address,
            "bcity": getattr(orig, "business_city", None),
            "bphone": orig.business_phone, "bemail": orig.business_email,
            "blogo": orig.business_logo_url,
            "sub": -(orig.subtotal_cents or 0),
            "vr": orig.vat_rate, "vat": -(orig.vat_amount_cents or 0),
            "total": -(orig.total_cents or 0),
            "method": body.payment_method or orig.payment_method,
            "notes": body.notes,
            "orig_id": invoice_id, "uid": ctx.user_id,
        }
    )

    # Copy items with negative amounts
    for i, item in enumerate(orig_items):
        db.execute(
            text("""
                INSERT INTO invoice_items
                    (id, invoice_id, description, quantity, unit_price_cents,
                     total_price_cents, product_id, service_id, sort_order)
                VALUES (:id, :inv, :desc, :qty, :up, :tp, :pid, :sid2, :sort)
            """),
            {
                "id": str(uuid.uuid4()), "inv": credit_id,
                "desc": item.description, "qty": float(item.quantity),
                "up": -(item.unit_price_cents), "tp": -(item.total_price_cents),
                "pid": item.product_id, "sid2": item.service_id, "sort": i,
            }
        )

    # Mark original as credited
    db.execute(
        text("UPDATE invoices SET status='credited', credited_by_id=:cid WHERE id=:id"),
        {"cid": credit_id, "id": invoice_id}
    )

    # Restore inventory
    for item in orig_items:
        if item.product_id:
            db.execute(
                text("""
                    UPDATE products SET stock_quantity = stock_quantity + :qty
                    WHERE id = :pid AND studio_id = :sid AND stock_quantity IS NOT NULL
                """),
                {"qty": int(item.quantity), "pid": item.product_id, "sid": ctx.studio_id}
            )

    db.commit()

    credit_row = db.execute(text("SELECT * FROM invoices WHERE id = :id"), {"id": credit_id}).fetchone()
    return _invoice_to_dict(credit_row)


# ── PDF auth — accepts Authorization header OR ?token= query param ────────────

def _pdf_auth(
    request: Request,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> AuthContext:
    auth_header = request.headers.get("Authorization", "")
    raw_token = auth_header[7:] if auth_header.startswith("Bearer ") else token
    if not raw_token:
        raise HTTPException(401, "Missing token")
    try:
        payload = decode_token(raw_token)
    except Exception:
        raise HTTPException(401, "Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(401, "Invalid token type")
    user_id = payload.get("user_id")
    studio_id = payload.get("studio_id")
    if not user_id or not studio_id:
        raise HTTPException(401, "Invalid token payload")
    user = db.query(User).filter(User.id == user_id, User.studio_id == studio_id, User.is_active == True).first()
    if not user:
        raise HTTPException(401, "User not found")
    return AuthContext(studio_id=user.studio_id, user_id=user.id, role=str(user.role))


# ── PDF Generation ────────────────────────────────────────────────────────────

@router.get("/{invoice_id}/pdf")
def download_pdf(
    invoice_id: str,
    ctx: AuthContext = Depends(_pdf_auth),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text("SELECT * FROM invoices WHERE id = :id AND studio_id = :sid"),
        {"id": invoice_id, "sid": ctx.studio_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "מסמך לא נמצא")

    items = db.execute(
        text("SELECT * FROM invoice_items WHERE invoice_id = :id ORDER BY sort_order"),
        {"id": invoice_id}
    ).fetchall()

    inv = dict(row._mapping)
    item_list = [dict(r._mapping) for r in items]

    try:
        pdf_bytes = _build_pdf(inv, item_list)
    except Exception as e:
        import traceback, logging
        logging.error(f"PDF generation failed for invoice {invoice_id}: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, f"שגיאה ביצירת PDF: {str(e)}")

    doc_label = DOC_TYPES.get(inv["doc_type"], "מסמך")
    filename = f"{doc_label}_{inv['doc_number']}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── PDF Font Cache (registered once per process) ──────────────────────────────

_PDF_FONT_CACHE: dict = {}

def _find_font_path(bold: bool = False) -> Optional[str]:
    """Locate a Hebrew-capable TTF font on any platform (Linux/Nix/Windows)."""
    import os, platform as _plat, glob as _glob, subprocess as _sub

    stem = "DejaVuSans-Bold" if bold else "DejaVuSans"

    # Windows (Arial)
    if _plat.system() == "Windows":
        p = "C:/Windows/Fonts/" + ("arialbd.ttf" if bold else "arial.ttf")
        if os.path.exists(p):
            return p

    # Standard Debian/Ubuntu paths
    for p in [
        f"/usr/share/fonts/truetype/dejavu/{stem}.ttf",
        f"/usr/share/fonts/dejavu/{stem}.ttf",
        f"/usr/share/fonts/truetype/{stem}.ttf",
        f"/usr/share/fonts/{stem}.ttf",
    ]:
        if os.path.exists(p):
            return p

    # Nix store (Railway Nixpacks installs here)
    try:
        for pat in [
            f"/nix/store/*/share/fonts/truetype/{stem}.ttf",
            f"/nix/store/*/share/fonts/**/{stem}.ttf",
            f"/nix/store/*/share/fonts/truetype/DejaVu/{stem}.ttf",
        ]:
            hits = _glob.glob(pat, recursive=True)
            if hits:
                return hits[0]
    except Exception:
        pass

    # fc-list fallback (fontconfig)
    try:
        style = "Bold" if bold else "Book"
        r = _sub.run(
            ["fc-list", f":family=DejaVu Sans:style={style}", "--format=%{{file}}\n"],
            capture_output=True, text=True, timeout=3,
        )
        if r.returncode == 0:
            for line in r.stdout.splitlines():
                path = line.strip()
                if path and os.path.exists(path):
                    return path
    except Exception:
        pass

    return None


def _get_pdf_fonts():
    global _PDF_FONT_CACHE
    if _PDF_FONT_CACHE:
        return _PDF_FONT_CACHE["reg"], _PDF_FONT_CACHE["bold"]

    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import logging as _log

    F_REG, F_BOLD = "Helvetica", "Helvetica-Bold"
    reg_path  = _find_font_path(False)
    bold_path = _find_font_path(True)
    _log.getLogger("bizcontrol.pdf").info("PDF fonts: reg=%s bold=%s", reg_path, bold_path)
    try:
        if reg_path:
            pdfmetrics.registerFont(TTFont("InvReg", reg_path))
            F_REG = "InvReg"
        if bold_path:
            pdfmetrics.registerFont(TTFont("InvBold", bold_path))
            F_BOLD = "InvBold"
    except Exception as e:
        _log.getLogger("bizcontrol.pdf").warning("Font registration failed: %s", e)
        F_REG, F_BOLD = "Helvetica", "Helvetica-Bold"

    _PDF_FONT_CACHE = {"reg": F_REG, "bold": F_BOLD}
    _log.getLogger("bizcontrol.pdf").info("PDF font cache: %s", _PDF_FONT_CACHE)
    return F_REG, F_BOLD


# ── PDF Builder ───────────────────────────────────────────────────────────────

def _build_pdf(inv: dict, items: list) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.platypus import Table, TableStyle

    F_REG, F_BOLD = _get_pdf_fonts()

    # Hebrew text helper: use bidi only when a real Unicode font is available
    _has_hebrew_font = F_REG not in ("Helvetica",)
    if _has_hebrew_font:
        try:
            from bidi.algorithm import get_display
            def h(t):
                try:
                    return get_display(str(t)) if t else ""
                except Exception:
                    return str(t) if t else ""
        except Exception:
            def h(t): return str(t) if t else ""
    else:
        # No Hebrew font — transliterate or just skip non-ASCII safely
        def h(t):
            if not t:
                return ""
            s = str(t)
            return "".join(c if ord(c) < 128 else "?" for c in s)

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    def fmt_ils(cents):
        if cents is None: return "₪0.00"
        sign = "-" if cents < 0 else ""
        return f"{sign}₪{abs(cents)/100:,.2f}"

    def fmt_date(dt):
        if not dt: return ""
        if isinstance(dt, str): return dt[:10]
        return dt.strftime("%d/%m/%Y")

    is_credit = inv.get("doc_type") == "credit"
    doc_label = DOC_TYPES.get(inv["doc_type"], inv["doc_type"])
    biz_type = inv.get("business_type", "osek_patur")
    has_vat = biz_type != "osek_patur"

    # ── Header ────────────────────────────────────────────────
    header_color = colors.HexColor("#c0392b") if is_credit else colors.HexColor("#1a1a2e")
    c.setFillColor(header_color)
    c.rect(0, H - 90, W, 90, fill=1, stroke=0)

    # Business name
    c.setFont(F_BOLD, 20)
    c.setFillColor(colors.white)
    c.drawCentredString(W/2, H - 45, h(inv.get("business_name", "")))

    # Doc type label
    c.setFont(F_REG, 11)
    c.setFillColor(colors.HexColor("#cccccc"))
    c.drawCentredString(W/2, H - 65, h(doc_label))

    # Doc number (top right)
    c.setFont(F_BOLD, 14)
    c.setFillColor(colors.white)
    c.drawRightString(W - 1.5*cm, H - 45, h(f"#{inv['doc_number']}"))

    # Credit note banner
    if is_credit and inv.get("credits_invoice_id"):
        orig_num = inv.get("credits_invoice_id", "")
        c.setFont(F_REG, 9)
        c.setFillColor(colors.HexColor("#ffcccc"))
        c.drawRightString(W - 1.5*cm, H - 65, h(f"זיכוי עבור מסמך #{orig_num[:8]}"))

    y = H - 100

    # ── Business info bar ──────────────────────────────────────
    c.setFillColor(colors.HexColor("#f8f9fa"))
    c.rect(0, y - 55, W, 55, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#333333"))

    biz_line1_parts = []
    if inv.get("business_number"):
        biz_line1_parts.append(f"ח.פ/ע.מ: {inv['business_number']}")
    if inv.get("business_address"):
        biz_line1_parts.append(inv["business_address"])
    if inv.get("business_city"):
        biz_line1_parts.append(inv["business_city"])

    biz_line2_parts = []
    if inv.get("business_phone"):
        biz_line2_parts.append(f"טל: {inv['business_phone']}")
    if inv.get("business_email"):
        biz_line2_parts.append(inv["business_email"])

    c.setFont(F_REG, 9)
    if biz_line1_parts:
        c.drawCentredString(W/2, y - 22, h(" | ".join(biz_line1_parts)))
    if biz_line2_parts:
        c.drawCentredString(W/2, y - 38, h(" | ".join(biz_line2_parts)))

    # Date
    c.setFont(F_BOLD, 9)
    c.setFillColor(colors.HexColor("#666666"))
    issued_at = inv.get("issued_at")
    if isinstance(issued_at, datetime):
        date_str = issued_at.strftime("%d/%m/%Y %H:%M")
    elif isinstance(issued_at, str):
        date_str = issued_at[:16].replace("T", " ")
    else:
        date_str = ""
    c.drawString(1.5*cm, y - 22, h(f"תאריך: {date_str}"))

    y -= 65

    # ── Client section ─────────────────────────────────────────
    if inv.get("client_name") or inv.get("client_phone"):
        c.setFont(F_BOLD, 10)
        c.setFillColor(colors.HexColor("#1a1a2e"))
        c.drawRightString(W - 1.5*cm, y, h("לכבוד:"))
        y -= 16

        def cfield(label, val):
            nonlocal y
            if not val: return
            c.setFont(F_BOLD, 9)
            c.setFillColor(colors.HexColor("#666666"))
            c.drawRightString(W - 1.5*cm, y, h(f"{label}:"))
            c.setFont(F_REG, 9)
            c.setFillColor(colors.HexColor("#222222"))
            c.drawRightString(W - 5.5*cm, y, h(val))
            y -= 14

        cfield("שם", inv.get("client_name"))
        cfield("טלפון", inv.get("client_phone"))
        cfield("אימייל", inv.get("client_email"))
        cfield("כתובת", inv.get("client_address"))
        cfield("ח.פ", inv.get("client_business_number"))
        y -= 6

    # Divider
    c.setStrokeColor(colors.HexColor("#e5e7eb"))
    c.setLineWidth(0.5)
    c.line(1.5*cm, y, W - 1.5*cm, y)
    y -= 14

    # ── Items table ────────────────────────────────────────────
    col_widths = [9.5*cm, 2*cm, 3*cm, 3*cm]
    table_data = [[h("תיאור"), h("כמות"), h("מחיר יחידה"), h("סה\"כ")]]

    for item in items:
        table_data.append([
            h(item.get("description", "")),
            h(str(item.get("quantity", 1)).rstrip("0").rstrip(".")),
            h(fmt_ils(item.get("unit_price_cents", 0))),
            h(fmt_ils(item.get("total_price_cents", 0))),
        ])

    tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), F_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 1), (-1, -1), F_REG),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (1, 1), (-1, -1), "CENTER"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8f9fa")]),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e5e7eb")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))

    tbl_w, tbl_h = tbl.wrapOn(c, W - 3*cm, 400)
    if y - tbl_h < 2*cm:
        c.showPage()
        y = H - 2*cm
    tbl.drawOn(c, 1.5*cm, y - tbl_h)
    y -= tbl_h + 12

    # ── Totals ─────────────────────────────────────────────────
    def total_row(label, amount, bold=False, color=None):
        nonlocal y
        font = F_BOLD if bold else F_REG
        sz = 11 if bold else 9
        c.setFont(font, sz)
        c.setFillColor(color or colors.HexColor("#333333"))
        c.drawRightString(W - 1.5*cm, y, h(label))
        c.drawRightString(W - 7*cm, y, h(amount))
        if bold:
            c.setStrokeColor(color or colors.HexColor("#333333"))
            c.setLineWidth(0.5)
            c.line(W - 9*cm, y - 3, W - 1.5*cm, y - 3)
        y -= 16

    subtotal = inv.get("subtotal_cents", 0) or 0
    vat_amount = inv.get("vat_amount_cents", 0) or 0
    total = inv.get("total_cents", 0) or 0
    tip = inv.get("tip_cents", 0) or 0
    vat_rate_val = float(inv.get("vat_rate") or 18)

    if has_vat:
        total_row("סכום לפני מע\"מ:", fmt_ils(subtotal))
        total_row(f"מע\"מ {vat_rate_val:.0f}%:", fmt_ils(vat_amount))
        if tip > 0:
            total_row("טיפ:", fmt_ils(tip))

    total_color = colors.HexColor("#c0392b") if is_credit else colors.HexColor("#1a1a2e")
    total_row("סה\"כ לתשלום:", fmt_ils(total), bold=True, color=total_color)

    if not has_vat:
        c.setFont(F_REG, 8)
        c.setFillColor(colors.HexColor("#999999"))
        c.drawRightString(W - 1.5*cm, y, h("* עוסק פטור, אינו חייב במע\"מ"))
        y -= 14

    y -= 8

    # ── Payment method ────────────────────────────────────────
    if inv.get("payment_method"):
        method_label = METHOD_LABELS.get(inv["payment_method"], inv["payment_method"])
        c.setFont(F_BOLD, 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawRightString(W - 1.5*cm, y, h(f"אמצעי תשלום: {method_label}"))
        if inv.get("payment_reference"):
            c.setFont(F_REG, 9)
            y -= 13
            c.drawRightString(W - 1.5*cm, y, h(f"אסמכתה: {inv['payment_reference']}"))
        y -= 16

    # ── Notes & Terms ─────────────────────────────────────────
    if inv.get("notes"):
        c.setFont(F_BOLD, 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawRightString(W - 1.5*cm, y, h("הערות:"))
        y -= 13
        c.setFont(F_REG, 9)
        c.drawRightString(W - 1.5*cm, y, h(inv["notes"]))
        y -= 16

    if inv.get("payment_terms"):
        c.setFont(F_REG, 9)
        c.setFillColor(colors.HexColor("#888888"))
        c.drawRightString(W - 1.5*cm, y, h(f"תנאי תשלום: {inv['payment_terms']}"))
        y -= 16

    # Signature
    if inv.get("signature_url"):
        try:
            from reportlab.lib.utils import ImageReader
            import urllib.request
            sig_url = inv["signature_url"]
            if sig_url.startswith("http"):
                with urllib.request.urlopen(sig_url, timeout=3) as resp:
                    sig_img = ImageReader(io.BytesIO(resp.read()))
            else:
                sig_img = ImageReader(sig_url)
            c.drawImage(sig_img, W - 6*cm, y - 30, width=80, height=30,
                       preserveAspectRatio=True, mask="auto")
        except Exception:
            pass

    # ── Footer ────────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#f0f0f0"))
    c.rect(0, 0, W, 28, fill=1, stroke=0)
    c.setFont(F_REG, 8)
    c.setFillColor(colors.HexColor("#888888"))
    c.drawCentredString(W/2, 10, h("הופק באמצעות מערכת BizControl | מסמך ממוחשב חתום דיגיטלית"))

    c.save()
    return buf.getvalue()

