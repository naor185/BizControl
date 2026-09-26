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


# The business's management — the owner and the managers (admin), and the platform's superadmin: everyone's pay
# (the payroll, the team's rates) and giving money back (a credit note) are theirs only.
MANAGEMENT = ("owner", "admin", "superadmin")


def require_management(what: str):
    """FastAPI dependency: only the business's management — `what` says, in the refusal, what is theirs."""
    from app.core.deps import AuthContext, require_studio_ctx

    def dep(ctx: AuthContext = Depends(require_studio_ctx)) -> AuthContext:
        if ctx.role not in MANAGEMENT:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{what} — רק לבעלים או למנהל")
        return ctx

    return dep


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


# Who may do what with classes and memberships (the approved plan's permissions table), in the roles
# the system has (ck_users_role): owner; admin — the manager; staff — a worker without management (the
# front desk); artist — the one giving the service, shown in each business's own word (מדריך/ה,
# מאמן/ת…), marking attendance limited to their own classes where it is used. Superadmin may do
# everything. There is no accountant role — reports stay with owner and admin until there is one.
CLASS_ACTIONS: dict[str, frozenset[str]] = {
    "classes.configure":  frozenset({"owner", "admin"}),                     # rooms, templates, membership types, settings
    "sessions.change":    frozenset({"owner", "admin"}),                     # cancel or change one class
    "bookings.manage":    frozenset({"owner", "admin", "staff"}),            # book / cancel for a client
    "attendance.mark":    frozenset({"owner", "admin", "staff", "artist"}),
    "memberships.sell":   frozenset({"owner", "admin", "staff"}),
    "memberships.change": frozenset({"owner", "admin"}),                     # freeze, stop, cancel
    "limits.override":    frozenset({"owner", "admin"}),                     # over capacity / eligibility (logged)
    "reports.view":       frozenset({"owner", "admin"}),
}


def may(role: str | None, action: str) -> bool:
    return role == "superadmin" or role in CLASS_ACTIONS[action]


def require_action(action: str):
    """FastAPI dependency: the signed-in user's role may do this class/membership action."""
    from app.core.deps import AuthContext, require_studio_ctx
    if action not in CLASS_ACTIONS:
        raise ValueError(f"unknown action: {action}")

    def dep(ctx: AuthContext = Depends(require_studio_ctx)) -> AuthContext:
        if not may(ctx.role, action):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="אין לך הרשאה לפעולה הזו")
        return ctx

    return dep


def same_studio_guard(record_studio_id, user: User):
    """Check that the record belongs to the same studio as the user."""
    if str(record_studio_id) != str(user.studio_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
