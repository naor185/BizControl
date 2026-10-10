"""
Coupons: the owner's own coupons (create, change, stop, delete an unused one) with the report, checking a code at the
till / the payment screen, and the coupon's public link on BizFind (/b/<slug>?c=<code>). app/services/coupons.py does
the work; a birthday coupon is checked through the same code.
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.features import has_module, require_module
from app.core.permissions import require_management
from app.models.client import Client
from app.models.coupon import Coupon
from app.models.studio import Studio
from app.services import coupons as svc

router = APIRouter(prefix="/coupons", tags=["Coupons"])
public_router = APIRouter(prefix="/public/coupons", tags=["CouponsPublic"])
MANAGE = Depends(require_management("קופונים"))
IN_PLAN = Depends(require_module("coupons"))   # pro and up


# ── checking a code at payment ────────────────────────────────────────────────

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


def _checked(db: Session, studio_id, code: str, client_id) -> CouponValidateResponse:
    hit = svc.find(db, studio_id, code, client_id)
    client_name = None
    if hit.birthday is not None:
        c = db.get(Client, hit.birthday.client_id)
        client_name = c.full_name if c else None
    expires = hit.birthday.expires_at.isoformat() if hit.birthday else (hit.coupon.expires_on.isoformat() if hit.coupon.expires_on else None)
    return CouponValidateResponse(valid=True, discount_percent=hit.percent, code=hit.code, expires_at=expires,
                                  client_name=client_name, message=f"{hit.label} — תקין")


@router.get("/validate", response_model=CouponValidateResponse)
def validate_coupon_get(code: str = Query(...), client_id: Optional[UUID] = None,
                        ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """The till and the payment screen: 404 with the reason when the code does not work now."""
    try:
        return _checked(db, ctx.studio_id, code, client_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/validate", response_model=CouponValidateResponse)
def validate_coupon_endpoint(payload: CouponValidateRequest, ctx: AuthContext = Depends(require_studio_ctx),
                             db: Session = Depends(get_db)):
    """The client card: {valid: false, message} when the code does not work now."""
    try:
        return _checked(db, ctx.studio_id, payload.code, payload.client_id)
    except ValueError as e:
        return CouponValidateResponse(valid=False, message=str(e))


# ── the owner's coupons ───────────────────────────────────────────────────────

class CouponIn(BaseModel):
    code: str = Field(min_length=3, max_length=32)
    discount_percent: int = Field(ge=1, le=100)
    category: Optional[str] = Field(None, max_length=60)
    source: Optional[str] = Field(None, max_length=60)
    max_uses: Optional[int] = Field(None, ge=1, le=1_000_000)
    once_per_client: bool = False
    expires_on: Optional[date] = None
    note: Optional[str] = Field(None, max_length=300)


class CouponPatch(BaseModel):
    discount_percent: Optional[int] = Field(None, ge=1, le=100)
    category: Optional[str] = Field(None, max_length=60)
    source: Optional[str] = Field(None, max_length=60)
    max_uses: Optional[int] = Field(None, ge=1, le=1_000_000)
    once_per_client: Optional[bool] = None
    expires_on: Optional[date] = None
    note: Optional[str] = Field(None, max_length=300)
    is_active: Optional[bool] = None


def _text(v: Optional[str]) -> Optional[str]:
    return (v or "").strip() or None


def _get(db: Session, studio_id, coupon_id: UUID) -> Coupon:
    c = db.get(Coupon, coupon_id)
    if not c or c.studio_id != studio_id:
        raise HTTPException(404, "הקופון לא נמצא")
    return c


@router.get("")
def list_coupons(ctx: AuthContext = MANAGE, db: Session = Depends(get_db), _plan: None = IN_PLAN):
    """Every coupon with its numbers, the birthday coupons as one line, sums by category and by source, and the
    business's BizFind address part (for the coupon links)."""
    studio = db.get(Studio, ctx.studio_id)
    return {**svc.report(db, ctx.studio_id), "studio_slug": studio.slug if studio else None}


@router.post("")
def create_coupon(body: CouponIn, ctx: AuthContext = MANAGE, db: Session = Depends(get_db), _plan: None = IN_PLAN):
    code = svc.clean_code(body.code)
    if not svc.CODE_RE.match(code):
        raise HTTPException(400, "הקוד — אותיות באנגלית, ספרות, מקף או קו תחתון, 3 עד 32 תווים")
    if svc.code_taken(db, ctx.studio_id, code):
        raise HTTPException(409, f"כבר יש קופון בקוד {code}")
    c = Coupon(studio_id=ctx.studio_id, code=code, discount_percent=body.discount_percent, category=_text(body.category),
               source=_text(body.source), max_uses=body.max_uses, once_per_client=body.once_per_client,
               expires_on=body.expires_on, note=_text(body.note), created_by=ctx.user_id)
    db.add(c)
    db.commit()
    return {"id": str(c.id), "code": c.code}


@router.patch("/{coupon_id}")
def update_coupon(coupon_id: UUID, body: CouponPatch, ctx: AuthContext = MANAGE, db: Session = Depends(get_db),
                  _plan: None = IN_PLAN):
    """The code itself stays (its link is already out there); everything else is the owner's to change. Sending
    max_uses / expires_on as null clears the limit."""
    c = _get(db, ctx.studio_id, coupon_id)
    sent = body.model_dump(exclude_unset=True)
    for key in ("category", "source", "note"):
        if key in sent:
            setattr(c, key, _text(sent[key]))
    for key in ("discount_percent", "once_per_client", "is_active"):
        if sent.get(key) is not None:
            setattr(c, key, sent[key])
    for key in ("max_uses", "expires_on"):
        if key in sent:
            setattr(c, key, sent[key])
    db.commit()
    return {"id": str(c.id), "state": svc.state(db, c)}


@router.delete("/{coupon_id}", status_code=204)
def delete_coupon(coupon_id: UUID, ctx: AuthContext = MANAGE, db: Session = Depends(get_db), _plan: None = IN_PLAN):
    """Only a coupon nobody used — a used one is stopped instead, so its numbers stay in the report."""
    c = _get(db, ctx.studio_id, coupon_id)
    if svc.uses_of(db, c):
        raise HTTPException(409, "בקופון הזה כבר השתמשו — אפשר להפסיק אותו, לא למחוק")
    db.delete(c)
    db.commit()


# ── the coupon's link on BizFind ──────────────────────────────────────────────

class ClickIn(BaseModel):
    count: bool = True          # the page counts a visit once per browser session


@public_router.post("/{slug}/{code}")
def open_coupon_link(slug: str, code: str, body: ClickIn, db: Session = Depends(get_db)):
    """Someone opened the coupon's link — what it gives, counted as a click. 404 when it does not work now (the page
    then just shows the business)."""
    studio = db.scalar(select(Studio).where(Studio.slug == slug))
    if not studio:
        raise HTTPException(404, "העסק לא נמצא")
    if not has_module(db, studio.id, "coupons"):
        raise HTTPException(404, "הקופון לא בתוקף")
    code = svc.clean_code(code)
    c = db.scalar(select(Coupon).where(Coupon.studio_id == studio.id, Coupon.code == code).with_for_update())
    if not c or svc.state(db, c) != "active":
        raise HTTPException(404, "הקופון לא בתוקף")
    if body.count:
        c.link_clicks = (c.link_clicks or 0) + 1
        db.commit()
    return {"code": c.code, "discount_percent": c.discount_percent,
            "expires_on": c.expires_on.isoformat() if c.expires_on else None, "once_per_client": c.once_per_client}
