from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status

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


# The people who give the service and the staff — their screens are the calendar, the health declarations and the
# attendance clock (web RequireAuth). The server keeps them out of the rest too, not only the screens (the owner,
# 2026-10-13: "permissions on the server, not just hidden buttons").
WORKERS = ("artist", "staff")


def no_workers():
    """FastAPI dependency for a whole area that is the business's management's — money, reports, settings,
    integrations."""
    from app.core.deps import AuthContext, require_studio_ctx

    def dep(ctx: AuthContext = Depends(require_studio_ctx)) -> AuthContext:
        if ctx.role in WORKERS:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="האזור הזה של בעל העסק והמנהלים")
        return ctx

    return dep


def workers_read_only():
    """FastAPI dependency for an area the worker's calendar reads (the services, the calendar's hours…) but only
    management changes."""
    from app.core.deps import AuthContext, require_studio_ctx

    def dep(request: Request, ctx: AuthContext = Depends(require_studio_ctx)) -> AuthContext:
        if ctx.role in WORKERS and request.method not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="רק בעל העסק או מנהל יכולים לשנות את זה")
        return ctx

    return dep


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
