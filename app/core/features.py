"""
Feature flag enforcement.
Usage:
    @router.get("/my-endpoint")
    def my_endpoint(
        _: None = Depends(require_feature("marketing_analytics")),
        ctx: AuthContext = Depends(require_studio_ctx),
    ):
        ...
"""
from __future__ import annotations
from functools import lru_cache
from typing import Callable

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.studio_feature import StudioFeature


def _is_feature_enabled(db: Session, studio_id, feature: str) -> bool:
    row = db.scalar(
        select(StudioFeature).where(
            StudioFeature.studio_id == studio_id,
            StudioFeature.feature == feature,
            StudioFeature.is_enabled == True,  # noqa: E712
        )
    )
    return row is not None


def require_feature(feature: str) -> Callable:
    """
    FastAPI dependency factory.
    Returns 403 if the studio does not have `feature` enabled by Super Admin.
    """
    def _check(
        ctx: AuthContext = Depends(require_studio_ctx),
        db: Session = Depends(get_db),
    ) -> None:
        # Superadmin always bypasses feature gates
        if getattr(ctx, "role", None) == "superadmin":
            return
        if not _is_feature_enabled(db, ctx.studio_id, feature):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Feature '{feature}' is not enabled for your studio. Contact support to activate.",
            )
    return _check


def get_studio_features(db: Session, studio_id) -> dict[str, bool]:
    """Return all feature flags for a studio as a dict."""
    rows = db.scalars(
        select(StudioFeature).where(StudioFeature.studio_id == studio_id)
    ).all()
    return {r.feature: r.is_enabled for r in rows}
