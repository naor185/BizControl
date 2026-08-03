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
from datetime import datetime, timezone
from typing import Callable, TypedDict

import pytz
from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.studio_feature import StudioFeature
from app.utils.logger import get_logger

log = get_logger(__name__)

_IL_TZ = pytz.timezone("Asia/Jerusalem")
PERIOD_TYPES = ("daily", "weekly", "monthly", "yearly", "lifetime", "unlimited")
ON_EXCEED_ACTIONS = ("block", "warn_only", "allow_overage", "paid_overage", "auto_increase", "custom")


# ── Module system ─────────────────────────────────────────────────────────────

def _active_addon_grants(db: Session, studio_id, addon_ids_override: list[str] | None = None) -> dict[str, int]:
    """
    {module_id: summed limit_delta} for every module granted by the studio's
    currently-active add-ons (app/models/addon.py). Key presence means at
    least one active add-on grants that module — callers checking
    enablement just check `in`; callers computing quota sum the values
    (0 if no delta was set, still meaning "granted").

    addon_ids_override lets a caller ask "what if these add-ons were active"
    instead of querying the studio's real studio_addons — used by the Plan
    Preview ("toggle add-ons on/off and see the effect"), never by real
    enforcement paths (those always pass None and get the studio's actual
    active add-ons).
    """
    from app.models.addon import AddonModule, StudioAddon

    if addon_ids_override is not None:
        addon_ids = set(addon_ids_override)
    else:
        addon_ids = set(db.scalars(
            select(StudioAddon.addon_id).where(StudioAddon.studio_id == studio_id, StudioAddon.status == "active")
        ).all())
    if not addon_ids:
        return {}

    grants: dict[str, int] = {}
    for row in db.scalars(select(AddonModule).where(AddonModule.addon_id.in_(addon_ids))).all():
        grants[row.module_id] = grants.get(row.module_id, 0) + (row.limit_delta or 0)
    return grants


def _is_module_enabled_own(
    db: Session, studio_id, subscription_plan: str, module_id: str,
    addon_ids_override: list[str] | None = None,
) -> bool:
    """
    Check if module_id itself (ignoring any parent) is enabled for a studio.
    Precedence (Add-ons policy, Generic Plans Engine step 6):
      1. studio_modules override with is_locked=true — a final Super Admin
         decision, wins over everything including active add-ons.
      2. An active add-on granting module_id — add-ons sit ABOVE the plan
         default and an unlocked override (they only ever add capability).
      3. studio_modules override (unlocked) — the studio's own default.
      4. plan_modules — the plan's default.
      5. disabled.
    """
    from app.models.module import StudioModule, PlanModule

    override = db.scalar(
        select(StudioModule).where(
            StudioModule.studio_id == studio_id,
            StudioModule.module_id == module_id,
        )
    )
    if override is not None and override.is_locked:
        return override.is_enabled

    if module_id in _active_addon_grants(db, studio_id, addon_ids_override):
        return True

    if override is not None:
        return override.is_enabled

    plan_row = db.scalar(
        select(PlanModule).where(
            PlanModule.plan == (subscription_plan or "free"),
            PlanModule.module_id == module_id,
        )
    )
    return plan_row is not None


def is_module_enabled(
    db: Session, studio_id, subscription_plan: str, module_id: str,
    addon_ids_override: list[str] | None = None,
) -> bool:
    """
    Check if module_id is enabled for a studio, honoring parent_module_id
    chains: a sub-capability (e.g. "invoice_ai_scan" nested under "ocr") is
    only truly enabled if it AND every ancestor module resolve to enabled —
    a studio whose "ocr" module is off can't have a sub-capability of it on
    (an add-on granting the sub-capability must also grant the parent, or
    the parent must already be enabled some other way).
    """
    from app.models.module import Module

    mid: str | None = module_id
    seen: set[str] = set()
    while mid is not None:
        if mid in seen:
            break  # defensive cycle guard — parent chains should never cycle
        seen.add(mid)
        if not _is_module_enabled_own(db, studio_id, subscription_plan, mid, addon_ids_override):
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


