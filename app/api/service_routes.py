"""Service catalog CRUD — per-studio service management."""
from __future__ import annotations
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db
from app.models.service import Service, ServiceStaff

router = APIRouter(prefix="/services", tags=["Services"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ServiceCreate(BaseModel):
    name: str = Field(..., max_length=128)
    description: Optional[str] = None
    duration_minutes: int = Field(60, ge=5, le=480)
    price_cents: int = Field(0, ge=0)
    color: str = Field("#7c3aed", max_length=16)
    category: Optional[str] = Field(None, max_length=64)
    is_active: bool = True
    requires_consultation: bool = False
    is_bookable_online: bool = False
    sort_order: int = 0
    staff_ids: list[str] = []


class ServiceUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=128)
    description: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    price_cents: Optional[int] = Field(None, ge=0)
    color: Optional[str] = Field(None, max_length=16)
    category: Optional[str] = Field(None, max_length=64)
    is_active: Optional[bool] = None
    requires_consultation: Optional[bool] = None
    is_bookable_online: Optional[bool] = None
    sort_order: Optional[int] = None
    staff_ids: Optional[list[str]] = None


class ServiceResponse(BaseModel):
    id: str
    studio_id: str
    name: str
    description: Optional[str]
    duration_minutes: int
    price_cents: int
    price_ils: float
    color: str
    category: Optional[str]
    is_active: bool
    requires_consultation: bool
    is_bookable_online: bool
    sort_order: int
    staff_ids: list[str]

    model_config = {"from_attributes": True}


def _to_response(s: Service) -> dict:
    return {
        "id": str(s.id),
        "studio_id": str(s.studio_id),
        "name": s.name,
        "description": s.description,
        "duration_minutes": s.duration_minutes,
        "price_cents": s.price_cents,
        "price_ils": s.price_cents / 100,
        "color": s.color,
        "category": s.category,
        "is_active": s.is_active,
        "requires_consultation": s.requires_consultation,
        "is_bookable_online": s.is_bookable_online,
        "sort_order": s.sort_order,
        "staff_ids": [str(ss.user_id) for ss in s.staff],
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[ServiceResponse])
def list_services(
    active_only: bool = True,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    q = select(Service).where(Service.studio_id == ctx.studio_id)
    if active_only:
        q = q.where(Service.is_active == True)  # noqa
    q = q.order_by(Service.sort_order, Service.name)
    return [_to_response(s) for s in db.scalars(q).all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_service(
    payload: ServiceCreate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    svc = Service(
        studio_id=ctx.studio_id,
        name=payload.name,
        description=payload.description,
        duration_minutes=payload.duration_minutes,
        price_cents=payload.price_cents,
        color=payload.color,
        category=payload.category,
        is_active=payload.is_active,
        requires_consultation=payload.requires_consultation,
        is_bookable_online=payload.is_bookable_online,
        sort_order=payload.sort_order,
    )
    db.add(svc)
    db.flush()
    for uid in payload.staff_ids:
        db.add(ServiceStaff(service_id=svc.id, user_id=uuid.UUID(uid)))
    db.commit()
    db.refresh(svc)
    return _to_response(svc)


@router.put("/{service_id}")
def update_service(
    service_id: uuid.UUID,
    payload: ServiceUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    svc = db.scalar(select(Service).where(
        Service.id == service_id, Service.studio_id == ctx.studio_id
    ))
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    for field, val in payload.model_dump(exclude_unset=True, exclude={"staff_ids"}).items():
        setattr(svc, field, val)
    if payload.staff_ids is not None:
        db.query(ServiceStaff).filter_by(service_id=service_id).delete()
        for uid in payload.staff_ids:
            db.add(ServiceStaff(service_id=svc.id, user_id=uuid.UUID(uid)))
    db.commit()
    db.refresh(svc)
    return _to_response(svc)


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    service_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    svc = db.scalar(select(Service).where(
        Service.id == service_id, Service.studio_id == ctx.studio_id
    ))
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    db.delete(svc)
    db.commit()


@router.post("/seed-from-template")
def seed_from_business_type_template(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Populate services from the studio's business_type template."""
    from app.models.studio import Studio
    from app.models.module import BusinessTypeTemplate
    studio = db.get(Studio, ctx.studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    tmpl = db.get(BusinessTypeTemplate, studio.business_type or "other")
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    created = []
    for i, svc_data in enumerate(tmpl.default_services or []):
        svc = Service(
            studio_id=ctx.studio_id,
            name=svc_data.get("name", "שירות"),
            duration_minutes=svc_data.get("duration_minutes", 60),
            price_cents=int(svc_data.get("price", 0) * 100),
            color=svc_data.get("color", "#7c3aed"),
            sort_order=i,
        )
        db.add(svc)
        created.append(svc.name)
    db.commit()
    return {"created": created}
