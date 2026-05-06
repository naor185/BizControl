"""
Super Admin API — only accessible to users with role='superadmin'.
Provides full control over all studios in the platform.
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from pydantic import BaseModel
from argon2 import PasswordHasher

from app.core.database import get_db
from app.core.auth_deps import get_current_user
from app.core.security import create_access_token
from app.models.user import User
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.appointment import Appointment
from app.models.client import Client
from app.models.message_job import MessageJob

router = APIRouter(prefix="/admin", tags=["SuperAdmin"])
ph = PasswordHasher()

ADMIN_SETUP_SECRET = os.getenv("ADMIN_SETUP_SECRET", "bizcontrol-setup-secret")
PLATFORM_SLUG = os.getenv("PLATFORM_SLUG", "bizcontrol-platform")


# ── Dependency ────────────────────────────────────────────────────────────────

def require_superadmin(user: User = Depends(get_current_user)) -> User:
    if user.role != "superadmin":
        raise HTTPException(status_code=403, detail="Super admin access required")
    return user


# ── Schemas ───────────────────────────────────────────────────────────────────

class StudioOut(BaseModel):
    id: str
    name: str
    slug: str
    subscription_plan: str
    is_active: bool
    plan_expires_at: Optional[datetime]
    created_at: datetime
    owner_email: Optional[str]
    client_count: int
    appointment_count_month: int

class GlobalStats(BaseModel):
    total_studios: int
    active_studios: int
    new_studios_month: int
    total_clients: int
    total_appointments_month: int
    pending_messages: int

class CreateStudioIn(BaseModel):
    studio_name: str
    slug: str
    owner_email: str
    owner_password: str
    owner_display_name: str
    subscription_plan: str = "starter"
    plan_days: int = 30

class UpdateStudioIn(BaseModel):
    is_active: Optional[bool] = None
    subscription_plan: Optional[str] = None
    plan_days: Optional[int] = None  # extend by N days from now

class SetupIn(BaseModel):
    secret: str
    email: str
    password: str
    display_name: str = "Super Admin"


# ── Setup (one-time) ──────────────────────────────────────────────────────────

@router.post("/setup", tags=["SuperAdmin"])
def setup_superadmin(payload: SetupIn, db: Session = Depends(get_db)):
    """
    One-time setup: creates the platform studio + first superadmin user.
    Protected by ADMIN_SETUP_SECRET env var.
    """
    if payload.secret != ADMIN_SETUP_SECRET:
        raise HTTPException(status_code=403, detail="Invalid setup secret")

    # Check no superadmin exists yet
    existing = db.scalar(select(User).where(User.role == "superadmin"))
    if existing:
        raise HTTPException(status_code=409, detail="Superadmin already exists")

    # Create platform studio
    platform = Studio(
        id=uuid.uuid4(),
        name="BizControl Platform",
        slug=PLATFORM_SLUG,
        subscription_plan="platform",
        is_active=True,
        is_platform=True,
    )
    db.add(platform)
    db.flush()

    # Create default settings for platform studio
    db.add(StudioSettings(studio_id=platform.id))
    db.flush()

    # Create superadmin user
    admin_user = User(
        id=uuid.uuid4(),
        studio_id=platform.id,
        email=payload.email.lower().strip(),
        password_hash=ph.hash(payload.password),
        role="superadmin",
        display_name=payload.display_name,
        is_active=True,
    )
    db.add(admin_user)
    db.commit()

    return {"status": "created", "email": admin_user.email, "slug": PLATFORM_SLUG}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=GlobalStats)
def global_stats(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_studios = db.scalar(select(func.count(Studio.id)).where(Studio.is_platform == False)) or 0  # noqa: E712
    active_studios = db.scalar(select(func.count(Studio.id)).where(Studio.is_platform == False, Studio.is_active == True)) or 0  # noqa: E712
    new_month = db.scalar(select(func.count(Studio.id)).where(Studio.is_platform == False, Studio.created_at >= month_start)) or 0
    total_clients = db.scalar(select(func.count(Client.id))) or 0
    appts_month = db.scalar(select(func.count(Appointment.id)).where(Appointment.starts_at >= month_start)) or 0
    pending_msgs = db.scalar(select(func.count(MessageJob.id)).where(MessageJob.status == "pending")) or 0

    return GlobalStats(
        total_studios=total_studios,
        active_studios=active_studios,
        new_studios_month=new_month,
        total_clients=total_clients,
        total_appointments_month=appts_month,
        pending_messages=pending_msgs,
    )


# ── Studios List ──────────────────────────────────────────────────────────────

@router.get("/studios", response_model=list[StudioOut])
def list_studios(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    studios = db.scalars(
        select(Studio).where(Studio.is_platform == False).order_by(Studio.created_at.desc())  # noqa: E712
    ).all()

    result = []
    for s in studios:
        owner = db.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
        client_count = db.scalar(select(func.count(Client.id)).where(Client.studio_id == s.id)) or 0
        appt_count = db.scalar(
            select(func.count(Appointment.id)).where(
                Appointment.studio_id == s.id,
                Appointment.starts_at >= month_start
            )
        ) or 0
        result.append(StudioOut(
            id=str(s.id),
            name=s.name,
            slug=s.slug,
            subscription_plan=s.subscription_plan,
            is_active=s.is_active,
            plan_expires_at=s.plan_expires_at,
            created_at=s.created_at,
            owner_email=owner.email if owner else None,
            client_count=client_count,
            appointment_count_month=appt_count,
        ))
    return result


# ── Create Studio ─────────────────────────────────────────────────────────────

@router.post("/studios", response_model=StudioOut)
def create_studio(payload: CreateStudioIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    if db.scalar(select(Studio).where(Studio.slug == payload.slug)):
        raise HTTPException(status_code=409, detail="Slug already taken")

    expires = datetime.now(timezone.utc) + timedelta(days=payload.plan_days)

    studio = Studio(
        id=uuid.uuid4(),
        name=payload.studio_name,
        slug=payload.slug,
        subscription_plan=payload.subscription_plan,
        is_active=True,
        plan_expires_at=expires,
        is_platform=False,
    )
    db.add(studio)
    db.flush()

    db.add(StudioSettings(studio_id=studio.id))

    owner = User(
        id=uuid.uuid4(),
        studio_id=studio.id,
        email=payload.owner_email.lower().strip(),
        password_hash=ph.hash(payload.owner_password),
        role="owner",
        display_name=payload.owner_display_name,
        is_active=True,
    )
    db.add(owner)
    db.commit()

    return StudioOut(
        id=str(studio.id),
        name=studio.name,
        slug=studio.slug,
        subscription_plan=studio.subscription_plan,
        is_active=studio.is_active,
        plan_expires_at=studio.plan_expires_at,
        created_at=studio.created_at,
        owner_email=owner.email,
        client_count=0,
        appointment_count_month=0,
    )


# ── Update Studio ─────────────────────────────────────────────────────────────

@router.patch("/studios/{studio_id}")
def update_studio(studio_id: uuid.UUID, payload: UpdateStudioIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")

    if payload.is_active is not None:
        studio.is_active = payload.is_active
    if payload.subscription_plan is not None:
        studio.subscription_plan = payload.subscription_plan
    if payload.plan_days is not None:
        base = max(datetime.now(timezone.utc), studio.plan_expires_at or datetime.now(timezone.utc))
        studio.plan_expires_at = base + timedelta(days=payload.plan_days)

    db.commit()
    return {"status": "updated"}


# ── Delete Studio ─────────────────────────────────────────────────────────────

@router.delete("/studios/{studio_id}")
def delete_studio(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")
    db.delete(studio)
    db.commit()
    return {"status": "deleted"}


# ── Impersonate ───────────────────────────────────────────────────────────────

@router.post("/impersonate/{studio_id}")
def impersonate(studio_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    studio = db.get(Studio, studio_id)
    if not studio or studio.is_platform:
        raise HTTPException(status_code=404, detail="Studio not found")

    owner = db.scalar(select(User).where(User.studio_id == studio_id, User.role == "owner", User.is_active == True))  # noqa: E712
    if not owner:
        raise HTTPException(status_code=404, detail="Studio owner not found")

    token = create_access_token({
        "user_id": str(owner.id),
        "studio_id": str(studio_id),
        "role": owner.role,
        "impersonated_by": str(admin.id),
    })
    return {
        "access_token": token,
        "studio_name": studio.name,
        "studio_slug": studio.slug,
        "owner_email": owner.email,
    }
