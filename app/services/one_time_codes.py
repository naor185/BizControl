"""The codes sent by WhatsApp to prove a phone: a business owner's password reset (password_reset_otps), a BizFind
customer's sign-in and a business claim (marketplace_otps).

A code can't be guessed (the pre-launch review, 2026-11-07): it is drawn with `secrets` (it was `random`, whose next
numbers can be worked out), and every wrong try counts against the live code — the fifth voids it and a new code must
be asked for. The rate limits alone let anyone with many addresses keep guessing for the code's ten minutes."""
from __future__ import annotations

import hmac
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

MAX_WRONG = 5
WRONG = "קוד שגוי או פג תוקף"
VOIDED = "הקוד בוטל אחרי 5 ניסיונות שגויים — בקשו קוד חדש"
_TABLES = ("password_reset_otps", "marketplace_otps")


def new_code(digits: int) -> str:
    return f"{secrets.randbelow(10 ** digits):0{digits}d}"


def check(db: Session, table: str, phone: str, code: str, extra: str = ""):
    """The live code of this phone, when `code` is it — marked used (the caller commits) and returned as a row of
    id[, extra columns]. Otherwise HTTP 400: wrong or expired, or voided by this, the fifth wrong try (committed here,
    so the count holds even though the request fails)."""
    assert table in _TABLES
    cols = "id, code" + (f", {extra}" if extra else "")
    row = db.execute(text(f"""
        SELECT {cols} FROM {table}
        WHERE phone = :phone AND expires_at > :now AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1
    """), {"phone": phone, "now": datetime.now(timezone.utc)}).fetchone()
    if row is None:
        raise HTTPException(status_code=400, detail=WRONG)
    if hmac.compare_digest(str(row.code), (code or "").strip()):
        db.execute(text(f"UPDATE {table} SET used_at = NOW() WHERE id = :id"), {"id": str(row.id)})
        return row
    tries = db.execute(text(f"""
        UPDATE {table} SET attempts = attempts + 1,
                           used_at = CASE WHEN attempts + 1 >= :max THEN NOW() ELSE used_at END
        WHERE id = :id RETURNING attempts
    """), {"id": str(row.id), "max": MAX_WRONG}).scalar()
    db.commit()
    raise HTTPException(status_code=400, detail=VOIDED if tries >= MAX_WRONG else WRONG)