def get_studio_modules(
    db: Session, studio_id, subscription_plan: str,
    addon_ids_override: list[str] | None = None,
) -> dict[str, bool]:
    """
    Return all available modules with effective enabled status for a studio.
    Honors parent_module_id chains the same way is_module_enabled() does — a
    sub-capability shows disabled if its parent module is disabled, even if
    it has its own enabled override/plan default. Same Add-ons precedence
    policy as _is_module_enabled_own() (locked override > active add-on >
    unlocked override > plan default), computed once here instead of via
    repeated per-module calls for efficiency.
    """
    from app.models.module import Module, StudioModule, PlanModule

    all_modules = db.scalars(select(Module)).all()  # incl. unavailable, for parent lookups
    overrides = {r.module_id: r for r in db.scalars(
        select(StudioModule).where(StudioModule.studio_id == studio_id)
    ).all()}
    plan_defaults = {r.module_id for r in db.scalars(
        select(PlanModule).where(PlanModule.plan == (subscription_plan or "free"))
    ).all()}
    addon_grants = _active_addon_grants(db, studio_id, addon_ids_override)
    parent_of = {m.id: m.parent_module_id for m in all_modules}

    def own_enabled(mid: str) -> bool:
        override = overrides.get(mid)
        if override is not None and override.is_locked:
            return override.is_enabled
        if mid in addon_grants:
            return True
        if override is not None:
            return override.is_enabled
        return mid in plan_defaults

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


# ── Quota engine (Generic Plans Engine step 3) ────────────────────────────────
# Single source of truth for module/permission quotas — the only functions
# allowed to compute effective limits or read/write usage counters. Any new
# quota (messages, storage, employees, AI generations...) is configured via
# plan_modules/studio_modules columns (admin/packages, admin/modules), never
# a bespoke counter column on Studio/StudioSettings.

class QuotaConfig(TypedDict):
    period_type: str
    on_exceed_action: str
    limit: int | None          # None = no cap (period_type == "unlimited", or plan has no limit configured)
    auto_increase_by: int | None


def effective_quota(
    db: Session, studio_id, subscription_plan: str, quota_key: str,
    addon_ids_override: list[str] | None = None,
) -> QuotaConfig:
    """
    Resolve the effective quota config for a studio×quota_key, honoring
    studio-level overrides over the plan's defaults:
      - period_type / on_exceed_action: studio override replaces the plan's value outright
      - limit: limit_value_override replaces the plan's limit_value outright;
               limit_value_delta ADDS to it instead (e.g. "Basic plan + 500 messages")
      - active add-ons ADD their own limit_delta on top (Generic Plans Engine
        step 6) — UNLESS the override is_locked, in which case it's a final
        Super Admin decision and add-on deltas don't apply. An add-on can't
        create a cap from nothing: if the plan has no numeric limit for this
        quota_key (period_type='unlimited' or no plan_modules row), the
        result stays uncapped regardless of any add-on delta — add-ons only
        extend an existing cap, never establish one.
    """
    from app.models.module import PlanModule, StudioModule

    plan_row = db.scalar(
        select(PlanModule).where(
            PlanModule.plan == (subscription_plan or "free"),
            PlanModule.module_id == quota_key,
        )
    )
    override = db.scalar(
        select(StudioModule).where(
            StudioModule.studio_id == studio_id,
            StudioModule.module_id == quota_key,
        )
    )

    period_type = (override.period_type_override if override else None) or (plan_row.period_type if plan_row else "unlimited")
    on_exceed_action = (override.on_exceed_action_override if override else None) or (plan_row.on_exceed_action if plan_row else "block")
    auto_increase_by = plan_row.auto_increase_by if plan_row else None

    if period_type == "unlimited":
        return QuotaConfig(period_type="unlimited", on_exceed_action=on_exceed_action, limit=None, auto_increase_by=auto_increase_by)

    base = plan_row.limit_value if plan_row else None
    locked = override is not None and override.is_locked

    if locked:
        limit = override.limit_value_override if override.limit_value_override is not None else base
    elif override is not None and override.limit_value_override is not None:
        limit = override.limit_value_override
    elif base is not None:
        limit = base + (override.limit_value_delta if override and override.limit_value_delta else 0)
    else:
        limit = None  # period_type set but plan defines no number — treat as uncapped

    if not locked and limit is not None:
        addon_delta = _active_addon_grants(db, studio_id, addon_ids_override).get(quota_key, 0)
        if addon_delta:
            limit += addon_delta

    return QuotaConfig(period_type=period_type, on_exceed_action=on_exceed_action, limit=limit, auto_increase_by=auto_increase_by)


