"""GET /api/studio/features/me — legacy feature-flag status for the current studio."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.features import get_studio_features

router = APIRouter(prefix="/studio/features", tags=["StudioFeatures"])


@router.get("/me")
def get_my_features(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Return {feature: bool} for the current studio — superadmin-controlled toggles
    (e.g. "voice") that are off for everyone until superadmin turns them on."""
    return get_studio_features(db, ctx.studio_id)
