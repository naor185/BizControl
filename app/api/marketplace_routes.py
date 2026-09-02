"""
Public Marketplace API — Phase 4.
All endpoints are public (no auth required).
"""
from __future__ import annotations
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from sqlalchemy import text
from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.core.limiter import limiter
from app.db.deps import get_db as _get_db
from app.utils.logger import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/marketplace", tags=["Marketplace"])

# ── Plan definitions ──────────────────────────────────────────────────────────

BIZFIND_PLANS = {
    "trial": {
        "label": "ניסיון חינמי",
        "price_ils": 0,
        "days": 14,
        "subscription_plan": "trial",
        "scope_bizcontrol": True,   # trial gets full access
    },
    "bizfind_basic": {
        "label": "Basic — BizFind בלבד",
        "price_ils": 99,
        "days": 30,
        "subscription_plan": "bizfind_basic",
        "scope_bizcontrol": False,
    },
    "bizfind_pro": {
        "label": "Pro — BizFind בלבד",
        "price_ils": 179,
        "days": 30,
        "subscription_plan": "bizfind_pro",
        "scope_bizcontrol": False,
    },
    "starter": {
        "label": "Starter — BizFind + BizControl",
        "price_ils": 199,
        "days": 30,
        "subscription_plan": "starter",
        "scope_bizcontrol": True,
    },
    "pro": {
        "label": "Pro — BizFind + BizControl",
        "price_ils": 349,
        "days": 30,
        "subscription_plan": "pro",
        "scope_bizcontrol": True,
    },
    "studio": {
        "label": "Studio — BizFind + BizControl",
        "price_ils": 499,
        "days": 30,
        "subscription_plan": "studio",
        "scope_bizcontrol": True,
    },
}

# BizFind-only plans (no BizControl access) are no longer sold — kept in
# BIZFIND_PLANS above only because existing studios may still be on them
# (see PLAN_MODULES safety net in start.py). Not offered for new signups.
_RETIRED_PLAN_KEYS = {"bizfind_basic", "bizfind_pro"}


# ── Studio owner login (no slug required) ─────────────────────────────────────

class MarketplaceLoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/auth/login")
def marketplace_login(payload: MarketplaceLoginIn, db: Session = Depends(get_db)):
    """
    Login for business owners/staff via the BizFind portal — email+password
    only, same shared logic as BizControl's own /api/auth/login-by-email
    (app/services/auth_service.py), so the two never drift apart again (this
    endpoint used to have no 2FA support at all and a narrower role filter,
    purely from being a separate copy of the same logic).
    """
    from app.models.user import User
    from app.services.auth_service import (
        find_login_candidates, track_login_failure, raise_if_locked, reset_login_failures,
        create_pending_token, create_studio_selection_token, issue_full_tokens, studio_label,
    )

    candidates = find_login_candidates(db, payload.email, payload.password)

    if not candidates:
        email = str(payload.email).lower().strip()
        for u in db.query(User).filter(User.email == email, User.is_active == True).all():  # noqa: E712
            track_login_failure(db, u, "סיסמה שגויה")
        raise HTTPException(status_code=401, detail="מייל או סיסמה שגויים")

    if len(candidates) > 1:
        return {
            "requires_studio_selection": True,
            "selection_token": create_studio_selection_token([str(u.id) for u in candidates]),
            "studios": [studio_label(u) for u in candidates],
        }

    user = candidates[0]
    raise_if_locked(db, user)

    if user.totp_secret:
        return {
            "requires_2fa": True,
            "pending_token": create_pending_token(str(user.id), str(user.studio_id)),
        }
    reset_login_failures(db, user)
    return issue_full_tokens(user, db)


# ── Self-registration for business owners via BizFind ────────────────────────

class BizFindRegisterIn(BaseModel):
    business_name: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=1, max_length=60)
    city: str = Field(min_length=1, max_length=60)
    owner_name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6)
    phone: Optional[str] = None
    plan_key: str = "trial"   # trial | bizfind_basic | bizfind_pro | starter | pro | studio


def _slugify(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug, flags=re.UNICODE)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:48] or "business"


