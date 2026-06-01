"""
Module & Feature gate — Phase 0 modular platform architecture.

Resolution order for any module/feature:
  1. studio_modules explicit override (is_enabled true/false) → use it
  2. plan_modules for studio.subscription_plan → use plan default
  3. studio_features legacy table (backward compat) → use it
  4. Default: DISABLED

Usage:
    # New module system
    @router.get("/ocr")
    def ocr_endpoint(_: None = Depends(require_module("ocr")), ...):
        ...

    # Legacy feature flag (unchanged)
    @router.get("/old")
    def old_endpoint(_: None = Depends(require_feature("some_flag")), ...):
        ...
"""
from __future__ import annotations
from typing import Callable

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.studio_feature import StudioFeature


# ── Module system ─────────────────────────────────────────────────────────────

def is_module_enabled(db: Session, studio_id, subscription_plan: str, module_id: str) -> bool:
    """
    Check if module_id is enabled for a studio.
    Priority: studio_modules override > plan_modules default > disabled.
    """
    from app.models.module import StudioModule, PlanModule

    # 1. Explicit studio override
    override = db.scalar(
        select(StudioModule).where(
            StudioModule.studio_id == studio_id,
            StudioModule.module_id == module_id,
        )
    )
    if override is not None:
        return override.is_enabled

    # 2. Plan default
    plan_row = db.scalar(
        select(PlanModule).where(
            PlanModule.plan == (subscription_plan or "free"),
            PlanModule.module_id == module_id,
        )
    )
    return plan_row is not None


def require_module(module_id: str) -> Callable:
    """
    FastAPI dependency. Returns 403 if module is not enabled for the studio.
    Superadmin always bypasses.
    """
    def _check(
        ctx: AuthContext = Depends(require_studio_ctx),
        db: Session = Depends(get_db),
    ) -> None:
        if getattr(ctx, "role", None) == "superadmin":
            return
        from app.models.studio import Studio
        studio = db.get(Studio, ctx.studio_id)
        plan = studio.subscription_plan if studio else "free"
        if not is_module_enabled(db, ctx.studio_id, plan, module_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Module '{module_id}' is not enabled for your studio. Upgrade your plan or contact support.",
            )
    return _check


def get_studio_modules(db: Session, studio_id, subscription_plan: str) -> dict[str, bool]:
    """Return all modules with enabled status for a studio."""
    from app.models.module import Module, StudioModule, PlanModule

    all_modules = db.scalars(select(Module).where(Module.is_available == True)).all()  # noqa
    overrides = {r.module_id: r.is_enabled for r in db.scalars(
        select(StudioModule).where(StudioModule.studio_id == studio_id)
    ).all()}
    plan_defaults = {r.module_id for r in db.scalars(
        select(PlanModule).where(PlanModule.plan == (subscription_plan or "free"))
    ).all()}

    return {
        m.id: overrides[m.id] if m.id in overrides else (m.id in plan_defaults)
        for m in all_modules
    }


# ── Legacy feature flags (backward compat) ───────────────────────────────────

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
    """Legacy feature flag dependency. Kept for backward compatibility."""
    def _check(
        ctx: AuthContext = Depends(require_studio_ctx),
        db: Session = Depends(get_db),
    ) -> None:
        if getattr(ctx, "role", None) == "superadmin":
            return
        if not _is_feature_enabled(db, ctx.studio_id, feature):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Feature '{feature}' is not enabled for your studio.",
            )
    return _check


def get_studio_features(db: Session, studio_id) -> dict[str, bool]:
    rows = db.scalars(
        select(StudioFeature).where(StudioFeature.studio_id == studio_id)
    ).all()
    return {r.feature: r.is_enabled for r in rows}
