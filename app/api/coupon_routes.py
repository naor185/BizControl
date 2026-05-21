from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

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
    message: str = ""


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