@router.post("/auth/register", status_code=201)
def bizfind_register(payload: BizFindRegisterIn, db: Session = Depends(get_db)):
    """Self-registration for business owners coming from BizFind."""
    from datetime import datetime, timezone, timedelta
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    from app.models.user import User
    from app.models.refresh_token import RefreshToken
    from app.core.security import create_access_token, create_refresh_token
    from argon2 import PasswordHasher

    if payload.plan_key in _RETIRED_PLAN_KEYS:
        # Retired: BizFind-only plans (no BizControl access) are no longer sold —
        # every business owner is managed through BizControl. Existing studios
        # already on these plans keep working (see PLAN_MODULES in start.py).
        raise HTTPException(status_code=400, detail="תכנית זו הופסקה. כל בעלי העסקים מנוהלים כעת דרך BizControl.")

    plan = BIZFIND_PLANS.get(payload.plan_key)
    if not plan:
        raise HTTPException(status_code=400, detail=f"תכנית לא חוקית: {payload.plan_key}")

    ph = PasswordHasher()
    email = payload.email.lower().strip()

    # Prevent duplicate email
    from app.models.user import User as _User
    if db.scalar(select(_User).where(_User.email == email)):
        raise HTTPException(status_code=409, detail="כתובת המייל כבר רשומה במערכת")

    # Generate unique slug
    base_slug = _slugify(payload.business_name)
    slug = base_slug
    counter = 1
    while db.scalar(select(Studio).where(Studio.slug == slug)):
        slug = f"{base_slug}-{counter}"
        counter += 1

    expires = datetime.now(timezone.utc) + timedelta(days=plan["days"])

    studio = Studio(
        id=uuid.uuid4(),
        name=payload.business_name.strip(),
        slug=slug,
        subscription_plan=plan["subscription_plan"],
        business_type=payload.category.strip(),
        is_active=True,
        plan_expires_at=expires,
        is_platform=False,
    )
    db.add(studio)
    db.flush()

    # Studio settings — tag with category and city; enable marketplace visibility immediately.
    # studios + studio_settings are the single source of truth for profile data
    # (get_studio_profile / get_my_studio_profile already read only from here) —
    # no separate marketplace_profiles row is created anymore.
    settings = StudioSettings(
        studio_id=studio.id,
        studio_address=payload.city.strip(),
        marketplace_city=payload.city.strip(),
        marketplace_phone=payload.phone.strip() if payload.phone else None,
        marketplace_visible=True,
    )
    db.add(settings)

    import secrets
    verify_token = secrets.token_urlsafe(32)
    owner = User(
        id=uuid.uuid4(),
        studio_id=studio.id,
        email=email,
        password_hash=ph.hash(payload.password),
        role="owner",
        display_name=payload.owner_name.strip(),
        phone=payload.phone.strip() if payload.phone else None,
        is_active=True,
        # Self-signup owners start unverified — a verification email is sent below.
        email_verified=False,
        email_verify_token=verify_token,
        email_verify_sent_at=datetime.now(timezone.utc),
    )
    db.add(owner)
    db.flush()

    # Create the studio's subscription row — Subscription.status (not
    # Studio.is_active) is what plan_enforcement.py actually gates access
    # on, see app/core/billing.py. Called last (after studio/settings/owner
    # are all flushed) since it commits — everything above lands atomically
    # with it, nothing partial if this raises.
    from app.core.billing import apply_subscription_event
    apply_subscription_event(
        db, studio.id,
        "trial_started" if payload.plan_key == "trial" else "activated",
        source="customer",
        plan_id=plan["subscription_plan"],
        current_period_start=datetime.now(timezone.utc),
        current_period_end=expires,
        trial_ends_at=expires if payload.plan_key == "trial" else None,
    )

    access = create_access_token({"user_id": str(owner.id), "studio_id": str(studio.id), "role": "owner"})
    refresh = create_refresh_token({"user_id": str(owner.id), "studio_id": str(studio.id)})
    db.add(RefreshToken(id=uuid.uuid4(), studio_id=studio.id, user_id=owner.id, token=refresh, is_revoked=False))
    db.commit()

    # Post-registration emails (best-effort — never fail the registration if email
    # sending has a hiccup; the studio + owner are already committed above).
    import os
    from app.services.email_center import send_email
    from app.utils.email_templates import verify_email_html, new_business_admin_email_html

    bizfind_url = os.getenv("BIZFIND_URL", "https://find.biz-control.com").rstrip("/")
    verify_link = f"{bizfind_url}/verify-email?token={verify_token}"
    try:
        send_email(
            db,
            to_email=email,
            subject="אימות כתובת המייל — BizControl",
            html_content=verify_email_html(payload.owner_name.strip(), verify_link),
            from_name="BizControl",
            studio_id=str(studio.id),
            template_key="verify_email",
            email_type="system",
        )
    except Exception as e:
        log.warning("[bizfind_register] verification email failed: %s", e)

    try:
        send_email(
            db,
            to_email="bizcontrol.system@gmail.com",
            subject=f"עסק חדש נרשם: {studio.name}",
            html_content=new_business_admin_email_html(
                business_name=studio.name,
                owner_name=payload.owner_name.strip(),
                email=email,
                phone=payload.phone.strip() if payload.phone else "—",
                plan_label=plan["label"],
                city=payload.city.strip(),
            ),
            from_name="BizControl",
            template_key="new_business_admin",
            email_type="system",
        )
    except Exception as e:
        log.warning("[bizfind_register] admin notification email failed: %s", e)

    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "studio_slug": slug,
        "plan_key": payload.plan_key,
        "plan_label": plan["label"],
        "scope_bizcontrol": plan["scope_bizcontrol"],
        "trial_days": plan["days"] if payload.plan_key == "trial" else None,
        "plan_expires_at": expires.isoformat(),
    }


