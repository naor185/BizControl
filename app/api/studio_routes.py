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
    
    existing = db.query(Studio).filter(Studio.slug == payload.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="Slug already exists")

    studio = Studio(
        id=uuid.uuid4(),
        name=payload.name,
        slug=payload.slug
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

    db.commit()

    return {"message": "Studio created successfully"}
