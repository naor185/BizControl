from __future__ import annotations
from dataclasses import dataclass
from uuid import UUID
from fastapi import Depends

from app.models.user import User
from app.core.auth_deps import get_current_user

@dataclass(frozen=True)
class AuthContext:
    studio_id: UUID
    user_id: UUID
    role: str  # "owner" | "admin" | "artist"

def require_studio_ctx(user: User = Depends(get_current_user)) -> AuthContext:
    return AuthContext(
        studio_id=user.studio_id,
        user_id=user.id,
        role=str(user.role)
    )
