from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, status

from app.core.auth_deps import get_current_user
from app.models.user import User


@dataclass(frozen=True)
class Perms:
    OWNER = "owner"
    ADMIN = "admin"
    MANAGER = "manager"
    RECEPTIONIST = "receptionist"
    ARTIST = "artist"
    ACCOUNTANT = "accountant"


def require_roles(*allowed_roles: str):
    allowed = set(allowed_roles)

    def dep(current_user: User = Depends(get_current_user)) -> User:
        role = getattr(current_user, "role", None)
        if role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden (role='{role}')",
            )
        return current_user

    return dep


def same_studio_guard(record_studio_id, user: User):
    """Check that the record belongs to the same studio as the user."""
    if str(record_studio_id) != str(user.studio_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
