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


@router.get("/me/usage")
def get_my_usage(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
) -> list[dict]:
    """This month's use of what the plan counts — WhatsApp messages always, broadcasts when the plan limits them,
    invoice scans when the business has them. {key, label, used, limit (None — no limit), remaining, resets_on}."""
    from datetime import date
    from app.core.features import get_studio_modules
    from app.services import message_quota
    studio = db.get(Studio, ctx.studio_id)
    on = get_studio_modules(db, ctx.studio_id, studio.subscription_plan if studio else "free")
    today = date.today()
    resets_on = date(today.year + (today.month == 12), today.month % 12 + 1, 1).isoformat()
    out = []
    for key, label in (("whatsapp", "הודעות WhatsApp"), ("broadcasts", "תפוצות"), ("invoice_ai_scan", "סריקות חשבוניות")):
        if key != "whatsapp" and not on.get(key):
            continue
        b = message_quota.balance(db, ctx.studio_id, key)
        if key == "broadcasts" and b["limit"] is None:
            continue                                 # unlimited broadcasts — WhatsApp messages tell the story
        out.append({"key": key, "label": label, "used": b["used"], "limit": b["limit"], "remaining": b["remaining"],
                    "resets_on": resets_on})
    return out


@router.get("/me/upgrades")
def get_my_upgrades(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """{module_id: the plan's name} — for each module the business doesn't have, the first plan on sale (in the
    order the superadmin set) that would give it one, by the same rule (its field and the superadmin's decisions
    count). Screens on the website show it on a locked feature ("זמין בפרו"); the apps don't (Apple)."""
    from sqlalchemy import select
    from app.models.module import Plan
    studio = db.get(Studio, ctx.studio_id)
    now = get_studio_modules(db, ctx.studio_id, studio.subscription_plan if studio else "free")
    plans = db.scalars(select(Plan).where(Plan.is_active, Plan.is_visible, Plan.is_purchasable,
                                          Plan.scope_bizcontrol).order_by(Plan.sort_order)).all()
    out: dict[str, str] = {}
    for plan in plans:
        for mid, on in get_studio_modules(db, ctx.studio_id, plan.id).items():
            if on and not now.get(mid) and mid not in out:
                out[mid] = plan.display_name
    return out
