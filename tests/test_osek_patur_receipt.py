"""A VAT-exempt business (עוסק פטור) — a receipt, never a tax invoice; no VAT; the note on the receipt says so. An
authorized business (עוסק מורשה) — a tax invoice/receipt, the price including 18% VAT (owner, 2026-10-13)."""
from reportlab.pdfgen.canvas import Canvas

from app.api.invoice_routes import _build_pdf
from tests.conftest import register_and_login


def _issue(client, h, business_type):
    r = client.put("/api/invoices/settings", headers=h, json={"business_type": business_type, "business_name": "סטודיו בדיקה",
                                                                "business_number": "123456789"})
    assert r.status_code == 200, r.text
    r = client.post("/api/invoices", headers=h, json={
        "doc_type": "invoice_tax_receipt", "client_name": "דנה כהן", "payment_method": "cash",
        "items": [{"description": "קעקוע", "quantity": 1, "unit_price_cents": 140000}]})
    assert r.status_code == 200, r.text
    return r.json()


def _pdf_words(monkeypatch, inv: dict) -> str:
    """Everything the receipt's PDF writes, read in both directions (Hebrew is drawn right to left)."""
    drawn: list[str] = []
    for name in ("drawString", "drawRightString", "drawCentredString"):
        real = getattr(Canvas, name)
        monkeypatch.setattr(Canvas, name, lambda self, x, y, text, *a, _real=real, **k: (drawn.append(str(text)), _real(self, x, y, text, *a, **k))[1])
    _build_pdf(inv, [{"description": "קעקוע", "quantity": 1, "unit_price_cents": inv["subtotal_cents"],
                      "total_price_cents": inv["subtotal_cents"]}])
    return " ".join(drawn + [t[::-1] for t in drawn])


def test_a_vat_exempt_business_issues_a_receipt_without_vat(client, monkeypatch):
    h = register_and_login(client, "patur-shop", "owner@patur-shop.com")
    inv = _issue(client, h, "osek_patur")
    assert inv["doc_type"] == "receipt"                       # asked for a tax invoice/receipt — a receipt
    assert inv["vat_amount_cents"] == 0 and inv["total_cents"] == 140000 and inv["subtotal_cents"] == 140000
    words = _pdf_words(monkeypatch, inv)
    assert "עוסק פטור" in words
    assert "לפני מע" not in words


def test_an_authorized_business_includes_vat_in_the_price_paid(client, monkeypatch):
    h = register_and_login(client, "murshe-shop", "owner@murshe-shop.com")
    inv = _issue(client, h, "osek_murshe")
    assert inv["doc_type"] == "invoice_tax_receipt"
    # the client paid ₪1,400 — the receipt is for ₪1,400, the VAT inside it (it used to add 18% on top: ₪1,652)
    assert inv["total_cents"] == 140000 and inv["subtotal_cents"] == 118644 and inv["vat_amount_cents"] == 21356
    words = _pdf_words(monkeypatch, inv)
    assert "לפני מע" in words and "עוסק פטור" not in words

    # the till's receipt: several lines and the discount — the total is what was paid, the lines add up
    r = client.post("/api/invoices", headers=h, json={"doc_type": "invoice_tax_receipt", "payment_method": "cash", "items": [
        {"description": "טיפול", "quantity": 1, "unit_price_cents": 100000},
        {"description": "קרם", "quantity": 2, "unit_price_cents": 5000},
        {"description": "הנחה", "quantity": 1, "unit_price_cents": -10000}]})
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["total_cents"] == 100000 and inv["subtotal_cents"] + inv["vat_amount_cents"] == 100000
    full = client.get(f"/api/invoices/{inv['id']}", headers=h).json()
    assert sum(i["total_price_cents"] for i in full["items"]) == inv["subtotal_cents"]


def test_a_business_in_eilat_issues_tax_invoices_at_zero_vat(client, monkeypatch):
    """Eilat is a free-trade zone — an authorized business registered there sets VAT 0% when it sets up its receipts:
    the tax invoice/receipt shows VAT 0% and says why (services/vat.py)."""
    h = register_and_login(client, "eilat-shop", "owner@eilat-shop.com")
    r = client.post("/api/invoices/settings/complete", headers=h, json={
        "business_type": "osek_murshe", "business_name": "סטודיו אילת", "business_number": "123456789", "eilat": True})
    assert r.status_code == 200, r.text
    assert client.get("/api/invoices/settings", headers=h).json()["vat_rate"] == 0
    r = client.post("/api/invoices", headers=h, json={"doc_type": "invoice_tax_receipt", "payment_method": "cash",
                                                       "items": [{"description": "קעקוע", "quantity": 1, "unit_price_cents": 140000}]})
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["doc_type"] == "invoice_tax_receipt"
    assert inv["total_cents"] == 140000 and inv["vat_amount_cents"] == 0 and inv["subtotal_cents"] == 140000
    assert inv["shows_vat"] is True and "אילת" in inv["vat_note"]
    words = _pdf_words(monkeypatch, inv)
    assert "אילת" in words and "עוסק פטור" not in words
