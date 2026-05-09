"""
PDF generation service — receipts and payroll slips.
Uses reportlab with Hebrew RTL via python-bidi.
"""
from __future__ import annotations

import io
import os
import platform
from datetime import datetime, timezone
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle

try:
    from bidi.algorithm import get_display
    _BIDI = True
except ImportError:
    _BIDI = False


# ── Font setup ─────────────────────────────────────────────────────────────────

def _font_path(bold: bool = False) -> str | None:
    candidates = []
    if platform.system() == "Windows":
        base = "C:/Windows/Fonts/"
        candidates = [base + ("arialbd.ttf" if bold else "arial.ttf")]
    else:
        stem = "DejaVuSans-Bold" if bold else "DejaVuSans"
        candidates = [
            f"/usr/share/fonts/truetype/dejavu/{stem}.ttf",
            f"/usr/share/fonts/dejavu/{stem}.ttf",
        ]
    return next((p for p in candidates if os.path.exists(p)), None)


_fonts_registered = False

def _ensure_fonts() -> tuple[str, str]:
    global _fonts_registered
    regular_path = _font_path(False)
    bold_path = _font_path(True)

    if not _fonts_registered and regular_path:
        pdfmetrics.registerFont(TTFont("HebRegular", regular_path))
        if bold_path:
            pdfmetrics.registerFont(TTFont("HebBold", bold_path))
        _fonts_registered = True

    if regular_path:
        return "HebRegular", "HebBold" if bold_path else "HebRegular"
    return "Helvetica", "Helvetica-Bold"


def h(text: Any) -> str:
    """Prepare Hebrew text for ReportLab (RTL display order)."""
    s = str(text) if text is not None else ""
    if _BIDI and s:
        return get_display(s)
    return s


# ── Helpers ────────────────────────────────────────────────────────────────────

def _fmt_ils(cents: int) -> str:
    return f"₪{cents / 100:,.2f}"

