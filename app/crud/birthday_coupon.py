from __future__ import annotations

import secrets
from datetime import datetime, timezone, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.birthday_coupon import BirthdayCoupon

HEBREW_TO_LATIN: dict[str, str] = {
    'א': 'A', 'ב': 'B', 'ג': 'G', 'ד': 'D', 'ה': 'H',
    'ו': 'V', 'ז': 'Z', 'ח': 'H', 'ט': 'T', 'י': 'I',
    'כ': 'K', 'ך': 'K', 'ל': 'L', 'מ': 'M', 'ם': 'M',
    'נ': 'N', 'ן': 'N', 'ס': 'S', 'ע': 'A', 'פ': 'P',
    'ף': 'F', 'צ': 'Z', 'ץ': 'Z', 'ק': 'K', 'ר': 'R',
    'ש': 'S', 'ת': 'T',
}


def _name_prefix(name: str, length: int = 4) -> str:
    """Convert first word of name to Latin letters for coupon code."""
    first_word = name.strip().split()[0] if name.strip() else name
    result = ""
    for ch in first_word:
        if ch in HEBREW_TO_LATIN:
            result += HEBREW_TO_LATIN[ch]
        elif ch.isalpha() and ch.isascii():
            result += ch.upper()
        if len(result) >= length:
            break
    return result or "BDAY"


def _generate_code(db: Session, client_name: str, discount: int) -> str:
    """Generate unique coupon code like NOA10, NOA10B if collision."""
    prefix = _name_prefix(client_name, 4)
    base = f"{prefix}{discount}"
    code = base
    i = 0
    while db.scalar(select(BirthdayCoupon).where(BirthdayCoupon.code == code)) is not None:
        code = f"{base}{secrets.token_hex(1).upper()}"
        i += 1
        if i > 20:
            code = f"{base}{secrets.token_hex(2).upper()}"
            break
    return code


def get_or_create_birthday_coupon(
    db: Session,
    studio_id: UUID,
    client_id: UUID,
    month: int,
    year: int,
    discount_percent: int = 10,
    client_name: str = "",
) -> BirthdayCoupon:
    """Idempotent — returns existing coupon for this client/month/year, or creates one."""
    existing = db.scalar(
        select(BirthdayCoupon).where(
            BirthdayCoupon.studio_id == studio_id,
            BirthdayCoupon.client_id == client_id,
            BirthdayCoupon.birthday_month == month,
            BirthdayCoupon.birthday_year == year,
        )
    )
    if existing:
        return existing

    now = datetime.now(timezone.utc)
    coupon = BirthdayCoupon(
        studio_id=studio_id,
        client_id=client_id,
        code=_generate_code(db, client_name or str(client_id)[:4], discount_percent),
        discount_percent=discount_percent,
        birthday_month=month,
        birthday_year=year,
        starts_at=now,
        expires_at=now + timedelta(days=30),
        status="active",
    )
    db.add(coupon)
    db.flush()
    return coupon


def validate_coupon(
    db: Session,
    studio_id: UUID,
    client_id: UUID,
    code: str,
) -> BirthdayCoupon | None:
    """Returns the coupon if it is active and not expired, else None."""
    now = datetime.now(timezone.utc)
    return db.scalar(
        select(BirthdayCoupon).where(
            BirthdayCoupon.studio_id == studio_id,
            BirthdayCoupon.client_id == client_id,
            BirthdayCoupon.code == code,
            BirthdayCoupon.status == "active",
            BirthdayCoupon.expires_at >= now,
        )
    )


def apply_coupon(
    db: Session,
    coupon: BirthdayCoupon,
    payment_id: UUID,
    appointment_id: UUID | None = None,
) -> None:
    """Mark coupon as redeemed."""
    coupon.status = "redeemed"
    coupon.redeemed_at = datetime.now(timezone.utc)
    coupon.payment_id = payment_id
    coupon.appointment_id = appointment_id


def restore_coupon(db: Session, payment_id: UUID) -> None:
    """Restore a coupon that was redeemed by a payment that has been deleted."""
    coupon = db.scalar(
        select(BirthdayCoupon).where(BirthdayCoupon.payment_id == payment_id)
    )
    if not coupon or coupon.status != "redeemed":
        return
    now = datetime.now(timezone.utc)
    coupon.status = "active" if coupon.expires_at >= now else "expired"
    coupon.redeemed_at = None
    coupon.payment_id = None
    coupon.appointment_id = None


def expire_old_coupons(db: Session) -> int:
    """Expire all active coupons past their expiry date. Call daily."""
    now = datetime.now(timezone.utc)
    coupons = list(db.scalars(
        select(BirthdayCoupon).where(
            BirthdayCoupon.status == "active",
            BirthdayCoupon.expires_at < now,
        )
    ).all())
    for c in coupons:
        c.status = "expired"
    if coupons:
        db.commit()
    return len(coupons)
