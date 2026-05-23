from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db

router = APIRouter(prefix="/coupons", tags=["Coupons"])


class CouponValidateRequest(BaseModel):
    client_id: UUID
    code: str


class CouponValidateResponse(BaseModel):
    valid: bool
    discount_percent: int = 0
    code: str = ""
    expires_at: str | None = None
    client_name: str | None = None
    message: str = ""


@router.get("/validate", response_model=CouponValidateResponse)
def validate_coupon_get(
    code: str = Query(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Validate coupon by code only — no client_id required."""
    from app.models.birthday_coupon import BirthdayCoupon
    from app.models.client import Client
    from sqlalchemy import select

    now = datetime.now(timezone.utc)
    coupon = db.scalar(
        select(BirthdayCoupon).where(
            BirthdayCoupon.studio_id == ctx.studio_id,
            BirthdayCoupon.code == code.upper().strip(),
            BirthdayCoupon.status == "active",
            BirthdayCoupon.expires_at >= now,
        )
    )
    if not coupon:
        raise HTTPException(status_code=404, detail="קוד קופון לא תקין, כבר נוצל, או פג תוקפו")

    client_name = None
    if coupon.client_id:
        client = db.scalar(select(Client).where(Client.id == coupon.client_id))
        client_name = client.full_name if client else None

    return CouponValidateResponse(
        valid=True,
        discount_percent=coupon.discount_percent,
        code=coupon.code,
        expires_at=coupon.expires_at.isoformat() if coupon.expires_at else None,
        client_name=client_name,
        message=f"קופון יום הולדת תקין — {coupon.discount_percent}% הנחה",
    )


@router.post("/use/{code}")
def use_coupon(
    code: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Mark coupon as redeemed."""
    from app.models.birthday_coupon import BirthdayCoupon
    from sqlalchemy import select

    now = datetime.now(timezone.utc)
    coupon = db.scalar(
        select(BirthdayCoupon).where(
            BirthdayCoupon.studio_id == ctx.studio_id,
            BirthdayCoupon.code == code.upper().strip(),
            BirthdayCoupon.status == "active",
        )
    )
    if not coupon:
        raise HTTPException(status_code=404, detail="קוד לא נמצא")
    coupon.status = "redeemed"
    coupon.redeemed_at = now
    db.commit()
    return {"ok": True}


@router.post("/validate", response_model=CouponValidateResponse)
def validate_coupon_endpoint(
    payload: CouponValidateRequest,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from app.crud.birthday_coupon import validate_coupon
    coupon = validate_coupon(db, ctx.studio_id, payload.client_id, payload.code)
    if not coupon:
        return CouponValidateResponse(
            valid=False,
            message="קוד קופון לא תקין, כבר נוצל, או פג תוקפו",
        )
    return CouponValidateResponse(
        valid=True,
        discount_percent=coupon.discount_percent,
        code=coupon.code,
        expires_at=coupon.expires_at.isoformat(),
        message=f"קופון יום הולדת תקין — {coupon.discount_percent}% הנחה",
    )
