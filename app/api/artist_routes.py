from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.models.studio_settings import StudioSettings
from app.core.permissions import require_roles, require_permission, may_do, manager_permissions, MANAGER_PERMISSIONS, Perms
from app.schemas.user import UserOut, TeamMemberOut, ArtistCreate, ArtistUpdate
from app.crud.artist import create_artist, list_artists, update_artist, deactivate_artist
from app.services.plan_limits import check_staff_seat, staff_seats
from app.services import activity_log
from uuid import UUID

router = APIRouter(prefix="/users/artists", tags=["Artists"])

# What someone without the right to see pay gets instead of each colleague's pay: the defaults.
_PAY_FIELDS = ("pay_type", "hourly_rate", "commission_rate", "global_salary", "class_pay_mode", "class_pay_per_class",
               "class_pay_per_participant", "class_pay_minimum", "class_pay_percent", "class_pay_counts")
_NO_PAY = {f: UserOut.model_fields[f].default for f in _PAY_FIELDS}
_ROLE_WORDS = {"owner": "בעל העסק", "admin": "סגן מנהל", "artist": "נותן/ת שירות", "staff": "עובד/ת"}

@router.get("", response_model=list[TeamMemberOut])
def list_artists_endpoint(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Get a list of artists in the studio. Everyone's pay only for the owner and a manager allowed money — the other
    screens use this list for names and colors. The e-mails — each one's sign-in — only for who manages the team, and
    the owner's only for the owner (the owner, 2026-10-19: "the owner's details must be protected")."""
    sees_pay = may_do(db, ctx.studio_id, ctx.role, "money")
    sees_team = may_do(db, ctx.studio_id, ctx.role, "team")
    is_owner = ctx.role in (Perms.OWNER, "superadmin")
    out = []
    for u in list_artists(db, ctx.studio_id):
        hide = {} if sees_pay else dict(_NO_PAY)
        if not sees_team or (u.role == Perms.OWNER and not is_owner):
            hide["email"] = ""
        out.append(TeamMemberOut.model_validate(u).model_copy(update=hide))
    return out


@router.get("/seats")
def staff_seats_endpoint(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """How many staff the plan allows and how many there are — {used, limit, left}, the owner counted."""
    return staff_seats(db, ctx.studio_id)


@router.post(
    "",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(Perms.OWNER))]
)
def create_artist_endpoint(
    payload: ArtistCreate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Add a new artist to the studio — within the plan's staff (app/services/plan_limits.py)."""
    check_staff_seat(db, ctx.studio_id)
    try:
        user = create_artist(db, ctx.studio_id, payload)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="A user with this email already exists in this studio."
        )
    activity_log.record(db, ctx, "team", f"הוספה לצוות: {user.display_name or user.email} ({_ROLE_WORDS.get(user.role, user.role)})")
    return user

# ── What a manager may do — the owner's switches (core/permissions.MANAGER_PERMISSIONS) ─────────────────────────────

class ManagerPermissionsIn(BaseModel):
    permissions: dict[str, bool]


def _permissions_out(db: Session, studio_id) -> list[dict]:
    on = manager_permissions(db.get(StudioSettings, studio_id))
    return [{"key": k, "label": label, "on": on[k]} for k, (label, _) in MANAGER_PERMISSIONS.items()]


