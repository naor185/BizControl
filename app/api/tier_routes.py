from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.deps import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.permissions import require_roles, Perms
from app.crud.membership_tier import list_tiers, get_tier, create_tier, update_tier, delete_tier, get_client_tier

from app.core.features import require_module
router = APIRouter(prefix="/tiers", tags=["Membership Tiers"], dependencies=[Depends(require_module("customer_club"))])


class TierIn(BaseModel):
    name: str
    color: str = "#C0C0C0"
    icon: str = "⭐"
    rank_order: int = 1
    threshold_type: str = "visits"
    threshold_value: int = 1
    points_multiplier: float = 1.0
    birthday_gift_percent: int = 10
    is_active: bool = True


class TierOut(BaseModel):
    id: UUID
    studio_id: UUID
    name: str
    color: str
    icon: str
    rank_order: int
    threshold_type: str
    threshold_value: int
    points_multiplier: float
    birthday_gift_percent: int
    is_active: bool

    class Config:
        from_attributes = True


@router.get("", response_model=list[TierOut])
def list_(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return list_tiers(db, ctx.studio_id)


@router.post("", response_model=TierOut, dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))])
def create(payload: TierIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return create_tier(db, ctx.studio_id, payload.model_dump())


@router.patch("/{tier_id}", response_model=TierOut, dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))])
def patch(tier_id: UUID, payload: TierIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    tier = update_tier(db, ctx.studio_id, tier_id, payload.model_dump(exclude_unset=True))
    if not tier:
        raise HTTPException(404, "Tier not found")
    return tier


@router.delete("/{tier_id}", dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))])
def delete(tier_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if not delete_tier(db, ctx.studio_id, tier_id):
        raise HTTPException(404, "Tier not found")
    return {"ok": True}


@router.get("/client/{client_id}")
def client_tier(client_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    tier = get_client_tier(db, ctx.studio_id, client_id)
    if not tier:
        return {"tier": None}
    return {"tier": TierOut.model_validate(tier)}
