"""
AI Invoice Parsing Service using OpenAI Vision API.
Extracts structured data from uploaded invoice images for Israeli businesses.
"""
import base64
import json
import os
from datetime import date
from decimal import Decimal
from typing import Optional

from openai import OpenAI


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


class AIInvoiceService:
    SYSTEM_PROMPT = """You are an expert Israeli accounting assistant. Your task is to extract structured financial data from invoice images.
    
Extract the following information from the invoice and return ONLY valid JSON (no markdown, no explanations):
{
  "business_name": "string or null",
  "invoice_number": "string or null",
  "total_amount": number or null,
  "vat_amount": number or null,
  "invoice_date": "YYYY-MM-DD string or null"
}

Notes:
- In Israeli invoices, total_amount is usually labeled: סך הכל, סה"כ, סכום לתשלום, מחיר סופי
- VAT is labeled: מע"מ (17% of pre-VAT total)
- If vat_amount is not explicitly stated but total is known, calculate as total * 17/117
- invoice_date may appear as DD/MM/YYYY or DD.MM.YYYY, convert to YYYY-MM-DD
- If a value cannot be found, use null
- total_amount should be the final total INCLUDING VAT"""

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is not set in environment variables")
        self.client = OpenAI(api_key=api_key)

    def parse_invoice_from_bytes(self, image_bytes: bytes, content_type: str = "image/jpeg") -> InvoiceParseResult:
        """Parse an invoice image and extract structured data using OpenAI Vision."""
        base64_image = base64.b64encode(image_bytes).decode("utf-8")

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": self.SYSTEM_PROMPT,
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{content_type};base64,{base64_image}",
                                "detail": "high",
                            },
                        },
                        {
                            "type": "text",
                            "text": "Extract all financial data from this invoice. Return only JSON.",
                        },
                    ],
                },
            ],
            max_tokens=500,
            temperature=0,
        )

        raw_text = response.choices[0].message.content or ""

        return self._parse_response(raw_text)

    def _parse_response(self, raw_text: str) -> InvoiceParseResult:
        """Parse the OpenAI response JSON into an InvoiceParseResult object."""
        try:
            # Strip any accidental markdown fences
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
                # Estimate VAT if not provided (17% Israeli VAT - 17/117 of total)
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
            # Return empty result if parsing fails
            return InvoiceParseResult(
                business_name=None,
                invoice_number=None,
                total_amount=None,
                vat_amount=None,
                invoice_date=None,
                raw_text=raw_text,
            )
