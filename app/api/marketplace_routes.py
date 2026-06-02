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

router = APIRouter(prefix="/marketplace", tags=["Marketplace"])


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
        or settings.aftercare_message
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
        "website": settings.marketplace_website or settings.studio_portfolio_link,
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

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db as _get_db

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
