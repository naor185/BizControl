"""The VAT on a business's receipts — one place for the rate and for what a receipt says about it (owner, 2026-10-13).

- A VAT-exempt business (עוסק פטור): no VAT, the receipt says so.
- An authorized business or a company: the business's rate — 18% unless it says otherwise. A business registered in
  Eilat (a free-trade zone: its deals there are VAT-free, 1985 law) sets 0% when it sets up its receipts
  (invoices/settings/complete, eilat=true) — a tax invoice/receipt with VAT 0%, and the receipt says why.
0% is a rate, not a missing one: `settings.get("vat_rate") or 18` turned an Eilat business's 0 into 18."""
from __future__ import annotations

DEFAULT_RATE = 18.0
PATUR_NOTE = 'עוסק פטור, אינו חייב במע"מ'
EILAT_NOTE = 'מע"מ 0% — עסקה באזור סחר חופשי אילת'


def rate_of(settings: dict | None) -> float:
    """The business's VAT rate (its invoice_settings row, or an issued invoice)."""
    v = (settings or {}).get("vat_rate")
    return float(v) if v is not None else DEFAULT_RATE


def words(business_type: str | None, vat_rate) -> tuple[bool, str | None]:
    """(show the VAT lines, the note under the total) for a receipt."""
    if (business_type or "osek_patur") == "osek_patur":
        return False, PATUR_NOTE
    if vat_rate is not None and float(vat_rate) == 0:
        return True, EILAT_NOTE
    return True, None
