from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.auth_deps import get_current_user
from app.models.user import User
from app.models.lead import Lead
from app.models.client import Client

router = APIRouter(prefix="/leads", tags=["Leads"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class LeadOut(BaseModel):
    id: str
    name: str
    phone: Optional[str]
    email: Optional[str]
    source: str
    status: str
    service_interest: Optional[str]
    notes: Optional[str]
    campaign_name: Optional[str]
    ad_id: Optional[str]
    created_at: datetime
    updated_at: datetime


class LeadCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    source: str = "manual"
    service_interest: Optional[str] = None
    notes: Optional[str] = None


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    source: Optional[str] = None
    status: Optional[str] = None
    service_interest: Optional[str] = None
    notes: Optional[str] = None


def _out(l: Lead) -> LeadOut:
    return LeadOut(
        id=str(l.id),
        name=l.name,
        phone=l.phone,
        email=l.email,
        source=l.source,
        status=l.status,
        service_interest=l.service_interest,
        notes=l.notes,
        campaign_name=l.campaign_name,
        ad_id=l.ad_id,
        created_at=l.created_at,
        updated_at=l.updated_at,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[LeadOut])
def list_leads(
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Lead).where(Lead.studio_id == user.studio_id)
    if status:
        q = q.where(Lead.status == status)
    q = q.order_by(Lead.created_at.desc())
    return [_out(l) for l in db.scalars(q).all()]


@router.post("", response_model=LeadOut, status_code=201)
def create_lead(
    payload: LeadCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lead = Lead(
        id=uuid.uuid4(),
        studio_id=user.studio_id,
        name=payload.name.strip(),
        phone=payload.phone,
        email=payload.email,
        source=payload.source,
        service_interest=payload.service_interest,
        notes=payload.notes,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return _out(lead)


@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead(
    lead_id: uuid.UUID,
    payload: LeadUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.studio_id == user.studio_id))
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if payload.name is not None:
        lead.name = payload.name.strip()
    if payload.phone is not None:
        lead.phone = payload.phone
    if payload.email is not None:
        lead.email = payload.email
    if payload.source is not None:
        lead.source = payload.source
    if payload.status is not None:
        lead.status = payload.status
    if payload.service_interest is not None:
        lead.service_interest = payload.service_interest
    if payload.notes is not None:
        lead.notes = payload.notes

    db.commit()
    db.refresh(lead)
    return _out(lead)


@router.delete("/{lead_id}", status_code=204)
def delete_lead(
    lead_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.studio_id == user.studio_id))
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.delete(lead)
    db.commit()


@router.post("/{lead_id}/convert", response_model=dict)
def convert_to_client(
    lead_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Convert a lead into a client record and mark the lead as booked."""
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.studio_id == user.studio_id))
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # Check if a client with same phone/email already exists
    existing = None
    if lead.phone:
        existing = db.scalar(select(Client).where(Client.studio_id == user.studio_id, Client.phone == lead.phone))
    if not existing and lead.email:
        existing = db.scalar(select(Client).where(Client.studio_id == user.studio_id, Client.email == lead.email))

    if existing:
        lead.status = "booked"
        db.commit()
        return {"client_id": str(existing.id), "created": False}

    client = Client(
        id=uuid.uuid4(),
        studio_id=user.studio_id,
        full_name=lead.name,
        phone=lead.phone,
        email=lead.email,
        notes=f"הומר מליד ({lead.source})" + (f"\n{lead.notes}" if lead.notes else ""),
    )
    db.add(client)
    lead.status = "booked"
    db.commit()
    db.refresh(client)
    return {"client_id": str(client.id), "created": True}
