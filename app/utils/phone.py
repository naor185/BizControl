"""
Phone numbers in the format clients.phone already uses: Israeli numbers as local digits with the
leading 0 (0501234567, 031234567), anything else as +<country><number>.
"""
from __future__ import annotations

import re

_STRIP = re.compile(r"[\s\-\.\(\)/\u200e\u200f\u202a-\u202e]")


def normalize_phone(value) -> str | None:
    """The phone in local storage format, or None if it is not a usable phone number.

    Accepts +972 / 00972 / 972 prefixes, separators, and the lost leading zero that spreadsheets
    produce when a number column is stored as a number (501234567, 501234567.0).
    """
    if value is None:
        return None
    if isinstance(value, float):
        if value != value or value <= 0:  # NaN
            return None
        value = str(int(value)) if value.is_integer() else str(value)
    s = _STRIP.sub("", str(value).strip())
    if not s:
        return None
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    if s.startswith("+972"):
        s = "0" + s[4:]
    elif s.startswith("00972"):
        s = "0" + s[5:]
    elif s.startswith("972") and len(s) in (11, 12) and s.isdigit():
        s = "0" + s[3:]
    elif s.startswith("+"):
        digits = s[1:]
        return s if digits.isdigit() and 8 <= len(digits) <= 15 else None
    elif s.startswith("00") and s[2:].isdigit() and 8 <= len(s) - 2 <= 15:
        return "+" + s[2:]
    if not s.isdigit():
        return None
    # Spreadsheet dropped the leading zero: 9-digit mobile (5X…) or 8-digit landline (2/3/4/8/9…).
    if not s.startswith("0"):
        if len(s) == 9 and s[0] in "57":
            s = "0" + s
        elif len(s) == 8 and s[0] in "23489":
            s = "0" + s
        else:
            return None
    # 05X/07X numbers are 10 digits, landlines (02, 03, 04, 08, 09) are 9.
    if s[1] in "57":
        return s if len(s) == 10 else None
    if s[1] in "23489":
        return s if len(s) == 9 else None
    return None
