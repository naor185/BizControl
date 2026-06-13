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
from app.db.deps import get_db as _get_db

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


# ── Studio owner login (no slug required) ─────────────────────────────────────

class MarketplaceLoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/auth/login")
def marketplace_login(payload: MarketplaceLoginIn, db: Session = Depends(get_db)):
    """Login for studio owners/admins via BizFind portal (email + password only)."""
    from app.models.user import User
    from app.models.refresh_token import RefreshToken
    from app.core.security import create_access_token, create_refresh_token
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError

    ph = PasswordHasher()
    email = payload.email.lower().strip()

    user = db.scalar(
        select(User).where(
            User.email == email,
            User.is_active == True,  # noqa
            User.role.in_(["owner", "admin", "superadmin"]),
        ).order_by(User.created_at)
    )
    if not user:
        raise HTTPException(status_code=401, detail="מייל או סיסמה שגויים")

    try:
        ph.verify(user.password_hash, payload.password)
    except VerifyMismatchError:
        raise HTTPException(status_code=401, detail="מייל או סיסמה שגויים")

    access = create_access_token({"user_id": str(user.id), "studio_id": str(user.studio_id), "role": user.role})
    refresh = create_refresh_token({"user_id": str(user.id), "studio_id": str(user.studio_id)})
    db.add(RefreshToken(id=uuid.uuid4(), studio_id=user.studio_id, user_id=user.id, token=refresh, is_revoked=False))
    db.commit()
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


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
        is_active=True,
        plan_expires_at=expires,
        is_platform=False,
    )
    db.add(studio)
    db.flush()

    # Studio settings — tag with category and city
    settings = StudioSettings(
        studio_id=studio.id,
        studio_address=payload.city.strip(),
    )
    db.add(settings)

    # Create marketplace profile with all business details
    db.execute(
        text("""
            INSERT INTO marketplace_profiles
                (id, studio_id, business_name, category, city, phone, whatsapp,
                 plan_code, is_active, is_published, created_at, updated_at)
            VALUES
                (:id, :sid, :bname, :cat, :city, :phone, :phone,
                 :plan, true, true, NOW(), NOW())
            ON CONFLICT (studio_id) DO UPDATE SET
                business_name = EXCLUDED.business_name,
                category      = EXCLUDED.category,
                city          = EXCLUDED.city,
                plan_code     = EXCLUDED.plan_code,
                updated_at    = NOW()
        """),
        {
            "id": str(uuid.uuid4()), "sid": str(studio.id),
            "bname": payload.business_name.strip(),
            "cat": payload.category.strip(),
            "city": payload.city.strip(),
            "phone": payload.phone.strip() if payload.phone else None,
            "plan": plan["subscription_plan"],
        },
    )

    owner = User(
        id=uuid.uuid4(),
        studio_id=studio.id,
        email=email,
        password_hash=ph.hash(payload.password),
        role="owner",
        display_name=payload.owner_name.strip(),
        phone=payload.phone.strip() if payload.phone else None,
        is_active=True,
    )
    db.add(owner)
    db.commit()

    access = create_access_token({"user_id": str(owner.id), "studio_id": str(studio.id), "role": "owner"})
    refresh = create_refresh_token({"user_id": str(owner.id), "studio_id": str(studio.id)})
    db.add(RefreshToken(id=uuid.uuid4(), studio_id=studio.id, user_id=owner.id, token=refresh, is_revoked=False))
    db.commit()

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


@router.get("/plans")
def get_plans(db: Session = Depends(get_db)):
    """Public endpoint — returns available BizFind plans with their feature flags."""
    plans = []
    for k, v in BIZFIND_PLANS.items():
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
    """Returns feature flags for a specific plan."""
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

    # Update marketplace_profiles too (created during registration)
    update_fields: dict = {}
    if payload.business_name: update_fields["business_name"] = payload.business_name.strip()
    if payload.description:   update_fields["description"]   = payload.description.strip()
    if payload.city:          update_fields["city"]          = payload.city.strip()
    if payload.address:       update_fields["address"]       = payload.address.strip() if hasattr(payload, "address") else None
    if payload.phone:         update_fields["phone"]         = payload.phone.strip()
    if payload.category:      update_fields["category"]      = payload.category.strip()

    if update_fields:
        set_clause = ", ".join(f"{k} = :{k}" for k in update_fields)
        update_fields["sid"] = str(ctx.studio_id)
        db.execute(
            text(f"UPDATE marketplace_profiles SET {set_clause}, updated_at=NOW() WHERE studio_id = :sid"),
            update_fields,
        )

    db.commit()
    return {"ok": True}


# ── Smart studio profile for dashboard (authenticated) ────────────────────────

@router.get("/studio/me")
def get_my_studio_profile(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    """Returns full studio profile for BizFind dashboard — merges marketplace + BizControl data."""
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
    "other":           "אחר",
}

BUSINESS_TYPE_ICONS = {
    "tattoo":  "🎨", "barber":  "✂️", "nails":  "💅",
    "laser":   "⚡", "pilates": "🏃", "spa":    "🧖",
    "medical": "🏥", "other":   "🏢",
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
    """Return business type categories with counts."""
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings

    counts = db.execute(
        select(Studio.business_type, func.count(Studio.id))
        .join(StudioSettings, StudioSettings.studio_id == Studio.id)
        .where(Studio.is_active == True, StudioSettings.marketplace_visible == True)  # noqa
        .group_by(Studio.business_type)
    ).all()

    return [
        {
            "id": bt or "other",
            "label": BUSINESS_TYPE_LABELS.get(bt or "other", "אחר"),
            "icon": BUSINESS_TYPE_ICONS.get(bt or "other", "🏢"),
            "count": count,
        }
        for bt, count in counts
    ]


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
    }


# ── Reviews ────────────────────────────────────────────────────────────────────

class ReviewCreate(BaseModel):
    client_name: str = Field(..., max_length=120)
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=1000)


@router.post("/{slug}/reviews", status_code=201)
def submit_review(slug: str, payload: ReviewCreate, db: Session = Depends(get_db)):
    from app.models.studio import Studio
    from app.models.studio_review import StudioReview

    studio = db.scalar(select(Studio).where(Studio.slug == slug, Studio.is_active == True))  # noqa
    if not studio:
        raise HTTPException(404, "Studio not found")

    review = StudioReview(
        studio_id=studio.id,
        client_name=payload.client_name,
        rating=payload.rating,
        comment=payload.comment,
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
