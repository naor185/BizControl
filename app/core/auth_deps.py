from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User
from app.models.studio import Studio

bearer = HTTPBearer(auto_error=False)

def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not creds:
        raise HTTPException(status_code=401, detail="Missing token")

    token = creds.credentials
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("user_id")
    studio_id = payload.get("studio_id")
    if not user_id or not studio_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == user_id, User.studio_id == studio_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Plan enforcement — superadmin and platform studio are always exempt
    if user.role != "superadmin":
        studio = db.get(Studio, user.studio_id)
        if studio and not studio.is_platform:
            if not studio.is_active:
                raise HTTPException(status_code=402, detail="STUDIO_SUSPENDED")
            if studio.plan_expires_at and studio.plan_expires_at < datetime.now(timezone.utc):
                raise HTTPException(status_code=402, detail="PLAN_EXPIRED")

    return user
