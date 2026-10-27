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


# What a manager (admin) may do — the owner switches each on or off (the owner, 2026-10-13: "only the owner issues
# receipts and changes settings"). The owner and the superadmin may always; a worker never. Kept per business in
# studio_settings.manager_permissions (a JSON of the ones set; the rest are at their default).
MANAGER_PERMISSIONS: dict[str, tuple[str, bool]] = {
    "settings": ("שינוי הגדרות העסק", False),
    "receipts": ("קבלות, חשבוניות וזיכויים", False),
    "money": ("הוצאות, שכר ודוחות כספיים", False),
    "team": ("ניהול הצוות", False),
    "attendance": ("תיקון שעות נוכחות", True),
}


# What a worker (artist / staff) may do beyond their own calendar, the health declarations, the clock and their shifts —
# the owner switches each on or off for each worker (the owner, 2026-10-27: "and what about a regular worker?"). All off
# by default. Kept on the user, users.worker_permissions (a JSON of the ones set).
WORKER_PERMISSIONS: dict[str, str] = {
    "all_calendars": "יומן של כל הצוות — לראות ולקבוע תורים גם אצל אחרים",
    "payments": "גבייה ומקדמות — לרשום תשלום ולאשר מקדמה",
    "pos": "קופה — מכירות בקופה",
    "clients": "לקוחות ולידים — לראות ולטפל",
}


def worker_permissions(user) -> dict[str, bool]:
    import json
    try:
        saved = json.loads(getattr(user, "worker_permissions", None) or "{}")
    except (ValueError, TypeError):
        saved = {}
    return {k: bool(saved.get(k, False)) for k in WORKER_PERMISSIONS}


def worker_may(db, role: str | None, user_id, perm: str) -> bool:
    """A worker — only what the owner switched on for them; anyone else isn't limited here (their own rules apply)."""
    if role not in WORKERS:
        return True
    return worker_permissions(db.get(User, user_id))[perm]


def workers_with(perm: str, *, read_free: bool = False, read_only: bool = False, only_paths: tuple[str, ...] = ()):
    """FastAPI dependency for an area that is the management's — and a worker's the owner allowed `perm`
    (WORKER_PERMISSIONS). read_free: every worker may read it, a change needs `perm` (the calendar reads the services);
    read_only: a worker with `perm` may read, not change (the till reads the products); only_paths: a worker with `perm`
    may use only these (the till redeems a gift card, it doesn't manage them)."""
    from app.core.deps import AuthContext, require_studio_ctx
    from app.db.deps import get_db

    def dep(request: Request, ctx: AuthContext = Depends(require_studio_ctx), db=Depends(get_db)) -> AuthContext:
        if ctx.role not in WORKERS:
            return ctx
        reading = request.method in ("GET", "HEAD", "OPTIONS")
        if read_free and reading:
            return ctx
        allowed = worker_may(db, ctx.role, ctx.user_id, perm)
        if allowed and read_only and not reading:
            allowed = False
        if allowed and only_paths and not any(request.url.path.endswith(p) for p in only_paths):
            allowed = False
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail=f"{WORKER_PERMISSIONS[perm].split(' — ')[0]} — בעל העסק לא אפשר את זה לך")
        return ctx

    return dep


def manager_permissions(settings) -> dict[str, bool]:
    import json
    try:
        saved = json.loads(getattr(settings, "manager_permissions", None) or "{}")
    except (ValueError, TypeError):
        saved = {}
    return {k: bool(saved.get(k, default)) for k, (_, default) in MANAGER_PERMISSIONS.items()}


def may_do(db, studio_id, role: str | None, perm: str) -> bool:
    if role in ("owner", "superadmin"):
        return True
    if role != "admin":
        return False
    from app.models.studio_settings import StudioSettings
    return manager_permissions(db.get(StudioSettings, studio_id))[perm]


def _refuse(role: str | None, perm: str):
    if role == "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"{MANAGER_PERMISSIONS[perm][0]} — בעל העסק לא אפשר את זה לסגן המנהל")
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="האזור הזה של בעל העסק והמנהלים")


def require_permission(perm: str):
    """FastAPI dependency: the owner — or a manager the owner allowed `perm`."""
    from app.core.deps import AuthContext, require_studio_ctx
    from app.db.deps import get_db

    def dep(ctx: AuthContext = Depends(require_studio_ctx), db=Depends(get_db)) -> AuthContext:
        if not may_do(db, ctx.studio_id, ctx.role, perm):
            _refuse(ctx.role, perm)
        return ctx

    return dep


def writes_need(perm: str):
    """FastAPI dependency: anyone reads (a worker's calendar too); a change needs `perm`."""
    from app.core.deps import AuthContext, require_studio_ctx
    from app.db.deps import get_db

    def dep(request: Request, ctx: AuthContext = Depends(require_studio_ctx), db=Depends(get_db)) -> AuthContext:
        if request.method not in ("GET", "HEAD", "OPTIONS") and not may_do(db, ctx.studio_id, ctx.role, perm):
            _refuse(ctx.role, perm)
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
