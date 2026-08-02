"""
Module & Feature gate — Generic Plans Engine (modules table also carries
fine-grained "permissions" via parent_module_id — see app/models/module.py).

Resolution order for any module_id (including a nested sub-capability):
  1. studio_modules explicit override (is_enabled true/false) → use it
  2. plan_modules for studio.subscription_plan → use plan default
  3. Default: DISABLED
  ...then repeat for every ancestor via parent_module_id — a sub-capability
  is only enabled if it AND all its ancestors resolve to enabled.

Usage:
    @router.get("/ocr")
    def ocr_endpoint(_: None = Depends(require_module("ocr")), ...):
        ...

require_feature()/StudioFeature below are deprecated — every backend call
site has moved to require_module() (see project_generic_plans_engine memory).
Kept only until a verified deploy cycle confirms nothing still depends on
them, then StudioFeature/FEATURES/the admin/studios/[id] toggle panel are
removed outright.
"""
from __future__ import annotations
from typing import Callable

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.studio_feature import StudioFeature
from app.utils.logger import get_logger

log = get_logger(__name__)


# ── Module system ─────────────────────────────────────────────────────────────

def _is_module_enabled_own(db: Session, studio_id, subscription_plan: str, module_id: str) -> bool:
    """
    Check if module_id itself (ignoring any parent) is enabled for a studio.
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


def is_module_enabled(db: Session, studio_id, subscription_plan: str, module_id: str) -> bool:
    """
    Check if module_id is enabled for a studio, honoring parent_module_id
    chains: a sub-capability (e.g. "invoice_ai_scan" nested under "ocr") is
    only truly enabled if it AND every ancestor module resolve to enabled —
    a studio whose "ocr" module is off can't have a sub-capability of it on.
    """
    from app.models.module import Module

    mid: str | None = module_id
    seen: set[str] = set()
    while mid is not None:
        if mid in seen:
            break  # defensive cycle guard — parent chains should never cycle
        seen.add(mid)
        if not _is_module_enabled_own(db, studio_id, subscription_plan, mid):
            return False
        mid = db.scalar(select(Module.parent_module_id).where(Module.id == mid))
    return True


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
    """
    Return all available modules with effective enabled status for a studio.
    Honors parent_module_id chains the same way is_module_enabled() does — a
    sub-capability shows disabled if its parent module is disabled, even if
    it has its own enabled override/plan default.
    """
    from app.models.module import Module, StudioModule, PlanModule

    all_modules = db.scalars(select(Module)).all()  # incl. unavailable, for parent lookups
    overrides = {r.module_id: r.is_enabled for r in db.scalars(
        select(StudioModule).where(StudioModule.studio_id == studio_id)
    ).all()}
    plan_defaults = {r.module_id for r in db.scalars(
        select(PlanModule).where(PlanModule.plan == (subscription_plan or "free"))
    ).all()}
    parent_of = {m.id: m.parent_module_id for m in all_modules}

    def own_enabled(mid: str) -> bool:
        return overrides[mid] if mid in overrides else (mid in plan_defaults)

    def effective_enabled(mid: str | None) -> bool:
        seen: set[str] = set()
        while mid is not None:
            if mid in seen:
                break
            seen.add(mid)
            if not own_enabled(mid):
                return False
            mid = parent_of.get(mid)
        return True

    return {
        m.id: effective_enabled(m.id)
        for m in all_modules if m.is_available
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
    """
    Deprecated — every backend route has moved to require_module(). Kept only
    so a forgotten call site doesn't hard-crash; logs so any remaining usage
    surfaces before StudioFeature/FEATURES are removed outright.
    """
    def _check(
        ctx: AuthContext = Depends(require_studio_ctx),
        db: Session = Depends(get_db),
    ) -> None:
        log.warning("[deprecated-require_feature] feature=%s studio_id=%s", feature, getattr(ctx, "studio_id", None))
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