def _fmt_date(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.strftime("%d/%m/%Y %H:%M")
    return local

METHOD_LABELS = {
    "cash": "מזומן",
    "bit": "Bit",
    "paybox": "Paybox",
    "card": "כרטיס אשראי",
    "bank_transfer": "העברה בנקאית",
    "other": "אחר",
}

TYPE_LABELS = {
    "deposit": "מקדמה",
    "payment": "תשלום",
    "refund": "זיכוי",
}


# ── Receipt PDF ────────────────────────────────────────────────────────────────

def generate_receipt_pdf(
    payment: Any,
    appointment: Any,
    client: Any,
    studio_name: str,
    studio_slug: str,
) -> bytes:
    font_reg, font_bold = _ensure_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # ── Header band ────────────────────────────────────────
    c.setFillColor(colors.HexColor("#111111"))
    c.rect(0, H - 80, W, 80, fill=1, stroke=0)

    c.setFont(font_bold, 22)
    c.setFillColor(colors.white)
    c.drawCentredString(W / 2, H - 50, h(studio_name))

    c.setFont(font_reg, 10)
    c.setFillColor(colors.HexColor("#aaaaaa"))
    c.drawCentredString(W / 2, H - 68, h("קבלה / Receipt"))

    # ── Receipt number + date ──────────────────────────────
    c.setFillColor(colors.HexColor("#333333"))
    c.setFont(font_bold, 11)
    y = H - 110
    pay_id_short = str(payment.id)[:8].upper()
    c.drawRightString(W - 2 * cm, y, h(f"מספר קבלה: {pay_id_short}"))
    c.setFont(font_reg, 10)
    c.drawRightString(W - 2 * cm, y - 18, h(f"תאריך: {_fmt_date(payment.created_at)}"))

    # ── Divider ────────────────────────────────────────────
    y -= 35
    c.setStrokeColor(colors.HexColor("#e5e7eb"))
    c.setLineWidth(1)
    c.line(2 * cm, y, W - 2 * cm, y)
    y -= 20

    # ── Client section ─────────────────────────────────────
    def row(label: str, value: str, ypos: float) -> float:
        c.setFont(font_bold, 10)
        c.setFillColor(colors.HexColor("#6b7280"))
        c.drawRightString(W - 2 * cm, ypos, h(label))
        c.setFont(font_reg, 10)
        c.setFillColor(colors.HexColor("#111111"))
        c.drawRightString(W - 7 * cm, ypos, h(value))
        return ypos - 18

    c.setFont(font_bold, 12)
    c.setFillColor(colors.HexColor("#111111"))
    c.drawRightString(W - 2 * cm, y, h("פרטי לקוח"))
    y -= 20

    y = row("שם", client.full_name or "", y)
    if client.phone:
        y = row("טלפון", client.phone, y)
    if client.email:
        y = row("אימייל", client.email, y)

    y -= 10
    c.setStrokeColor(colors.HexColor("#e5e7eb"))
    c.line(2 * cm, y, W - 2 * cm, y)
    y -= 20

    # ── Appointment section ────────────────────────────────
    c.setFont(font_bold, 12)
    c.setFillColor(colors.HexColor("#111111"))
    c.drawRightString(W - 2 * cm, y, h("פרטי תור"))
    y -= 20

    if appointment:
        y = row("שירות", appointment.title or "תור", y)
        y = row("תאריך תור", _fmt_date(appointment.starts_at), y)

    y -= 10
    c.setStrokeColor(colors.HexColor("#e5e7eb"))
    c.line(2 * cm, y, W - 2 * cm, y)
    y -= 20

    # ── Payment section ────────────────────────────────────
    c.setFont(font_bold, 12)
    c.setFillColor(colors.HexColor("#111111"))
    c.drawRightString(W - 2 * cm, y, h("פרטי תשלום"))
    y -= 20

    y = row("סוג", TYPE_LABELS.get(payment.type, payment.type), y)
    y = row("אמצעי תשלום", METHOD_LABELS.get(str(payment.method or ""), payment.method or ""), y)
    y = row("סטטוס", "שולם" if payment.status == "paid" else payment.status, y)
    if payment.notes:
        y = row("הערות", payment.notes, y)

    y -= 15
    # Amount highlight box
    c.setFillColor(colors.HexColor("#f0fdf4"))
    c.setStrokeColor(colors.HexColor("#86efac"))
    c.roundRect(2 * cm, y - 15, W - 4 * cm, 38, 6, fill=1, stroke=1)
    c.setFont(font_bold, 16)
    c.setFillColor(colors.HexColor("#166534"))
    c.drawCentredString(W / 2, y + 8, h(f"סכום: {_fmt_ils(payment.amount_cents)}"))
    y -= 35

    # ── Footer ─────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#f9fafb"))
    c.rect(0, 0, W, 50, fill=1, stroke=0)
    c.setFont(font_reg, 8)
    c.setFillColor(colors.HexColor("#9ca3af"))
    c.drawCentredString(W / 2, 30, h("מסמך זה הופק אוטומטית על ידי מערכת BizControl"))
    c.drawCentredString(W / 2, 16, h(f"סטודיו: {studio_slug} | {studio_name}"))

    c.showPage()
    c.save()
    return buf.getvalue()


# ── Tax Invoice PDF ────────────────────────────────────────────────────────────

def generate_invoice_pdf(
    payment: Any,
    appointment: Any,
    client: Any,
    studio_name: str,
    studio_slug: str,
    studio_address: str | None = None,
    bank_name: str | None = None,
    bank_branch: str | None = None,
    bank_account: str | None = None,
    vat_percent: float = 18.0,
) -> bytes:
    font_reg, font_bold = _ensure_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # Invoice number = first 8 chars of payment id, uppercase
    inv_number = str(payment.id)[:8].upper()

    # Financial breakdown
    total_cents  = payment.amount_cents
    total_ils    = total_cents / 100
    vat_rate     = vat_percent / 100
    vat_ils      = round(total_ils * vat_rate / (1 + vat_rate), 2)
    net_ils      = round(total_ils - vat_ils, 2)

    # ── Header band ─────────────────────────────────────────
    c.setFillColor(colors.HexColor("#111111"))
    c.rect(0, H - 90, W, 90, fill=1, stroke=0)

    c.setFont(font_bold, 22)
    c.setFillColor(colors.white)
    c.drawCentredString(W / 2, H - 45, h(studio_name))

    c.setFont(font_reg, 10)
    c.setFillColor(colors.HexColor("#aaaaaa"))
    c.drawCentredString(W / 2, H - 63, h("חשבונית מס / Tax Invoice"))
    if studio_address:
        c.setFont(font_reg, 9)
        c.drawCentredString(W / 2, H - 78, h(studio_address))

    # ── Invoice meta ─────────────────────────────────────────
    y = H - 115
    c.setFont(font_bold, 10)
    c.setFillColor(colors.HexColor("#333333"))
    c.drawRightString(W - 2 * cm, y, h(f"מספר חשבונית: {inv_number}"))
    c.setFont(font_reg, 10)
    c.drawRightString(W - 2 * cm, y - 16, h(f"תאריך הפקה: {_fmt_date(payment.created_at)}"))

    # Divider
    y -= 35
    c.setStrokeColor(colors.HexColor("#e5e7eb"))
    c.line(2 * cm, y, W - 2 * cm, y)
    y -= 18

    def row(label: str, value: str, ypos: float) -> float:
        c.setFont(font_bold, 10)
        c.setFillColor(colors.HexColor("#6b7280"))
        c.drawRightString(W - 2 * cm, ypos, h(label))
        c.setFont(font_reg, 10)
        c.setFillColor(colors.HexColor("#111111"))
        c.drawRightString(W - 7 * cm, ypos, h(value))
        return ypos - 18

    # ── Client details ──────────────────────────────────────
    c.setFont(font_bold, 11)
    c.setFillColor(colors.HexColor("#111111"))
    c.drawRightString(W - 2 * cm, y, h("פרטי לקוח"))
    y -= 20
    if client:
        y = row("שם", client.full_name or "", y)
        if client.phone:
            y = row("טלפון", client.phone, y)
        if client.email:
            y = row("אימייל", client.email, y)

    y -= 8
    c.setStrokeColor(colors.HexColor("#e5e7eb"))
    c.line(2 * cm, y, W - 2 * cm, y)
    y -= 18

    # ── Service details ─────────────────────────────────────
    c.setFont(font_bold, 11)
    c.setFillColor(colors.HexColor("#111111"))
    c.drawRightString(W - 2 * cm, y, h("פרטי שירות"))
    y -= 20
    if appointment:
        y = row("שירות", appointment.title or "תור", y)
        y = row("תאריך שירות", _fmt_date(appointment.starts_at), y)
    y = row("אמצעי תשלום", METHOD_LABELS.get(str(payment.method or ""), str(payment.method or "")), y)

    y -= 8
    c.setStrokeColor(colors.HexColor("#e5e7eb"))
    c.line(2 * cm, y, W - 2 * cm, y)
    y -= 18

    # ── Financial breakdown ─────────────────────────────────
    c.setFont(font_bold, 11)
    c.setFillColor(colors.HexColor("#111111"))
    c.drawRightString(W - 2 * cm, y, h("פירוט כספי"))
    y -= 20

    y = row("מחיר לפני מע\"מ", f"₪{net_ils:,.2f}", y)
    y = row(f"מע\"מ ({vat_percent:.0f}%)", f"₪{vat_ils:,.2f}", y)

    y -= 10
    # Total highlight
    c.setFillColor(colors.HexColor("#f0fdf4"))
    c.setStrokeColor(colors.HexColor("#86efac"))
    c.roundRect(2 * cm, y - 15, W - 4 * cm, 38, 6, fill=1, stroke=1)
    c.setFont(font_bold, 15)
    c.setFillColor(colors.HexColor("#166534"))
    c.drawCentredString(W / 2, y + 7, h(f"סה\"כ לתשלום: ₪{total_ils:,.2f}"))
    y -= 35

    # ── Bank details (if any) ────────────────────────────────
    if any([bank_name, bank_branch, bank_account]):
        y -= 12
        c.setStrokeColor(colors.HexColor("#e5e7eb"))
        c.line(2 * cm, y, W - 2 * cm, y)
        y -= 16
        c.setFont(font_bold, 10)
        c.setFillColor(colors.HexColor("#333333"))
        c.drawRightString(W - 2 * cm, y, h("פרטי בנק להעברה"))
        y -= 16
        if bank_name:
            y = row("בנק", bank_name, y)
        if bank_branch:
            y = row("סניף", bank_branch, y)
        if bank_account:
            y = row("מספר חשבון", bank_account, y)

    # ── Footer ──────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#f9fafb"))
    c.rect(0, 0, W, 50, fill=1, stroke=0)
    c.setFont(font_reg, 8)
    c.setFillColor(colors.HexColor("#9ca3af"))
    c.drawCentredString(W / 2, 30, h("מסמך זה הופק אוטומטית על ידי מערכת BizControl"))
    c.drawCentredString(W / 2, 16, h(f"סטודיו: {studio_slug} | {studio_name}"))

    c.showPage()
    c.save()
    return buf.getvalue()


# ── Payroll PDF ────────────────────────────────────────────────────────────────

def generate_payroll_pdf(
    items: list[dict],
    grand_total: float,
    period_start: datetime,
    period_end: datetime,
    studio_name: str,
) -> bytes:
    font_reg, font_bold = _ensure_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # ── Header ─────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#111111"))
    c.rect(0, H - 80, W, 80, fill=1, stroke=0)
    c.setFont(font_bold, 20)
    c.setFillColor(colors.white)
    c.drawCentredString(W / 2, H - 48, h(studio_name))
    c.setFont(font_reg, 10)
    c.setFillColor(colors.HexColor("#aaaaaa"))
    c.drawCentredString(W / 2, H - 66, h("דוח שכר"))

    # ── Period ──────────────────────────────────────────────
    y = H - 105
    c.setFont(font_reg, 10)
    c.setFillColor(colors.HexColor("#555555"))
    period_str = f"{_fmt_date(period_start)} — {_fmt_date(period_end)}"
    c.drawCentredString(W / 2, y, h(f"תקופה: {period_str}"))
    y -= 25

    # ── Table ───────────────────────────────────────────────
    col_w = [(W - 4 * cm) / 6] * 6

    headers = [h(t) for t in ["שם", "שעות", "שכר שעתי", "עמלה", "סה\"כ", "סוג שכר"]]
    table_data = [headers]

    for item in items:
        pay_type_label = {"hourly": "שעתי", "commission": "עמלה", "none": "ללא"}.get(
            item.get("pay_type", "none"), item.get("pay_type", "")
        )
        table_data.append([
            h(item.get("display_name", "")),
            f"{float(item.get('total_hours', 0)):.1f}",
            f"₪{float(item.get('hourly_pay', 0)):.2f}",
            f"₪{float(item.get('commission_pay', 0)):.2f}",
            f"₪{float(item.get('total_pay', 0)):.2f}",
            h(pay_type_label),
        ])

    # Grand total row
    table_data.append([
        h("סה\"כ"), "", "", "", f"₪{float(grand_total):.2f}", ""
    ])

    tbl = Table(table_data, colWidths=col_w)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), font_bold),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#f9fafb")]),
        ("FONTNAME", (0, 1), (-1, -2), font_reg),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        # Grand total row
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f0fdf4")),
        ("FONTNAME", (0, -1), (-1, -1), font_bold),
        ("TEXTCOLOR", (4, -1), (4, -1), colors.HexColor("#166534")),
        ("ROWHEIGHT", (0, 0), (-1, -1), 22),
    ]))

    tbl_w, tbl_h = tbl.wrapOn(c, W - 4 * cm, H)
    tbl.drawOn(c, 2 * cm, y - tbl_h)
    y = y - tbl_h - 20

    # ── Footer ─────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#f9fafb"))
    c.rect(0, 0, W, 40, fill=1, stroke=0)
    c.setFont(font_reg, 8)
    c.setFillColor(colors.HexColor("#9ca3af"))
    c.drawCentredString(W / 2, 22, h("דוח זה הופק אוטומטית על ידי מערכת BizControl"))
    c.drawCentredString(W / 2, 10, h(f"הופק ב: {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M')} UTC"))

    c.showPage()
    c.save()
    return buf.getvalue()
