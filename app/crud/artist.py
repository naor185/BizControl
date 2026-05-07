from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session
from argon2 import PasswordHasher

from app.models.user import User
from app.schemas.user import ArtistCreate, ArtistUpdate

ph = PasswordHasher()

def list_artists(db: Session, studio_id: UUID) -> list[User]:
    stmt = select(User).where(
        User.studio_id == studio_id,
        User.role.in_(["owner", "admin", "artist", "staff"]),
        User.is_active == True
    ).order_by(User.created_at.desc())
    return list(db.scalars(stmt).all())

def create_artist(db: Session, studio_id: UUID, data: ArtistCreate) -> User:
    hashed = ph.hash(data.password)
    user = User(
        studio_id=studio_id,
        email=str(data.email).lower().strip(),
        password_hash=hashed,
        role=data.role or "artist",
        is_active=True,
        display_name=data.display_name.strip(),
        calendar_color=data.calendar_color,
        pay_type=data.pay_type or "none",
        hourly_rate=data.hourly_rate or 0.0,
        commission_rate=data.commission_rate or 0.0
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

def update_artist(db: Session, studio_id: UUID, user_id: UUID, data: ArtistUpdate) -> User | None:
    stmt = select(User).where(
        User.studio_id == studio_id,
        User.id == user_id,
        User.role.in_(["owner", "admin", "artist", "staff"])
    )
    user = db.scalar(stmt)
    if not user:
        return None

    if data.display_name is not None:
        user.display_name = data.display_name.strip()
    if data.role is not None:
        user.role = data.role
    if data.calendar_color is not None:
        user.calendar_color = data.calendar_color
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.pay_type is not None:
        user.pay_type = data.pay_type
    if data.hourly_rate is not None:
        user.hourly_rate = data.hourly_rate
    if data.commission_rate is not None:
        user.commission_rate = data.commission_rate
    if data.password is not None:
        user.password_hash = ph.hash(data.password)

    db.commit()
    db.refresh(user)
    return user

def deactivate_artist(db: Session, studio_id: UUID, user_id: UUID) -> bool:
    stmt = select(User).where(
        User.studio_id == studio_id,
        User.id == user_id,
        User.role.in_(["owner", "admin", "artist", "staff"])
    )
    user = db.scalar(stmt)
    if not user:
        return False
        
    user.is_active = False
    db.commit()
    return True
