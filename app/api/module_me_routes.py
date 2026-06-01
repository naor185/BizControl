"""GET /api/modules/me — returns enabled modules for the current studio."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.features import get_studio_modules
from app.models.studio import Studio

router = APIRouter(prefix="/modules", tags=["Modules"])


@router.get("/me")
def get_my_modules(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Return a dict of {module_id: bool} for the current studio's plan + overrides."""
    studio = db.get(Studio, ctx.studio_id)
    plan = studio.subscription_plan if studio else "free"
    return get_studio_modules(db, ctx.studio_id, plan)
