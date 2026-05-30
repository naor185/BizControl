"""
AI Invoice Parsing Service.
Uses Google GenAI SDK (Gemini) when GEMINI_API_KEY is set,
falls back to OpenAI GPT-4o when OPENAI_API_KEY (sk-...) is set.
"""
import json
import os
from datetime import date
from decimal import Decimal
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


SYSTEM_PROMPT = """You are an expert Israeli accounting assistant. Extract structured financial data from invoice images.

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


class AIInvoiceService:

    def __init__(self):
        gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
        openai_key = os.getenv("OPENAI_API_KEY", "").strip()

        # Groq (gsk_) does not support vision
        real_openai = openai_key if openai_key.startswith("sk-") else ""
        real_gemini = next((k for k in (gemini_key, openai_key) if k.startswith("AIza")), "")

        if real_gemini:
            self._provider = "gemini"
            self._gemini_key = real_gemini
        elif real_openai:
            self._provider = "openai"
            self._openai_key = real_openai
        else:
            raise ValueError("סריקת חשבוניות דורשת GEMINI_API_KEY (AIza...) או OPENAI_API_KEY (sk-...).")

    def parse_invoice_from_bytes(self, image_bytes: bytes, content_type: str = "image/jpeg") -> "InvoiceParseResult":
        if self._provider == "gemini":
            return self._parse_with_gemini(image_bytes, content_type)
        return self._parse_with_openai(image_bytes, content_type)

    def _parse_with_gemini(self, image_bytes: bytes, content_type: str) -> "InvoiceParseResult":
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self._gemini_key)

        mime = content_type or "image/jpeg"
        if mime not in ("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"):
            mime = "image/jpeg"

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime),
                "Extract all financial data from this invoice. Return only JSON.",
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0,
                max_output_tokens=512,
            ),
        )
        raw_text = response.text or ""
        return self._parse_response(raw_text)

    def _parse_with_openai(self, image_bytes: bytes, content_type: str) -> "InvoiceParseResult":
        import base64
        from openai import OpenAI

        client = OpenAI(api_key=self._openai_key)
        b64 = base64.b64encode(image_bytes).decode("utf-8")

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}", "detail": "high"}},
                    {"type": "text", "text": "Extract all financial data from this invoice. Return only JSON."},
                ]},
            ],
            max_tokens=512,
            temperature=0,
        )
        raw_text = response.choices[0].message.content or ""
        return self._parse_response(raw_text)

    def _parse_response(self, raw_text: str) -> "InvoiceParseResult":
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

            invoice_date = None
            if data.get("invoice_date"):
                invoice_date = date.fromisoformat(data["invoice_date"])

            return InvoiceParseResult(
                business_name=data.get("business_name"),
                invoice_number=data.get("invoice_number"),
                total_amount=total_amount,
                vat_amount=vat_amount,
                invoice_date=invoice_date,
                raw_text=raw_text,
            )
        except (json.JSONDecodeError, ValueError, KeyError):
            return InvoiceParseResult(
                business_name=None, invoice_number=None,
                total_amount=None, vat_amount=None,
                invoice_date=None, raw_text=raw_text,
            )
