import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.core.auth_deps import get_current_user
from app.models.studio import Studio
from app.models.user import User
from app.models.refresh_token import RefreshToken
from app.schemas.auth_schemas import LoginRequest, TokenResponse, RefreshRequest

router = APIRouter(prefix="/auth", tags=["Auth"])
ph = PasswordHasher()

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    studio = db.query(Studio).filter(Studio.slug == payload.studio_slug, Studio.is_active == True).first()
    if not studio:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    email = str(payload.email).lower().strip()
    user = db.query(User).filter(User.studio_id == studio.id, User.email == email, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    try:
        ph.verify(user.password_hash, payload.password)
    except VerifyMismatchError:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access = create_access_token({"user_id": str(user.id), "studio_id": str(studio.id), "role": user.role})
    refresh = create_refresh_token({"user_id": str(user.id), "studio_id": str(studio.id)})

    db.add(RefreshToken(
        id=uuid.uuid4(),
        studio_id=studio.id,
        user_id=user.id,
        token=refresh,
        is_revoked=False
    ))
    db.commit()

    return TokenResponse(access_token=access, refresh_token=refresh)

@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    # Verify refresh token signature + type
    try:
        data = decode_token(payload.refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token type")

    user_id = data.get("user_id")
    studio_id = data.get("studio_id")
    if not user_id or not studio_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token payload")

    # Check token exists + not revoked
    token_row = db.query(RefreshToken).filter(RefreshToken.token == payload.refresh_token, RefreshToken.is_revoked == False).first()
    if not token_row:
        raise HTTPException(status_code=401, detail="Refresh token revoked or not found")

    user = db.query(User).filter(User.id == user_id, User.studio_id == studio_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access = create_access_token({"user_id": str(user.id), "studio_id": str(user.studio_id), "role": user.role})
    new_refresh = create_refresh_token({"user_id": str(user.id), "studio_id": str(user.studio_id)})

    # rotate refresh: revoke old, store new
    token_row.is_revoked = True
    db.add(RefreshToken(
        id=uuid.uuid4(),
        studio_id=user.studio_id,
        user_id=user.id,
        token=new_refresh,
        is_revoked=False
    ))
    db.commit()

    return TokenResponse(access_token=new_access, refresh_token=new_refresh)

@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "display_name": current_user.display_name,
        "role": current_user.role,
        "studio_id": str(current_user.studio_id),
    }
