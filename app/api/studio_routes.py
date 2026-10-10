from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.studio import Studio
from app.models.user import User
from app.models.studio_settings import StudioSettings
from app.schemas.studio_schemas import StudioRegisterRequest, StudioRegisterResponse
from argon2 import PasswordHasher
import uuid

router = APIRouter(prefix="/studios", tags=["Studios"])

ph = PasswordHasher()

@router.post("/register", response_model=StudioRegisterResponse)
def register_studio(payload: StudioRegisterRequest, db: Session = Depends(get_db)):
    """A new business, in the free month like every new business (owner, 2026-10-10) — it used to open on the
    old free plan with no end date. The sign-up people use is BizFind's (/api/marketplace/auth/register)."""
    from datetime import datetime, timedelta, timezone
    from app.core.billing import apply_subscription_event
    from app.models.module import Plan

    existing = db.query(Studio).filter(Studio.slug == payload.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="Slug already exists")

    trial = db.get(Plan, "trial")
    now = datetime.now(timezone.utc)
    ends = now + timedelta(days=trial.trial_days if trial else 30)
    studio = Studio(
        id=uuid.uuid4(),
        name=payload.name,
        slug=payload.slug,
        subscription_plan="trial",
        plan_expires_at=ends,
    )
    db.add(studio)
    db.flush()

    email = str(payload.email).lower().strip()

    user = User(
        id=uuid.uuid4(),
        studio_id=studio.id,
        email=email,
        password_hash=ph.hash(payload.password),
        role="owner"
    )
    db.add(user)

    settings = StudioSettings(
        studio_id=studio.id
    )
    db.add(settings)
    db.flush()
    apply_subscription_event(db, studio.id, "trial_started", source="customer", plan_id="trial",
                             current_period_start=now, current_period_end=ends, trial_ends_at=ends)   # commits

    return {"message": "Studio created successfully"}
