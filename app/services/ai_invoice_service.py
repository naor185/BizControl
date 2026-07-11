"""
AI Invoice Parsing Service — v4 (Google Document AI + robust Hebrew OCR parsing).
Handles both LTR and RTL OCR output for Israeli receipts and invoices.
"""
import json
import os
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional


class InvoiceParseResult:
    def __init__(
        self,
        business_name: Optional[str],
        invoice_number: Optional[str],
        total_amount: Optional[Decimal],
        vat_amount: Optional[Decimal],
        pretax_amount: Optional[Decimal],
        invoice_date: Optional[date],
        payment_method: Optional[str],
        raw_text: str = "",
    ):
        self.business_name = business_name
        self.invoice_number = invoice_number
        self.total_amount = total_amount
        self.vat_amount = vat_amount
        self.pretax_amount = pretax_amount
        self.invoice_date = invoice_date
        self.payment_method = payment_method
        self.raw_text = raw_text


# ---------- helpers ----------------------------------------------------------

def _clean_amount(text: str) -> Optional[Decimal]:
    if not text:
        return None
    cleaned = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        val = Decimal(cleaned).quantize(Decimal("0.01"))
        return val if val > Decimal("0") else None
    except InvalidOperation:
        return None


def _money_value_to_decimal(money) -> Optional[Decimal]:
    try:
        units = getattr(money, "units", 0) or 0
        nanos = getattr(money, "nanos", 0) or 0
        return Decimal(str(units)) + Decimal(str(nanos)) / Decimal("1000000000")
    except Exception:
        return None


