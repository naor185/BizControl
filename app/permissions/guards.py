from fastapi import HTTPException, status
from .roles import UserRole


def require_role(required_role: UserRole):

    def role_checker(user):

        if user.role != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )

        return user

    return role_checker
