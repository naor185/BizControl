from __future__ import annotations

import secrets
from datetime import datetime, timezone, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.birthday_coupon import BirthdayCoupon


def _generate_code(client_id: UUID, month: int, year: int) -> str:
    suffix = secrets.token_hex(3).upper()
    return f"BD{year}{month:02d}-{suffix}"


def get_or_create_birthday_coupon(
    db: Session,
    studio_id: UUID,
    client_id: UUID,
    month: int,
    year: int,
    discount_percent: int = 10,
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
        code=_generate_code(client_id, month, year),
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