def _parse_date(text: str) -> Optional[date]:
    if not text:
        return None
    for fmt in ("%d/%m/%Y", "%d.%m.%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            from datetime import datetime
            return datetime.strptime(text.strip(), fmt).date()
        except ValueError:
            pass
    return None


# ── OCR text amount extractors (handles RTL + LTR) ───────────────────────────

_AMT = r'([0-9]+\.[0-9]{1,2})'          # decimal amount group
_OPT_NIS = r'(?:NIS|₪|SIN|NlS)?\s*'    # optional currency prefix

def _find_labeled_amount(text: str, label_patterns: list[str], rtl: bool = True) -> Optional[Decimal]:
    """
    Find an amount next to a Hebrew label.
    Tries both LTR (label → amount) and RTL (amount → label) formats.
    """
    for label in label_patterns:
        # LTR: label comes first, number after
        ltr = re.search(label + r'[^0-9\n]{0,30}' + _AMT, text, re.IGNORECASE)
        if ltr:
            val = _clean_amount(ltr.group(1))
            if val and val > Decimal("0.10"):
                return val
        # RTL: number comes first, label after
        rtl_pat = _AMT + r'[^0-9\n]{0,15}' + label
        rtl_m = re.search(rtl_pat, text, re.IGNORECASE)
        if rtl_m:
            val = _clean_amount(rtl_m.group(1))
            if val and val > Decimal("0.10"):
                return val
    return None


def _parse_hebrew_total(text: str) -> Optional[Decimal]:
    """Total INCLUDING VAT — סה"כ כולל מע"מ / סה"כ שולם / סכום לתשלום."""
    labels = [
        r'סה.כ\s+כולל\s+מע.מ',
        r'סה.כ\s+שולם',
        r'סה.כ\s+לשלם',
        r'סכום\s+לתשלום',
        r'סה.כ\s+לתשלום',
        r'סה.כ\s+לחיוב',
        r'לתשלום',
    ]
    return _find_labeled_amount(text, labels)


def _parse_hebrew_vat(text: str) -> Optional[Decimal]:
    """VAT AMOUNT (not rate, not taxable base) — the actual ₪ amount of VAT."""
    # Strategy: find a line with VAT% and a decimal amount,
    # but NOT lines about "taxable base" (סכום החייב).
    candidates = []

    # Pattern 1: "מע"מ XX.XX% AMOUNT" (LTR)
    for m in re.finditer(r'מע.מ\s+([0-9]+\.?[0-9]*)%\s+([0-9]+\.[0-9]{1,2})', text):
        rate = Decimal(m.group(1))
        if Decimal("5") < rate < Decimal("30"):  # reasonable VAT rate
            val = _clean_amount(m.group(2))
            if val:
                candidates.append((val, m.start()))

    # Pattern 2: "AMOUNT XX.XX% מע"מ" (RTL) — not preceded by "חייב"
    for m in re.finditer(r'([0-9]+\.[0-9]{1,2})\s+([0-9]+\.?[0-9]*)%\s+מע.מ', text):
        # Skip if followed by "כולל" (that's the total line)
        surrounding = text[max(0, m.start()-20):m.end()+20]
        if 'כולל' in surrounding or 'חייב' in surrounding:
            continue
        rate = Decimal(m.group(2))
        if Decimal("5") < rate < Decimal("30"):
            val = _clean_amount(m.group(1))
            if val:
                candidates.append((val, m.start()))

    # Pattern 3: standalone "מע"מ" line followed/preceded by decimal
    for m in re.finditer(r'(?:^|[\n\r])[^\n\r]*מע.מ[^\n\r]*[\n\r]+[^\n\r]*?([0-9]+\.[0-9]{1,2})', text, re.MULTILINE):
        val = _clean_amount(m.group(1))
        if val and val < Decimal("1000"):
            candidates.append((val, m.start()))

    if not candidates:
        return None
    # Return the VAT from the LAST matching occurrence (usually at bottom of receipt)
    candidates.sort(key=lambda x: x[1])
    return candidates[-1][0]


def _parse_hebrew_pretax(text: str) -> Optional[Decimal]:
    """Amount BEFORE VAT — סה"כ לפני מע"מ / סכום החייב."""
    labels = [
        r'סה.כ\s+לפני\s+מע.מ',
        r'סכום\s+החייב\s+מע.מ',
        r'חייבים?\s+במע.מ',
        r'בסיס\s+מע.מ',
    ]
    return _find_labeled_amount(text, labels)


def _parse_hebrew_invoice_number(text: str) -> Optional[str]:
    patterns = [
        r'חשבון\s+קבלה[^\n]*[-–]\s*(P\w+)',
        r'\b(P\d{6,})\b',
        r'מספר\s+(?:חשבונית|קבלה|מסמך)[:\s]+(\w+)',
        r'מס[\'״״]\s*(?:חשבונית|קבלה)[:\s]+(\w+)',
        r'(?:Invoice|Receipt)\s*[#:]\s*(\w+)',
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _parse_payment_method(text: str) -> Optional[str]:
    """Detect payment method from OCR text."""
    t = text.lower()
    if any(w in t for w in ['אשראי', 'credit', 'ויזה', 'visa', 'מסטרכרד', 'mastercard', 'אמקס', 'amex']):
        return "אשראי"
    if any(w in t for w in ['מזומן', 'cash', 'כסף מזומן']):
        return "מזומן"
    if any(w in t for w in ['ביט', 'bit', 'paybox', 'פייבוקס']):
        return "ביט/פייבוקס"
    if any(w in t for w in ['העברה', 'bank transfer', 'העברה בנקאית']):
        return "העברה בנקאית"
    if any(w in t for w in ['צ\'ק', "צ'ק", 'cheque', 'check']):
        return "צ'ק"
    return None


# ---------- main service -----------------------------------------------------

class AIInvoiceService:

    def __init__(self):
        adc_json = os.getenv("GOOGLE_ADC_JSON", "").strip()
        sa_json = os.getenv("GOOGLE_SA_JSON", "").strip()
        project_id = os.getenv("DOCUMENT_AI_PROJECT_ID", "").strip()
        processor_id = os.getenv("DOCUMENT_AI_PROCESSOR_ID", "").strip()
        location = os.getenv("DOCUMENT_AI_LOCATION", "us").strip()
        openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

        google_creds_json = adc_json or sa_json

        if google_creds_json and project_id and processor_id:
            self._provider = "documentai"
            self._creds_info = json.loads(google_creds_json)
            self._project_id = project_id
            self._processor_id = processor_id
            self._location = location
        elif openai_key and openai_key.startswith("sk-"):
            self._provider = "openai"
            self._openai_key = openai_key
        elif gemini_key and gemini_key.startswith("AIza"):
            self._provider = "gemini"
            self._gemini_key = gemini_key
        elif openai_key and openai_key.startswith("AIza"):
            # GEMINI_API_KEY stored in OPENAI_API_KEY var
            self._provider = "gemini"
            self._gemini_key = openai_key
        else:
            raise ValueError(
                "סריקת חשבוניות דורשת Google Document AI (GOOGLE_ADC_JSON + "
                "DOCUMENT_AI_PROJECT_ID + DOCUMENT_AI_PROCESSOR_ID), "
                "OPENAI_API_KEY (sk-...) או GEMINI_API_KEY (AIza...)."
            )

    def parse_invoice_from_bytes(self, image_bytes: bytes, content_type: str = "image/jpeg") -> "InvoiceParseResult":
        if self._provider == "documentai":
            return self._parse_with_documentai(image_bytes, content_type)
        if self._provider == "gemini":
            return self._parse_with_gemini(image_bytes, content_type)
        return self._parse_with_openai(image_bytes, content_type)

    # ------------------------------------------------------------------
    def _parse_with_documentai(self, image_bytes: bytes, content_type: str) -> "InvoiceParseResult":
        from google.cloud import documentai

        creds_type = self._creds_info.get("type", "")
        if creds_type == "authorized_user":
            from google.oauth2.credentials import Credentials
            credentials = Credentials(
                token=None,
                refresh_token=self._creds_info["refresh_token"],
                token_uri="https://oauth2.googleapis.com/token",
                client_id=self._creds_info["client_id"],
                client_secret=self._creds_info["client_secret"],
            )
        else:
            from google.oauth2 import service_account
            credentials = service_account.Credentials.from_service_account_info(
                self._creds_info,
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )

        client = documentai.DocumentProcessorServiceClient(
            credentials=credentials,
            client_options={"api_endpoint": f"{self._location}-documentai.googleapis.com"},
        )
        processor_name = client.processor_path(
            self._project_id, self._location, self._processor_id
        )

        raw_doc = documentai.RawDocument(content=image_bytes, mime_type=content_type or "image/jpeg")
        request = documentai.ProcessRequest(name=processor_name, raw_document=raw_doc)
        result = client.process_document(request=request)
        doc = result.document

        import logging as _logging
        _log = _logging.getLogger(__name__)

        entities: dict[str, list] = {}
        for entity in doc.entities:
            entities.setdefault(entity.type_, []).append(entity)

        _log.info("DocAI entities: %s", {k: [e.mention_text for e in v] for k, v in entities.items()})
        ocr = doc.text or ""
        _log.info("DocAI OCR (800 chars): %r", ocr[:800])

        def first_text(key: str) -> Optional[str]:
            items = entities.get(key, [])
            return items[0].mention_text if items else None

        def first_amount(key: str) -> Optional[Decimal]:
            items = entities.get(key, [])
            if not items:
                return None
            e = items[0]
            nv = getattr(e, "normalized_value", None)
            mv = getattr(nv, "money_value", None) if nv else None
            if mv:
                val = _money_value_to_decimal(mv)
                if val and val > Decimal("0"):
                    return val.quantize(Decimal("0.01"))
            return _clean_amount(e.mention_text)

        # --- Extract from Document AI entities first ---
        business_name = (first_text("supplier_name") or first_text("merchant_name")
                         or first_text("vendor_name"))
        invoice_number = (first_text("invoice_id") or first_text("receipt_id")
                          or first_text("document_id"))
        total_amount = (first_amount("total_amount") or first_amount("net_amount"))
        vat_amount = (first_amount("vat_tax_amount") or first_amount("total_tax_amount"))
        pretax_amount = first_amount("subtotal")

        # --- Fallback: parse OCR text ---
        if not total_amount:
            total_amount = _parse_hebrew_total(ocr)
        if not vat_amount:
            vat_amount = _parse_hebrew_vat(ocr)
        if not pretax_amount:
            pretax_amount = _parse_hebrew_pretax(ocr)
        if not invoice_number:
            invoice_number = _parse_hebrew_invoice_number(ocr)

        # --- Cross-check: if vat_amount > total_amount, they're swapped ---
        if total_amount and vat_amount and vat_amount > total_amount:
            total_amount, vat_amount = vat_amount, total_amount

        # --- Validate: VAT should be roughly total * 18/118 ---
        if total_amount and not vat_amount:
            vat_amount = (total_amount * Decimal("18") / Decimal("118")).quantize(Decimal("0.01"))
        elif total_amount and vat_amount:
            expected_vat = total_amount * Decimal("18") / Decimal("118")
            if abs(vat_amount - expected_vat) > expected_vat * Decimal("0.3"):
                # VAT doesn't match expected — recalculate
                vat_amount = expected_vat.quantize(Decimal("0.01"))

        # --- Pretax from total - vat ---
        if total_amount and vat_amount and not pretax_amount:
            pretax_amount = (total_amount - vat_amount).quantize(Decimal("0.01"))

        # --- Date ---
        inv_date = None
        date_items = (entities.get("invoice_date") or entities.get("receipt_date") or [])
        if date_items:
            nv = getattr(date_items[0], "normalized_value", None)
            dv = getattr(nv, "date_value", None) if nv else None
            if dv and getattr(dv, "year", None):
                try:
                    inv_date = date(dv.year, dv.month, dv.day)
                except Exception:
                    pass
            if not inv_date:
                inv_date = _parse_date(date_items[0].mention_text)

        # Fallback: scan raw OCR text for date patterns
        if not inv_date and ocr:
            for dm in re.findall(r'\b(\d{1,2}[./]\d{1,2}[./]\d{2,4})\b', ocr):
                candidate = dm.replace(".", "/")
                inv_date = _parse_date(candidate)
                if inv_date:
                    break

        # --- Payment method ---
        payment_method = _parse_payment_method(ocr)

        return InvoiceParseResult(
            business_name=business_name,
            invoice_number=invoice_number,
            total_amount=total_amount,
            vat_amount=vat_amount,
            pretax_amount=pretax_amount,
            invoice_date=inv_date,
            payment_method=payment_method,
            raw_text=ocr,
        )

    # ------------------------------------------------------------------
    _OPENAI_PROMPT = """You are an expert Israeli accounting assistant. Extract structured financial data from photos of Israeli receipts and invoices (חשבונית / קבלה) — including retail/supermarket POS receipts printed on thermal paper, which often use terser wording than formal invoices.

Return ONLY valid JSON (no markdown, no explanations):
{
  "business_name": "string or null",
  "invoice_number": "string or null",
  "total_amount": number or null,
  "vat_amount": number or null,
  "pretax_amount": number or null,
  "invoice_date": "YYYY-MM-DD string or null",
  "payment_method": "string or null"
}

CRITICAL RULES:
- total_amount = the final amount actually paid, INCLUDING VAT. On retail receipts this may be labeled with just "לתשלום" (not always "סה"כ לתשלום" or "סכום לתשלום") — it is usually the largest/boldest number, often on a highlighted bar near the bottom.
- vat_amount = the VAT amount IN SHEKELS (₪) — NEVER the VAT rate/percentage. A line like "מע"מ 18.00% 38.27" means the rate is 18% and the shekel amount is 38.27 — vat_amount must be 38.27, never 18. If you can only see a bare percentage with no adjacent shekel figure, leave vat_amount null instead of guessing.
- pretax_amount = amount BEFORE VAT (סה"כ לפני מע"מ / חייב במע"מ / חייבים במע"מ). Usually total_amount minus vat_amount.
- These three values are linked (total = pretax + vat) — if you are confident about any two of them, you may derive the third.
- invoice_number: only fill this if an explicit invoice/document number is printed (e.g. "מספר חשבונית", "מס' קבלה"). Retail POS receipts often don't have one — leave null rather than using a register/cashier/transaction reference number.
- invoice_date: DD/MM/YYYY → convert to YYYY-MM-DD.
- payment_method: אשראי / מזומן / ביט / העברה בנקאית / null.
- Use null for any value you are not confident about — never guess a number."""

    def _parse_with_openai(self, image_bytes: bytes, content_type: str) -> "InvoiceParseResult":
        import base64
        from openai import OpenAI

        client = OpenAI(api_key=self._openai_key)
        b64 = base64.b64encode(image_bytes).decode("utf-8")

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": self._OPENAI_PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}", "detail": "high"}},
                    {"type": "text", "text": "Extract all financial data. Return only JSON."},
                ]},
            ],
            max_tokens=512, temperature=0,
        )
        raw_text = response.choices[0].message.content or ""
        return self._parse_openai_response(raw_text)

    def _parse_with_gemini(self, image_bytes: bytes, content_type: str) -> "InvoiceParseResult":
        """Use Gemini Vision via OpenAI-compatible REST API (no extra dependency needed)."""
        import base64
        import urllib.request

        b64 = base64.b64encode(image_bytes).decode("utf-8")
        payload = json.dumps({
            "model": "gemini-2.0-flash",
            "messages": [
                {"role": "system", "content": self._OPENAI_PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}"}},
                    {"type": "text", "text": "Extract all financial data from this receipt. Return only JSON."},
                ]},
            ],
            "max_tokens": 512,
            "temperature": 0,
        }).encode()

        req = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._gemini_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())

        raw_text = data["choices"][0]["message"]["content"]
        return self._parse_openai_response(raw_text)

    def _parse_openai_response(self, raw_text: str) -> "InvoiceParseResult":
        try:
            cleaned = raw_text.strip()
            if cleaned.startswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[1:-1])
            data = json.loads(cleaned)

            def to_dec(key: str) -> Optional[Decimal]:
                v = data.get(key)
                if v is None:
                    return None
                return Decimal(str(v)).quantize(Decimal("0.01"))

            total_amount = to_dec("total_amount")
            vat_amount = to_dec("vat_amount")
            pretax_amount = to_dec("pretax_amount")

            # Guard: a vat_amount that exactly matches a common Israeli VAT rate
            # (17/18%), with nothing else to corroborate it, is almost certainly
            # a misread of the rate label rather than the shekel amount — drop it
            # rather than surface a confidently-wrong number.
            if (
                vat_amount is not None and not total_amount and not pretax_amount
                and vat_amount in (Decimal("17.00"), Decimal("18.00"))
            ):
                vat_amount = None

            # Cross-derive whichever of the three is missing from the other two.
            if total_amount and pretax_amount and not vat_amount:
                vat_amount = (total_amount - pretax_amount).quantize(Decimal("0.01"))
            if total_amount and vat_amount and not pretax_amount:
                pretax_amount = (total_amount - vat_amount).quantize(Decimal("0.01"))
            if pretax_amount and vat_amount and not total_amount:
                total_amount = (pretax_amount + vat_amount).quantize(Decimal("0.01"))

            # Last resort: assume standard 18% Israeli VAT if only the total is known.
            if total_amount and not vat_amount:
                vat_amount = (total_amount * Decimal("18") / Decimal("118")).quantize(Decimal("0.01"))
                if not pretax_amount:
                    pretax_amount = (total_amount - vat_amount).quantize(Decimal("0.01"))

            inv_date = None
            if data.get("invoice_date"):
                try:
                    inv_date = date.fromisoformat(data["invoice_date"])
                except ValueError:
                    pass

            return InvoiceParseResult(
                business_name=data.get("business_name"),
                invoice_number=data.get("invoice_number"),
                total_amount=total_amount,
                vat_amount=vat_amount,
                pretax_amount=pretax_amount,
                invoice_date=inv_date,
                payment_method=data.get("payment_method"),
                raw_text=raw_text,
            )
        except (json.JSONDecodeError, ValueError, KeyError):
            return InvoiceParseResult(
                business_name=None, invoice_number=None,
                total_amount=None, vat_amount=None, pretax_amount=None,
                invoice_date=None, payment_method=None, raw_text=raw_text,
            )