def _period_key(period_type: str, now: datetime | None = None) -> str:
    now = (now or datetime.now(timezone.utc)).astimezone(_IL_TZ)
    if period_type == "daily":
        return now.strftime("%Y-%m-%d")
    if period_type == "weekly":
        iso_year, iso_week, _ = now.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    if period_type == "monthly":
        return now.strftime("%Y-%m")
    if period_type == "yearly":
        return now.strftime("%Y")
    return "lifetime"  # lifetime, and unlimited-but-tracked (cumulative, never resets)


def _get_usage(db: Session, studio_id, quota_key: str, period_key: str) -> int:
    from app.models.module import StudioUsageCounter
    row = db.get(StudioUsageCounter, {"studio_id": studio_id, "quota_key": quota_key, "period_key": period_key})
    return row.used_count if row else 0


class QuotaCheck(TypedDict):
    allowed: bool
    warning: bool
    config: QuotaConfig
    used: int
    period_key: str


def check_quota(db: Session, studio_id, subscription_plan: str, quota_key: str) -> QuotaCheck:
    """
    Resolve whether an action gated by quota_key may proceed right now. Does
    NOT increment usage — call increment_usage() after the action succeeds.
    Raises HTTPException for on_exceed_action='block' (or 'custom', which
    behaves like 'block' until a future step defines real custom handlers).
    All other exceeded actions return allowed=True with warning info instead
    of raising, so the caller can decide how to surface it.

    Usage is tracked even when there's no cap (period_type='unlimited' or no
    limit configured) — check_quota() is only ever called at a deliberately
    chosen site (nobody calls check_quota("crm")), so if the caller wants a
    number, the Usage Dashboard should be able to show one. Uncapped usage is
    bucketed as 'lifetime' (cumulative, never resets) since there's no
    period to reset against.
    """
    config = effective_quota(db, studio_id, subscription_plan, quota_key)
    period_key = _period_key(config["period_type"])
    used = _get_usage(db, studio_id, quota_key, period_key)

    if config["period_type"] == "unlimited" or config["limit"] is None:
        return QuotaCheck(allowed=True, warning=False, config=config, used=used, period_key=period_key)

    over = used >= config["limit"]

    if not over:
        return QuotaCheck(allowed=True, warning=False, config=config, used=used, period_key=period_key)

    action = config["on_exceed_action"]
    if action in ("block", "custom"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"חרגתם מהמכסה עבור '{quota_key}' ({config['limit']} ל-{config['period_type']}). פנו לתמיכה להגדלת המכסה.",
        )
    if action == "auto_increase" and config["auto_increase_by"]:
        _bump_limit_override(db, studio_id, quota_key, config["auto_increase_by"])
    if action == "paid_overage":
        from app.core.billing import record_billable_overage
        record_billable_overage(db, studio_id, quota_key, used, config["limit"])
    # warn_only / allow_overage / paid_overage / auto_increase all let the action through
    return QuotaCheck(allowed=True, warning=True, config=config, used=used, period_key=period_key)


