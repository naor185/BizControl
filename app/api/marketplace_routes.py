"""
Public Marketplace API — Phase 4.
All endpoints are public (no auth required).
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/marketplace", tags=["Marketplace"])

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
        "gallery": [
            u for u in [
                settings.landing_page_image_1,
                settings.landing_page_image_2,
                settings.landing_page_image_3,
            ] if u
        ],
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
