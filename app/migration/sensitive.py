"""
Payment-method data never enters BizControl through a migration: a column whose name says it is
card data, or whose values look like card numbers (Luhn-valid 13–19 digits), is dropped before
anything is stored — not even in the staging copy of the raw row.
"""
from __future__ import annotations

import re

_CARD_HEADER = re.compile(
    r"(card.?num|cardnumber|credit.?card|\bcc\b|ccnum|cvv|cvc|cvv2|security.?code|card.?exp|exp.?date|expiry|"
    r"pan\b|אשראי|מספר.?כרטיס|תוקף.?כרטיס|תוקף.?אשראי|ספרות.?בגב|קוד.?אבטחה)",
    re.IGNORECASE,
)


def _luhn_ok(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def looks_like_card_number(value) -> bool:
    digits = re.sub(r"[\s\-]", "", str(value or ""))
    return digits.isdigit() and 13 <= len(digits) <= 19 and _luhn_ok(digits)


def sensitive_columns(headers: list[str], rows: list[list], sample_size: int = 200) -> dict[int, str]:
    """{column index: reason} for every column that must be dropped."""
    found: dict[int, str] = {}
    for i, h in enumerate(headers):
        if _CARD_HEADER.search(h or ""):
            found[i] = "שם העמודה מעיד על פרטי כרטיס אשראי"
            continue
        values = [r[i] for r in rows[:sample_size] if i < len(r) and r[i] not in (None, "")]
        cards = sum(1 for v in values if looks_like_card_number(v))
        if values and cards >= max(1, len(values) // 2):
            found[i] = "הערכים נראים כמו מספרי כרטיס אשראי"
    return found