@router.get("/manager-permissions", dependencies=[Depends(require_roles(Perms.OWNER))])
def get_manager_permissions(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return _permissions_out(db, ctx.studio_id)


@router.put("/manager-permissions", dependencies=[Depends(require_roles(Perms.OWNER))])
def set_manager_permissions(body: ManagerPermissionsIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """The owner only — what a manager (סגן מנהל) may do in this business."""
    import json
    settings = db.get(StudioSettings, ctx.studio_id)
    if settings is None:
        raise HTTPException(status_code=404, detail="Settings not found")
    on = manager_permissions(settings)
    before = dict(on)
    on.update({k: bool(v) for k, v in body.permissions.items() if k in MANAGER_PERMISSIONS})
    settings.manager_permissions = json.dumps(on)
    db.commit()
    for k, (label, _) in MANAGER_PERMISSIONS.items():
        if on[k] != before[k]:
            activity_log.record(db, ctx, "team", f"סגן מנהל — {'הותר' if on[k] else 'נחסם'}: {label}")
    return _permissions_out(db, ctx.studio_id)


@router.patch(
    "/{user_id}",
    response_model=UserOut,
    dependencies=[Depends(require_permission("team"))]
)
def update_artist_endpoint(
    user_id: UUID,
    payload: ArtistUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Edit someone on the team. A manager (allowed the team) edits the workers only — never the owner or another
    manager, and makes no one a manager; the pay only with money allowed (his screen shows zeros instead of the pay)."""
    from app.models.user import User
    current = db.get(User, user_id)
    if current is None or current.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Artist not found")
    if current.role == Perms.OWNER:      # the owner stays the owner — the screen sends the role "artist" for his own row
        payload = payload.model_copy(update={"role": None})
        if payload.password is not None:
            # the owner's password only with the current one (settings → החשבון שלי) — never from the team screen, where an
            # open screen would be enough to take the business over (the owner, 2026-10-19)
            raise HTTPException(status_code=403, detail="את הסיסמה של בעל העסק משנים בהגדרות ← החשבון שלי, עם הסיסמה הנוכחית")
    if ctx.role != Perms.OWNER:
        _owner_only_for(current, payload.role)
        if not may_do(db, ctx.studio_id, ctx.role, "money"):
            payload = payload.model_copy(update={f: None for f in _PAY_FIELDS if f in ArtistUpdate.model_fields})
    if payload.is_active and not current.is_active:          # bringing someone back counts like adding them
        check_staff_seat(db, ctx.studio_id)
    before = {f: getattr(current, f, None) for f in ("display_name", "role", "is_active", *_PAY_FIELDS)}
    user = update_artist(db, ctx.studio_id, user_id, payload)
    if not user:
        raise HTTPException(status_code=404, detail="Artist not found")
    changed = []
    if user.display_name != before["display_name"]:
        changed.append("שם")
    if user.role != before["role"]:
        changed.append(f"תפקיד: {_ROLE_WORDS.get(user.role, user.role)}")
    if user.is_active != before["is_active"]:
        changed.append("החזרה לצוות" if user.is_active else "השבתה")
    if any(str(getattr(user, f, None)) != str(before[f]) for f in _PAY_FIELDS):
        changed.append("שכר")
    if payload.password is not None:
        changed.append("סיסמה חדשה")
    if changed:
        activity_log.record(db, ctx, "team", f"עדכון {user.display_name or user.email}: {', '.join(changed)}")
    return user


def _owner_only_for(target, new_role: str | None) -> None:
    """What only the owner does on the team: touch the owner or a manager, or make someone a manager."""
    if target.role in (Perms.OWNER, Perms.ADMIN) or new_role == Perms.ADMIN:
        raise HTTPException(status_code=403, detail="בעל העסק בלבד מנהל את המנהלים")

@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("team"))]
)
def delete_artist_endpoint(
    user_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Soft delete (deactivate) an artist."""
    # Prevent self-deletion as owner to not lock out
    if ctx.role == Perms.OWNER and str(ctx.user_id) == str(user_id):
        raise HTTPException(status_code=400, detail="Cannot delete your own main owner account.")
        
    from app.models.user import User
    target = db.get(User, user_id)
    if target is None or target.studio_id != ctx.studio_id:
        raise HTTPException(status_code=404, detail="Artist not found")
    if ctx.role != Perms.OWNER:
        _owner_only_for(target, None)
    ok = deactivate_artist(db, ctx.studio_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Artist not found")
    activity_log.record(db, ctx, "team", f"הסרה מהצוות: {target.display_name or target.email}")
    return None
