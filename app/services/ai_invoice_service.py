"""
AI Invoice Parsing Service — v3 (Google Document AI).
Primary: Google Document AI Invoice Parser processor.
Fallback: OpenAI GPT-4o Vision (sk-... key).

Required env vars for Document AI:
  GOOGLE_ADC_JSON         — authorized_user credentials JSON (from gcloud auth application-default login)
  DOCUMENT_AI_PROJECT_ID  — GCP project ID (e.g. "my-project-123456")
  DOCUMENT_AI_PROCESSOR_ID— processor ID from Cloud Console (e.g. "abc123def456")
  DOCUMENT_AI_LOCATION    — "us" or "eu" (default "us")
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
        invoice_date: Optional[date],
        raw_text: str = "",
    ):
        self.business_name = business_name
        self.invoice_number = invoice_number
        self.total_amount = total_amount
        self.vat_amount = vat_amount
        self.invoice_date = invoice_date
        self.raw_text = raw_text


# ---------- helpers ----------------------------------------------------------

def _clean_amount(text: str) -> Optional[Decimal]:
    """Parse Israeli amount strings like '1,234.56 ₪' or '1234' into Decimal."""
    if not text:
        return None
    cleaned = re.sub(r"[^\d.,]", "", text).replace(",", "")
    try:
        return Decimal(cleaned).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def _money_value_to_decimal(money) -> Optional[Decimal]:
    """Convert Document AI MoneyValue proto to Decimal."""
    try:
        units = getattr(money, "units", 0) or 0
        nanos = getattr(money, "nanos", 0) or 0
        return Decimal(str(units)) + Decimal(str(nanos)) / Decimal("1000000000")
    except Exception:
        return None


def _parse_date(text: str) -> Optional[date]:
    """Parse DD/MM/YYYY, DD.MM.YYYY, or YYYY-MM-DD into date."""
    if not text:
        return None
    for fmt in ("%d/%m/%Y", "%d.%m.%Y", "%Y-%m-%d"):
        try:
            from datetime import datetime
            return datetime.strptime(text.strip(), fmt).date()
        except ValueError:
            pass
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

        real_openai = openai_key if openai_key.startswith("sk-") else ""
        google_creds_json = adc_json or sa_json

        if google_creds_json and project_id and processor_id:
            self._provider = "documentai"
            self._creds_info = json.loads(google_creds_json)
            self._project_id = project_id
            self._processor_id = processor_id
            self._location = location
        elif real_openai:
            self._provider = "openai"
            self._openai_key = real_openai
        else:
            raise ValueError(
                "סריקת חשבוניות דורשת Google Document AI (GOOGLE_SA_JSON + "
                "DOCUMENT_AI_PROJECT_ID + DOCUMENT_AI_PROCESSOR_ID) "
                "או OPENAI_API_KEY (sk-...)."
            )

    def parse_invoice_from_bytes(self, image_bytes: bytes, content_type: str = "image/jpeg") -> "InvoiceParseResult":
        if self._provider == "documentai":
            return self._parse_with_documentai(image_bytes, content_type)
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

        # Collect all entity values by type
        entities: dict[str, list] = {}
        for entity in doc.entities:
            entities.setdefault(entity.type_, []).append(entity)

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
                if val:
                    return val.quantize(Decimal("0.01"))
            return _clean_amount(e.mention_text)

        business_name = first_text("supplier_name")
        invoice_number = first_text("invoice_id")

        total_amount = first_amount("total_amount") or first_amount("net_amount")
        vat_amount = first_amount("vat_tax_amount") or first_amount("total_tax_amount")

        # Fallback VAT calculation
        if total_amount and not vat_amount:
            vat_amount = (total_amount * Decimal("17") / Decimal("117")).quantize(Decimal("0.01"))

        inv_date = None
        date_items = entities.get("invoice_date", [])
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

        return InvoiceParseResult(
            business_name=business_name,
            invoice_number=invoice_number,
            total_amount=total_amount,
            vat_amount=vat_amount,
            invoice_date=inv_date,
            raw_text=doc.text or "",
        )

    # ------------------------------------------------------------------
    _OPENAI_PROMPT = """You are an expert Israeli accounting assistant. Extract structured financial data from invoice images.

Return ONLY valid JSON (no markdown, no explanations):
{
  "business_name": "string or null",
  "invoice_number": "string or null",
  "total_amount": number or null,
  "vat_amount": number or null,
  "invoice_date": "YYYY-MM-DD string or null"
}

Notes:
- total_amount labels: סך הכל, סה"כ, סכום לתשלום, מחיר סופי
- VAT label: מע"מ (17%). If not stated, calculate as total * 17/117
- invoice_date: DD/MM/YYYY or DD.MM.YYYY → convert to YYYY-MM-DD
- total_amount = final total INCLUDING VAT
- Use null for any value not found"""

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
                    {"type": "text", "text": "Extract all financial data from this invoice. Return only JSON."},
                ]},
            ],
            max_tokens=512,
            temperature=0,
        )
        raw_text = response.choices[0].message.content or ""
        return self._parse_openai_response(raw_text)

    def _parse_openai_response(self, raw_text: str) -> "InvoiceParseResult":
        try:
            cleaned = raw_text.strip()
            if cleaned.startswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[1:-1])
            data = json.loads(cleaned)

            total_amount = None
            if data.get("total_amount") is not None:
                total_amount = Decimal(str(data["total_amount"])).quantize(Decimal("0.01"))

            vat_amount = None
            if data.get("vat_amount") is not None:
                vat_amount = Decimal(str(data["vat_amount"])).quantize(Decimal("0.01"))
            elif total_amount is not None:
                vat_amount = (total_amount * Decimal("17") / Decimal("117")).quantize(Decimal("0.01"))

            inv_date = None
            if data.get("invoice_date"):
                inv_date = date.fromisoformat(data["invoice_date"])

            return InvoiceParseResult(
                business_name=data.get("business_name"),
                invoice_number=data.get("invoice_number"),
                total_amount=total_amount,
                vat_amount=vat_amount,
                invoice_date=inv_date,
                raw_text=raw_text,
            )
        except (json.JSONDecodeError, ValueError, KeyError):
            return InvoiceParseResult(
                business_name=None, invoice_number=None,
                total_amount=None, vat_amount=None,
                invoice_date=None, raw_text=raw_text,
            )
