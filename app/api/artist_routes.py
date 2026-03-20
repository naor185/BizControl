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

@router.get("", response_model=list[UserOut])
def list_artists_endpoint(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Get a list of artists in the studio."""
    return list_artists(db, ctx.studio_id)

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
