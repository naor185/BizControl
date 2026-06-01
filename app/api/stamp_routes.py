from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.deps import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.permissions import require_roles, Perms
from app.crud.stamp_card import list_stamp_cards, create_stamp_card, update_stamp_card, delete_stamp_card

from app.core.features import require_module
router = APIRouter(prefix="/stamp-cards", tags=["Stamp Cards"], dependencies=[Depends(require_module("customer_club"))])


class StampCardIn(BaseModel):
    name: str
    description: str | None = None
    required_stamps: int = 5
    reward_type: str = "discount_percent"
    reward_value: int = 10
    reward_description: str | None = None
    is_active: bool = True


class StampCardOut(BaseModel):
    id: UUID
    studio_id: UUID
    name: str
    description: str | None
    required_stamps: int
    reward_type: str
    reward_value: int
    reward_description: str | None
    is_active: bool

    class Config:
        from_attributes = True


@router.get("", response_model=list[StampCardOut])
def list_(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return list_stamp_cards(db, ctx.studio_id)


@router.post("", response_model=StampCardOut, dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))])
def create(payload: StampCardIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return create_stamp_card(db, ctx.studio_id, payload.model_dump())


@router.patch("/{card_id}", response_model=StampCardOut, dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))])
def patch(card_id: UUID, payload: StampCardIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    card = update_stamp_card(db, ctx.studio_id, card_id, payload.model_dump(exclude_unset=True))
    if not card:
        raise HTTPException(404, "Stamp card not found")
    return card


@router.delete("/{card_id}", dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))])
def delete(card_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if not delete_stamp_card(db, ctx.studio_id, card_id):
        raise HTTPException(404, "Stamp card not found")
    return {"ok": True}
