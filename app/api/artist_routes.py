from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.core.permissions import require_roles, Perms
from app.schemas.user import UserOut, ArtistCreate, ArtistUpdate
from app.crud.artist import create_artist, list_artists, update_artist, deactivate_artist
from uuid import UUID

router = APIRouter(prefix="/users/artists", tags=["Artists"])

# What someone without the right to see pay gets instead of each colleague's pay: the defaults.
_PAY_FIELDS = ("pay_type", "hourly_rate", "commission_rate", "global_salary", "class_pay_mode", "class_pay_per_class",
               "class_pay_per_participant", "class_pay_minimum", "class_pay_percent", "class_pay_counts")
_NO_PAY = {f: UserOut.model_fields[f].default for f in _PAY_FIELDS}

@router.get("", response_model=list[UserOut])
def list_artists_endpoint(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Get a list of artists in the studio. Everyone's pay only for the owner and the managers — the other
    screens use this list for names and colors."""
    from app.api.staff_routes import PAY_VIEWERS
    users = list_artists(db, ctx.studio_id)
    if ctx.role in PAY_VIEWERS:
        return users
    return [UserOut.model_validate(u).model_copy(update=_NO_PAY) for u in users]


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
    """Add a new artist to the studio."""
    try:
        return create_artist(db, ctx.studio_id, payload)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="A user with this email already exists in this studio."
        )

@router.patch(
    "/{user_id}",
    response_model=UserOut,
    dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))]
)
def update_artist_endpoint(
    user_id: UUID,
    payload: ArtistUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Edit an existing artist."""
    # Prevent editing the root owner unless it's yourself
    if ctx.role != Perms.OWNER and str(user_id) == str(ctx.user_id):
        # Admins can't edit other admins/owners (simplified assumption)
        pass

    user = update_artist(db, ctx.studio_id, user_id, payload)
    if not user:
        raise HTTPException(status_code=404, detail="Artist not found")
    return user

@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))]
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
        
    ok = deactivate_artist(db, ctx.studio_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Artist not found")
    return None