class VerifyEmailIn(BaseModel):
    token: str


@router.post("/auth/verify-email")
def verify_email(payload: VerifyEmailIn, db: Session = Depends(get_db)):
    """Public — confirm a business owner's email from the link in the
    verification email. Token lives in users.email_verify_token; valid 7 days."""
    from datetime import datetime, timezone, timedelta
    from app.models.user import User

    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="חסר טוקן אימות")

    user = db.scalar(select(User).where(User.email_verify_token == token))
    if not user:
        # Either invalid, or already verified (token cleared) — treat as done so a
        # second click on the link still shows success rather than an error.
        raise HTTPException(status_code=400, detail="קישור האימות אינו תקף או שכבר נעשה בו שימוש")

    if user.email_verify_sent_at:
        sent = user.email_verify_sent_at
        if sent.tzinfo is None:
            sent = sent.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - sent > timedelta(days=7):
            raise HTTPException(status_code=400, detail="קישור האימות פג תוקף — יש לבקש שליחה חוזרת")

    user.email_verified = True
    user.email_verify_token = None
    db.commit()
    return {"ok": True, "email": user.email}


@router.get("/plans")
def get_plans(db: Session = Depends(get_db)):
    """Public endpoint — returns available BizFind plans with their feature flags.
    Excludes retired BizFind-only plans (no longer sold) — every plan offered
    going forward includes BizControl."""
    plans = []
    for k, v in BIZFIND_PLANS.items():
        if k in _RETIRED_PLAN_KEYS:
            continue
        features = db.execute(
            text("""
                SELECT feature_key, feature_label, is_enabled, limit_value
                FROM bizfind_plan_features
                WHERE plan_code = :plan
                ORDER BY feature_key
            """),
            {"plan": k},
        ).fetchall()
        plans.append({
            "key": k,
            "label": v["label"],
            "price_ils": v["price_ils"],
            "days": v["days"],
            "scope_bizcontrol": v["scope_bizcontrol"],
            "is_trial": k == "trial",
            "features": [
                {
                    "key": r[0],
                    "label": r[1],
                    "enabled": r[2],
                    "limit": r[3],
                }
                for r in features
            ],
        })
    return plans


@router.get("/plans/{plan_code}/features")
def get_plan_features(plan_code: str, db: Session = Depends(get_db)):
    """Returns feature flags for a specific plan.

    DEPRECATED (2026-08-03): no known frontend caller found in the
    BizFind/BizControl unification audit — only the base GET /plans is
    called (web/onboarding). Pre-existing, unrelated to that refactor.
    Logging real usage before considering removal.
    """
    log.warning("[deprecated-endpoint] GET /marketplace/plans/%s/features called", plan_code)
    if plan_code not in BIZFIND_PLANS:
        raise HTTPException(status_code=404, detail=f"תכנית לא קיימת: {plan_code}")
    rows = db.execute(
        text("""
            SELECT feature_key, feature_label, is_enabled, limit_value
            FROM bizfind_plan_features
            WHERE plan_code = :plan
            ORDER BY feature_key
        """),
        {"plan": plan_code},
    ).fetchall()
    return {
        "plan_code": plan_code,
        "features": [{"key": r[0], "label": r[1], "enabled": r[2], "limit": r[3]} for r in rows],
    }


# ── Onboarding profile update (used by BizControl /onboarding wizard) ────────

class OnboardingProfileIn(BaseModel):
    business_name: Optional[str] = None
    description: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    category: Optional[str] = None
    completed_onboarding: Optional[bool] = None


