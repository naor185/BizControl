"""BizFind's "field + city" pages — "ספרים בראשון לציון", the way people search Google (owner, 2026-10-13: "every
business found on Google through us"; SEO stage 2).

A page per business field and city that BizFind has businesses in — the businesses that joined (BizControl studios
shown on BizFind) and the directory's imports (businesses, unclaimed), the same two lists BizFind's search merges.
Everything on a page comes from them: the businesses, how many book online, the rating, the services and their price
range, the other cities of the field and the other fields of the city. Google is told about a page only when it has
INDEX_FROM businesses or more — a page of one is there for people, not for Google (a near-empty page hurts the site).
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

INDEX_FROM = 2


def _norm(city: str | None) -> str:
    return " ".join((city or "").split())


def _joined(db: Session):
    """The businesses that joined and BizFind shows — BizFind search's own rule."""
    from app.core.studio_access import studio_site_live
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    return (select(Studio, StudioSettings).join(StudioSettings, StudioSettings.studio_id == Studio.id)
            .where(Studio.is_active == True, Studio.is_platform == False,  # noqa: E712
                   StudioSettings.marketplace_visible == True, studio_site_live()))  # noqa: E712


def areas(db: Session) -> list[dict]:
    """Every field + city BizFind has businesses in: {type, label, city, count, joined, indexed}."""
    from app.services.business_types import describe, type_lookup
    counts: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])     # (type, city) → [all, joined]
    for studio, settings in db.execute(_joined(db)).all():
        city = _norm(settings.marketplace_city)
        if city:
            c = counts[(studio.business_type or "other", city)]
            c[0] += 1
            c[1] += 1
    for category, city, n in db.execute(text(
            "SELECT category, city, count(*) FROM businesses WHERE claim_status = 'unclaimed' GROUP BY 1, 2")).all():
        if _norm(city):
            counts[(category or "other", _norm(city))][0] += n
    types = type_lookup(db)
    return sorted(({"type": t, "label": describe(types, t)["label"], "city": city, "count": n, "joined": j,
                    "indexed": n >= INDEX_FROM and t != "other"}
                   for (t, city), (n, j) in counts.items()), key=lambda a: (-a["count"], a["label"], a["city"]))


def area_page(db: Session, business_type: str, city: str) -> dict | None:
    """The page's businesses and what is said about them — None when BizFind has none there."""
    from app.models.service import Service
    from app.models.studio_review import StudioReview
    from app.core.sites import logo_address
    from app.services.business_types import describe, type_lookup
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    city = _norm(city)
    types = type_lookup(db)
    same_city = func.lower(func.btrim(func.coalesce(StudioSettings.marketplace_city, ""))) == city.lower()
    businesses, studio_ids = [], []
    for studio, settings in db.execute(_joined(db).where(Studio.business_type == business_type, same_city)
                                       .order_by(Studio.name)).all():
        rating = db.execute(select(func.avg(StudioReview.rating), func.count(StudioReview.id))
                            .where(StudioReview.studio_id == studio.id, StudioReview.is_approved == True)).one()  # noqa: E712
        studio_ids.append(studio.id)
        businesses.append({
            "slug": studio.slug, "name": studio.name, "is_claimed": True,
            "logo_url": logo_address(studio.logo_url, settings.logo_filename), "cover_url": settings.marketplace_cover_url,
            "address": settings.studio_address, "description": settings.marketplace_description,
            "self_booking_enabled": bool(settings.self_booking_enabled),
            "avg_rating": round(float(rating[0]), 1) if rating[0] else None, "review_count": rating[1] or 0,
        })
    for b in db.execute(text("""
            SELECT b.id, b.slug, b.name, b.address, b.description,
                   (SELECT 1 FROM business_sources bs WHERE bs.business_id = b.id AND bs.source = 'google') AS has_google
            FROM businesses b
            WHERE b.claim_status = 'unclaimed' AND b.category = :t AND lower(btrim(coalesce(b.city, ''))) = :c
            ORDER BY b.name"""), {"t": business_type, "c": city.lower()}).all():
        businesses.append({
            "slug": b.slug, "name": b.name, "is_claimed": False, "logo_url": None,
            "cover_url": f"/api/businesses/{b.id}/photo/0" if b.has_google else None,
            "address": b.address, "description": b.description, "self_booking_enabled": False,
            "avg_rating": None, "review_count": 0,
        })
    if not businesses:
        return None

    # the services of the businesses that joined — each with its price range here
    prices: dict[str, list[int]] = defaultdict(list)
    if studio_ids:
        for name, cents in db.execute(select(Service.name, Service.price_cents)
                                      .where(Service.studio_id.in_(studio_ids), Service.is_active == True)).all():  # noqa: E712
            prices[" ".join(name.split())].append(cents or 0)
    services = sorted(({"name": n, "businesses": len(p), "min_ils": min(p) / 100 if any(p) else None,
                        "max_ils": max(p) / 100 if any(p) else None} for n, p in prices.items()),
                      key=lambda s: (-s["businesses"], s["name"]))[:12]
    rated = [b for b in businesses if b["avg_rating"]]
    everything = areas(db)
    return {
        "type": business_type, "label": describe(types, business_type)["label"], "city": city,
        "count": len(businesses), "joined": len(studio_ids),
        "booking": sum(1 for b in businesses if b["self_booking_enabled"]),
        "avg_rating": round(sum(b["avg_rating"] for b in rated) / len(rated), 1) if rated else None,
        "review_count": sum(b["review_count"] for b in businesses),
        "indexed": len(businesses) >= INDEX_FROM and business_type != "other",
        "businesses": businesses, "services": services,
        "other_cities": [{"city": a["city"], "count": a["count"]} for a in everything
                         if a["type"] == business_type and a["city"] != city][:12],
        "other_fields": [{"type": a["type"], "label": a["label"], "count": a["count"]} for a in everything
                         if a["city"] == city and a["type"] != business_type and a["type"] != "other"][:12],
    }