def _bump_limit_override(db: Session, studio_id, quota_key: str, by: int) -> None:
    """auto_increase: raise this studio's effective cap so it doesn't immediately re-trigger."""
    from app.models.module import StudioModule
    row = db.scalar(select(StudioModule).where(StudioModule.studio_id == studio_id, StudioModule.module_id == quota_key))
    if row:
        row.limit_value_delta = (row.limit_value_delta or 0) + by
    else:
        db.add(StudioModule(studio_id=studio_id, module_id=quota_key, is_enabled=True, limit_value_delta=by))


def increment_usage(db: Session, studio_id, quota_key: str, period_key: str, by: int = 1) -> None:
    """Call after a quota-gated action succeeds. No-op if period_key is empty (unlimited)."""
    if not period_key:
        return
    from app.models.module import StudioUsageCounter
    row = db.get(StudioUsageCounter, {"studio_id": studio_id, "quota_key": quota_key, "period_key": period_key})
    if row:
        row.used_count += by
    else:
        db.add(StudioUsageCounter(studio_id=studio_id, quota_key=quota_key, period_key=period_key, used_count=by))


def require_quota(quota_key: str) -> Callable:
    """
    FastAPI dependency, same style as require_module(). Checks (but does not
    increment) the quota — call increment_usage() explicitly once the gated
    action actually succeeds, same as the existing manual `+= 1` call sites.
    Superadmin always bypasses.
    """
    def _check(
        ctx: AuthContext = Depends(require_studio_ctx),
        db: Session = Depends(get_db),
    ) -> QuotaCheck | None:
        if getattr(ctx, "role", None) == "superadmin":
            return None
        from app.models.studio import Studio
        studio = db.get(Studio, ctx.studio_id)
        plan = studio.subscription_plan if studio else "free"
        return check_quota(db, ctx.studio_id, plan, quota_key)
    return _check


def get_usage_dashboard(
    db: Session, studio_id, subscription_plan: str, quota_key: str | None = None,
    addon_ids_override: list[str] | None = None,
) -> list[dict]:
    """
    Single source of truth for usage UI: used/limit/remaining/percent/reset_at
    per quota_key, plus history (every past period_key row — rows are never
    deleted on reset, so this is period-level history, not a per-event log).
    When quota_key is omitted, only lists modules with a configured quota
    dimension (period_type != unlimited at the plan level) — an unbounded
    scan of every module would mostly return "no quota configured" noise.
    When quota_key IS given explicitly, always returns it (even if unlimited)
    since the caller is asking about that one thing specifically and any
    tracked usage for it is still meaningful to show.
    """
    from app.models.module import Module, PlanModule, StudioUsageCounter

    if quota_key:
        keys = [quota_key]
    else:
        plan_rows = db.scalars(
            select(PlanModule).where(PlanModule.plan == (subscription_plan or "free"), PlanModule.period_type != "unlimited")
        ).all()
        keys = [r.module_id for r in plan_rows]

    result = []
    for key in keys:
        config = effective_quota(db, studio_id, subscription_plan, key, addon_ids_override)
        period_key = _period_key(config["period_type"])
        used = _get_usage(db, studio_id, key, period_key)
        history = db.scalars(
            select(StudioUsageCounter)
            .where(StudioUsageCounter.studio_id == studio_id, StudioUsageCounter.quota_key == key)
            .order_by(StudioUsageCounter.period_key)
        ).all()
        limit = config["limit"]
        result.append({
            "quota_key": key,
            "period_type": config["period_type"],
            "on_exceed_action": config["on_exceed_action"],
            "used": used,
            "limit": limit,
            "remaining": (max(0, limit - used) if limit is not None else None),
            "percent": (round(100 * used / limit, 1) if limit else None),
            "period_key": period_key,
            "history": [{"period_key": h.period_key, "used_count": h.used_count} for h in history],
        })
    return result


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