@router.patch("/studio/me")
def patch_my_studio_profile(
    payload: OnboardingProfileIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Update studio profile — used by BizControl onboarding wizard."""
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings

    studio = db.get(Studio, ctx.studio_id)
    settings = db.get(StudioSettings, ctx.studio_id)
    if not studio or not settings:
        raise HTTPException(404, "Studio not found")

    if payload.business_name is not None:
        studio.name = payload.business_name.strip()
    if payload.description is not None:
        settings.marketplace_description = payload.description.strip() or None
    if payload.city is not None:
        settings.marketplace_city = payload.city.strip() or None
    if payload.address is not None:
        settings.studio_address = payload.address.strip() or None
    if payload.phone is not None:
        settings.marketplace_phone = payload.phone.strip() or None
    if payload.whatsapp is not None:
        settings.marketplace_whatsapp = payload.whatsapp.strip() or None
    if payload.category is not None:
        studio.business_type = payload.category.strip() or None

    db.commit()
    return {"ok": True}


# ── Smart studio profile for dashboard (authenticated) ────────────────────────

@router.get("/studio/me")
def get_my_studio_profile(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Returns full studio profile for BizFind dashboard — merges marketplace + BizControl data.

    DEPRECATED (2026-08-03): no known frontend caller as of the BizFind/
    BizControl unification audit — the old studio/dashboard was its only
    caller and is now a redirect stub; the PATCH variant of this same path
    is still used (web/onboarding) and is unaffected. Logging real usage
    before considering removal.
    """
    log.warning("[deprecated-endpoint] GET /marketplace/studio/me called by studio %s", ctx.studio_id)
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    from app.models.service import Service
    from sqlalchemy import text as _text

    studio = db.get(Studio, ctx.studio_id)
    settings = db.get(StudioSettings, ctx.studio_id)
    if not studio or not settings:
        raise HTTPException(404, "Studio not found")

    gallery_count = db.scalar(
        _text("SELECT COUNT(*) FROM studio_gallery WHERE studio_id=:sid"),
        {"sid": str(ctx.studio_id)}
    ) or 0

    services = db.scalars(
        select(Service).where(Service.studio_id == ctx.studio_id, Service.is_active == True)  # noqa
        .order_by(Service.sort_order)
    ).all()

    # Smart defaults: fall back to BizControl fields when marketplace fields are empty
    description = (
        settings.marketplace_description
        or settings.landing_page_description
        or None
    )
    phone = settings.marketplace_phone or settings.whatsapp_phone_id or None
    instagram = settings.marketplace_instagram or settings.review_link_instagram or None
    facebook = settings.marketplace_facebook or settings.review_link_facebook or None

    return {
        "studio_id": str(studio.id),
        "slug": studio.slug,
        "name": studio.name,
        "business_type": studio.business_type or "other",
        "logo_url": studio.logo_url,
        "primary_color": studio.primary_color or "#7c3aed",
        "subscription_plan": getattr(studio, "subscription_plan", "free"),
        "cover_url": settings.marketplace_cover_url,
        "gallery_count": gallery_count,
        # Marketplace fields with smart defaults
        "marketplace_visible": settings.marketplace_visible,
        "description": description,
        "city": settings.marketplace_city,
        "phone": phone,
        "address": settings.studio_address,
        "map_link": settings.studio_map_link,
        "instagram": instagram,
        "whatsapp": settings.marketplace_whatsapp,
        "facebook": facebook,
        "tiktok": settings.marketplace_tiktok,
        "website": settings.marketplace_website,
        "youtube": settings.marketplace_youtube,
        "hours": settings.marketplace_hours,
        "services": [
            {
                "id": str(s.id), "name": s.name, "duration_minutes": s.duration_minutes,
                "price_ils": s.price_cents / 100, "color": s.color,
                "description": s.description, "is_bookable_online": s.is_bookable_online,
            }
            for s in services
        ],
    }


def _get_gallery(db: Session, studio_id) -> list[str]:
    rows = db.execute(
        text("SELECT url FROM studio_gallery WHERE studio_id=:sid ORDER BY sort_order, created_at LIMIT 20"),
        {"sid": str(studio_id)}
    ).fetchall()
    return [r[0] for r in rows]

BUSINESS_TYPE_LABELS = {
    "tattoo":          "סטודיו קעקועים",
    "barber":          "ספר / ברברשופ",
    "nails":           "ציפורניים",
    "laser":           "לייזר",
    "pilates":         "פילאטיס / כושר",
    "spa":             "ספא / קוסמטיקה",
    "medical":         "קליניקה / מרפאה",
    "massage":         "עיסוי ורפלקסולוגיה",
    "clothing":        "חנות בגדים",
    "pharmacy":        "בית מרקחת",
    "gym":             "מכון כושר",
    "dental":          "מרפאת שיניים",
    "photography":     "צילום",
    "florist":         "פרחים",
    "other":           "אחר",
}

BUSINESS_TYPE_ICONS = {
    "tattoo":  "🎨", "barber":  "✂️", "nails":  "💅",
    "laser":   "⚡", "pilates": "🏃", "spa":    "🧖",
    "medical": "🏥", "massage": "💆", "clothing": "👗",
    "pharmacy": "💊", "gym": "🏋️", "dental": "🦷",
    "photography": "📷", "florist": "💐", "other":   "🏢",
}


# ── Search / List ─────────────────────────────────────────────────────────────

@router.get("")
def search_marketplace(
    q: Optional[str] = Query(None, description="Search by name"),
    business_type: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    limit: int = Query(20, le=50),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Search and list marketplace-visible studios."""
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    from app.models.studio_review import StudioReview

    stmt = (
        select(Studio, StudioSettings)
        .join(StudioSettings, StudioSettings.studio_id == Studio.id)
        .where(
            Studio.is_active == True,  # noqa
            Studio.is_platform == False,  # noqa
            StudioSettings.marketplace_visible == True,  # noqa
        )
    )

    if q:
        stmt = stmt.where(Studio.name.ilike(f"%{q}%"))
    if business_type:
        stmt = stmt.where(Studio.business_type == business_type)
    if city:
        stmt = stmt.where(StudioSettings.marketplace_city.ilike(f"%{city}%"))

    stmt = stmt.order_by(Studio.name).offset(offset).limit(limit)
    rows = db.execute(stmt).all()

    result = []
    for studio, settings in rows:
        # Avg rating
        avg_rating = db.scalar(
            select(func.avg(StudioReview.rating)).where(
                StudioReview.studio_id == studio.id,
                StudioReview.is_approved == True,  # noqa
            )
        )
        review_count = db.scalar(
            select(func.count(StudioReview.id)).where(
                StudioReview.studio_id == studio.id,
                StudioReview.is_approved == True,  # noqa
            )
        ) or 0

        result.append({
            "id": str(studio.id),
            "slug": studio.slug,
            "name": studio.name,
            "business_type": studio.business_type or "other",
            "business_type_label": BUSINESS_TYPE_LABELS.get(studio.business_type or "other", "אחר"),
            "business_type_icon": BUSINESS_TYPE_ICONS.get(studio.business_type or "other", "🏢"),
            "logo_url": studio.logo_url,
            "cover_url": settings.marketplace_cover_url,
            "city": settings.marketplace_city,
            "description": settings.marketplace_description,
            "primary_color": studio.primary_color or "#7c3aed",
            "self_booking_enabled": settings.self_booking_enabled,
            "avg_rating": round(float(avg_rating), 1) if avg_rating else None,
            "review_count": review_count,
            "is_claimed": True,
        })

    # Unclaimed BizFind imports, merged into the same list — deliberately no
    # live Google lookup here (would be N+1 API calls per search); photos
    # only get fetched on the individual profile page (get_studio_profile /
    # _get_unclaimed_business_profile), same cost tradeoff as everywhere
    # else Google data is used in this codebase.
    remaining = max(limit - len(result), 0)
    if remaining:
        conditions = ["claim_status = 'unclaimed'"]
        params: dict = {"limit": remaining}
        if q:
            conditions.append("name ILIKE :q")
            params["q"] = f"%{q}%"
        if business_type:
            conditions.append("category = :business_type")
            params["business_type"] = business_type
        if city:
            conditions.append("city ILIKE :city")
            params["city"] = f"%{city}%"
        where = " AND ".join(conditions)
        biz_rows = db.execute(
            text(f"SELECT id, slug, name, category, city, description FROM businesses WHERE {where} ORDER BY name LIMIT :limit"),
            params,
        ).fetchall()
        for b in biz_rows:
            result.append({
                "id": str(b.id),
                "slug": b.slug,
                "name": b.name,
                "business_type": b.category,
                "business_type_label": BUSINESS_TYPE_LABELS.get(b.category, "אחר"),
                "business_type_icon": BUSINESS_TYPE_ICONS.get(b.category, "🏢"),
                "logo_url": None,
                "cover_url": None,
                "city": b.city,
                "description": b.description,
                "primary_color": "#7c3aed",
                "self_booking_enabled": False,
                "avg_rating": None,
                "review_count": 0,
                "is_claimed": False,
            })

    return {"studios": result, "total": len(result), "offset": offset}


@router.get("/hero-slides")
def get_hero_slides(db: Session = Depends(get_db)):
    """Return active hero carousel slides ordered by sort_order."""
    rows = db.execute(
        text("SELECT id, url, label, sort_order FROM hero_slides WHERE is_active=true ORDER BY sort_order, created_at")
    ).fetchall()
    return [{"id": str(r[0]), "url": r[1], "label": r[2], "sort_order": r[3]} for r in rows]


@router.get("/categories")
def get_categories(db: Session = Depends(get_db)):
    """Return business type categories with counts — real studios plus
    unclaimed BizFind imports, merged, so the filter bar reflects everything
    actually shown in search (see search_marketplace)."""
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings

    counts: dict[str, int] = {}

    studio_counts = db.execute(
        select(Studio.business_type, func.count(Studio.id))
        .join(StudioSettings, StudioSettings.studio_id == Studio.id)
        .where(Studio.is_active == True, StudioSettings.marketplace_visible == True)  # noqa
        .group_by(Studio.business_type)
    ).all()
    for bt, count in studio_counts:
        counts[bt or "other"] = counts.get(bt or "other", 0) + count

    business_counts = db.execute(
        text("SELECT category, COUNT(*) FROM businesses WHERE claim_status='unclaimed' GROUP BY category")
    ).all()
    for category, count in business_counts:
        counts[category or "other"] = counts.get(category or "other", 0) + count

    return [
        {
            "id": bt,
            "label": BUSINESS_TYPE_LABELS.get(bt, "אחר"),
            "icon": BUSINESS_TYPE_ICONS.get(bt, "🏢"),
            "count": count,
        }
        for bt, count in counts.items()
    ]


@router.get("/cities")
def search_cities(q: str = Query(..., min_length=1, max_length=40), limit: int = Query(8, le=20)):
    """City name autocomplete for the marketplace search box — matches
    against a curated list of real Israeli localities (see
    app/data/israel_cities.py for scope/source). Prefix matches rank first,
    substring matches fill any remaining slots."""
    from app.data.israel_cities import ISRAEL_CITIES

    needle = q.strip()
    if not needle:
        return []

    prefix = [c for c in ISRAEL_CITIES if c.startswith(needle)]
    if len(prefix) >= limit:
        return sorted(prefix, key=len)[:limit]

    substring = [c for c in ISRAEL_CITIES if needle in c and c not in prefix]
    return sorted(prefix, key=len) + sorted(substring, key=len)[:limit - len(prefix)]


# ── Studio profile ────────────────────────────────────────────────────────────

@router.get("/{slug}")
def get_studio_profile(slug: str, db: Session = Depends(get_db)):
    """Full public profile: info, services, reviews."""
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    from app.models.service import Service
    from app.models.studio_review import StudioReview
    from app.models.user import User

    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa
    if not studio:
        # Falls back to an unclaimed BizFind import (businesses table) — a
        # real Studio always wins on a slug collision, checked first above.
        unclaimed = _get_unclaimed_business_profile(db, slug)
        if unclaimed:
            return unclaimed
        raise HTTPException(404, "Studio not found")

    settings = db.get(StudioSettings, studio.id)
    if not settings or not settings.marketplace_visible:
        raise HTTPException(403, "Profile not public")

    services = db.scalars(
        select(Service).where(
            Service.studio_id == studio.id, Service.is_active == True  # noqa
        ).order_by(Service.sort_order)
    ).all()

    reviews = db.scalars(
        select(StudioReview).where(
            StudioReview.studio_id == studio.id,
            StudioReview.is_approved == True,  # noqa
        ).order_by(StudioReview.created_at.desc()).limit(20)
    ).all()

    artists = db.scalars(
        select(User).where(
            User.studio_id == studio.id,
            User.is_active == True,  # noqa
            User.role.in_(["artist", "owner", "admin"]),
        )
    ).all()

    avg_rating = db.scalar(
        select(func.avg(StudioReview.rating)).where(
            StudioReview.studio_id == studio.id, StudioReview.is_approved == True  # noqa
        )
    )

    return {
        "id": str(studio.id),
        "slug": studio.slug,
        "name": studio.name,
        "business_type": studio.business_type or "other",
        "business_type_label": BUSINESS_TYPE_LABELS.get(studio.business_type or "other", "אחר"),
        "business_type_icon": BUSINESS_TYPE_ICONS.get(studio.business_type or "other", "🏢"),
        "logo_url": studio.logo_url,
        "cover_url": settings.marketplace_cover_url,
        "primary_color": studio.primary_color or "#7c3aed",
        "description": settings.marketplace_description,
        "city": settings.marketplace_city,
        "address": settings.studio_address,
        "map_link": settings.studio_map_link,
        "phone": settings.marketplace_phone,
        "whatsapp": settings.marketplace_whatsapp,
        "instagram": settings.marketplace_instagram,
        "facebook": settings.marketplace_facebook,
        "tiktok": settings.marketplace_tiktok,
        "website": settings.marketplace_website,
        "youtube": settings.marketplace_youtube,
        "hours": settings.marketplace_hours,
        "portfolio_link": settings.studio_portfolio_link,
        "review_link_google": settings.review_link_google,
        "self_booking_enabled": settings.self_booking_enabled,
        "services": [
            {
                "id": str(s.id), "name": s.name, "duration_minutes": s.duration_minutes,
                "price_ils": s.price_cents / 100, "color": s.color,
                "description": s.description, "is_bookable_online": s.is_bookable_online,
            }
            for s in services
        ],
        "artists": [{"id": str(a.id), "name": a.display_name or a.email} for a in artists],
        "reviews": [
            {
                "id": str(r.id), "client_name": r.client_name,
                "rating": r.rating, "comment": r.comment,
                "created_at": r.created_at.isoformat(),
            }
            for r in reviews
        ],
        "avg_rating": round(float(avg_rating), 1) if avg_rating else None,
        "review_count": len(reviews),
        "gallery": _get_gallery(db, studio.id),
        "is_claimed": True,
    }


def _get_unclaimed_business_profile(db: Session, slug: str) -> Optional[dict]:
    """Same response shape as get_studio_profile (minus fields that don't
    exist yet for an unclaimed business — services/artists/reviews stay
    empty), plus is_claimed=False and business_id for the inline Claim
    flow. See app/api/business_routes.py for the Claim endpoints themselves
    and app/services/google_places.py for how photos/rating/hours are
    fetched live rather than stored."""
    row = db.execute(
        text("""
            SELECT id, slug, name, category, city, address, phone, latitude, longitude,
                   description, opening_hours, claim_status
            FROM businesses WHERE slug = :slug
        """),
        {"slug": slug},
    ).fetchone()
    if not row or row.claim_status == "claimed":
        return None

    business_id = str(row.id)
    photo_urls: list[str] = []
    rating = rating_count = None
    address = row.address
    phone = row.phone
    google_reviews: list[dict] = []
    category_label = BUSINESS_TYPE_LABELS.get(row.category, "אחר")

    src = db.execute(
        text("SELECT external_id FROM business_sources WHERE business_id=:bid AND source='google'"),
        {"bid": business_id},
    ).fetchone()
    place_id = src[0] if src else None
    if not place_id:
        from app.services.google_places import find_place_id
        # Category label helps Google's ranking pick the right *kind* of
        # place when there's no real address to disambiguate with (OSM
        # imports very often have none).
        place_id = find_place_id(row.name, row.address, row.city, category_label)
        if place_id:
            db.execute(
                text("""
                    INSERT INTO business_sources (id, business_id, source, external_id, source_url)
                    VALUES (:id, :bid, 'google', :eid, :url)
                    ON CONFLICT (source, external_id) DO NOTHING
                """),
                {"id": str(uuid.uuid4()), "bid": business_id, "eid": place_id,
                 "url": f"https://www.google.com/maps/place/?q=place_id:{place_id}"},
            )
            db.commit()

    if place_id:
        from app.services.google_places import get_place_details
        details = get_place_details(place_id)
        if details:
            photo_urls = [f"/api/businesses/{business_id}/photo/{i}" for i in range(len(details["photo_names"]))]
            rating, rating_count = details["rating"], details["rating_count"]
            address = address or details["address"]
            phone = phone or details["phone"]
            google_reviews = details["reviews"]

    return {
        "id": business_id,
        "business_id": business_id,
        "slug": row.slug,
        "name": row.name,
        "business_type": row.category,
        "business_type_label": category_label,
        "business_type_icon": BUSINESS_TYPE_ICONS.get(row.category, "🏢"),
        "logo_url": None,
        "cover_url": photo_urls[0] if photo_urls else None,
        "primary_color": "#7c3aed",
        "description": row.description,
        "city": row.city,
        "address": address,
        # google_reviews carry their own permalink via the id in the source URL,
        # but a plain search link is simpler and always works even without one.
        "map_link": f"https://www.google.com/maps/search/?api=1&query={row.name}+{row.city or ''}" if (address or row.city) else None,
        "phone": phone,
        "whatsapp": None, "instagram": None, "facebook": None, "tiktok": None,
        "website": None, "youtube": None,
        # Not exposed yet — Google's opening hours come back as freeform
        # per-day text, not the {open,close,closed} JSON this page's hours
        # parser expects; needs its own conversion, not built yet.
        "hours": row.opening_hours,
        "portfolio_link": None,
        "review_link_google": None,
        "self_booking_enabled": False,
        "services": [],
        "artists": [],
        "reviews": [],
        "google_reviews": google_reviews,
        "avg_rating": rating,
        "review_count": rating_count or 0,
        "gallery": photo_urls,
        "is_claimed": False,
    }


# ── Reviews ────────────────────────────────────────────────────────────────────

class ReviewCreate(BaseModel):
    client_name: str = Field(..., max_length=120)
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=1000)


@router.post("/{slug}/reviews", status_code=201)
@limiter.limit("3/hour")
def submit_review(request: Request, slug: str, payload: ReviewCreate, db: Session = Depends(get_db)):
    from html import escape as _esc
    from app.models.studio import Studio
    from app.models.studio_review import StudioReview

    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa
    if not studio:
        raise HTTPException(404, "Studio not found")

    review = StudioReview(
        studio_id=studio.id,
        client_name=_esc(payload.client_name),
        rating=payload.rating,
        comment=_esc(payload.comment) if payload.comment else payload.comment,
        is_approved=False,  # requires approval
    )
    db.add(review)
    db.commit()
    return {"message": "תודה! הביקורת תפורסם לאחר אישור."}


# ── Studio manages reviews (authenticated) ────────────────────────────────────

@router.get("/my/reviews/pending")
def list_pending_reviews(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Return pending (unapproved) reviews for the authenticated studio."""
    from app.models.studio_review import StudioReview
    reviews = db.scalars(
        select(StudioReview).where(
            StudioReview.studio_id == ctx.studio_id,
            StudioReview.is_approved == False,  # noqa
        ).order_by(StudioReview.created_at.desc())
    ).all()
    return [
        {
            "id": str(r.id),
            "client_name": r.client_name,
            "rating": r.rating,
            "comment": r.comment,
            "created_at": r.created_at.isoformat(),
        }
        for r in reviews
    ]


@router.post("/my/reviews/{review_id}/approve")
def approve_review(review_id: str, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Studio owner approves a pending review."""
    from app.models.studio_review import StudioReview
    import uuid as _uuid
    review = db.get(StudioReview, _uuid.UUID(review_id))
    if not review or review.studio_id != ctx.studio_id:
        raise HTTPException(404, "Review not found")
    review.is_approved = True
    db.commit()
    return {"approved": True}


@router.delete("/my/reviews/{review_id}", status_code=204)
def delete_review(review_id: str, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Studio owner deletes/rejects a review."""
    from app.models.studio_review import StudioReview
    import uuid as _uuid
    review = db.get(StudioReview, _uuid.UUID(review_id))
    if not review or review.studio_id != ctx.studio_id:
        raise HTTPException(404, "Review not found")
    db.delete(review)
    db.commit()


# ── Page view tracking (called by BizFind on every profile visit) ─────────────

@router.post("/{slug}/view", status_code=204)
def track_page_view(slug: str, db: Session = Depends(get_db)):
    """Increment daily view counter for a studio (no auth required)."""
    from app.models.studio import Studio
    from sqlalchemy import text as _t
    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa
    if not studio:
        return
    db.execute(_t("""
        INSERT INTO marketplace_page_views (id, studio_id, view_date, count)
        VALUES (gen_random_uuid(), :sid, CURRENT_DATE, 1)
        ON CONFLICT (studio_id, view_date)
        DO UPDATE SET count = marketplace_page_views.count + 1
    """), {"sid": str(studio.id)})
    db.commit()


# ── Marketplace analytics for studio owner ────────────────────────────────────

@router.get("/my/analytics")
def get_marketplace_analytics(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    from sqlalchemy import text as _t

    sid = str(ctx.studio_id)

    # Page views — 7d / 30d / total
    views_7d = db.execute(_t("""
        SELECT COALESCE(SUM(count), 0) FROM marketplace_page_views
        WHERE studio_id = :sid AND view_date >= CURRENT_DATE - INTERVAL '7 days'
    """), {"sid": sid}).scalar() or 0

    views_30d = db.execute(_t("""
        SELECT COALESCE(SUM(count), 0) FROM marketplace_page_views
        WHERE studio_id = :sid AND view_date >= CURRENT_DATE - INTERVAL '30 days'
    """), {"sid": sid}).scalar() or 0

    views_total = db.execute(_t("""
        SELECT COALESCE(SUM(count), 0) FROM marketplace_page_views
        WHERE studio_id = :sid
    """), {"sid": sid}).scalar() or 0

    # Daily breakdown — last 30 days
    daily = db.execute(_t("""
        SELECT view_date::text, count FROM marketplace_page_views
        WHERE studio_id = :sid AND view_date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY view_date
    """), {"sid": sid}).fetchall()

    # Favorites
    favorites_count = db.execute(_t("""
        SELECT COUNT(*) FROM marketplace_favorites mf
        JOIN studios s ON s.slug = mf.studio_slug
        WHERE s.id = :sid
    """), {"sid": sid}).scalar() or 0

    # Booking requests this month
    requests_month = db.execute(_t("""
        SELECT COUNT(*) FROM booking_requests
        WHERE studio_id = :sid
          AND created_at >= date_trunc('month', CURRENT_DATE)
    """), {"sid": sid}).scalar() or 0

    # Total booking requests
    requests_total = db.execute(_t("""
        SELECT COUNT(*) FROM booking_requests WHERE studio_id = :sid
    """), {"sid": sid}).scalar() or 0

    # New clients linked from marketplace (customers whose phone matches a client)
    linked_clients = db.execute(_t("""
        SELECT COUNT(DISTINCT c.id)
        FROM clients c
        JOIN marketplace_customers mc ON mc.phone = c.phone
        WHERE c.studio_id = :sid AND c.is_active = true
    """), {"sid": sid}).scalar() or 0

    # Get studio slug for BizFind link
    slug_row = db.execute(_t("SELECT slug FROM studios WHERE id = :sid"), {"sid": sid}).fetchone()
    studio_slug = slug_row[0] if slug_row else ""

    # Marketplace visible?
    visible_row = db.execute(_t("""
        SELECT marketplace_visible FROM studio_settings WHERE studio_id = :sid
    """), {"sid": sid}).fetchone()
    marketplace_visible = bool(visible_row[0]) if visible_row else False

    return {
        "marketplace_visible": marketplace_visible,
        "studio_slug": studio_slug,
        "views": {
            "last_7_days": int(views_7d),
            "last_30_days": int(views_30d),
            "total": int(views_total),
        },
        "favorites_count": int(favorites_count),
        "booking_requests": {
            "this_month": int(requests_month),
            "total": int(requests_total),
        },
        "linked_clients": int(linked_clients),
        "daily_views": [{"date": r[0], "count": r[1]} for r in daily],
    }
