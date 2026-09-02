"""
Shared logic for seeding the `businesses` table from OpenStreetMap's Overpass
API. Used by both the Super Admin "Import businesses" tool
(app/api/superadmin_routes.py) and the standalone CLI
(scripts/import_osm_businesses.py) — one implementation, two entry points.
"""
from __future__ import annotations

import re
import uuid

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

VALID_CATEGORIES = {
    "tattoo", "barber", "nails", "laser", "pilates", "spa", "medical",
    "massage", "clothing", "pharmacy", "gym", "dental", "photography", "florist",
    "other",
}


def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug, flags=re.UNICODE)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:48] or "business"


def fetch_osm_businesses(city: str, osm_tag: str, limit: int) -> list[dict]:
    key, _, value = osm_tag.partition("=")
    tag_filter = f'["{key}"="{value}"]' if value else f'["{key}"]'

    # A plain area["name"="<city>"]["boundary"="administrative"] misses a lot
    # of real cities — some are tagged as place=city instead of a boundary
    # relation, and Hebrew names are inconsistently on `name` vs `name:he`.
    # Union all three so a real city reliably resolves to *some* area.
    query = f"""
        [out:json][timeout:60];
        (
          area["name"="{city}"]["boundary"="administrative"];
          area["name"="{city}"]["place"];
          area["name:he"="{city}"];
        )->.searchArea;
        (
          node{tag_filter}(area.searchArea);
          way{tag_filter}(area.searchArea);
        );
        out center {limit};
    """
    headers = {
        # Overpass's public instance rejects generic/bot-like requests (406)
        # unless they identify themselves — this is their documented policy,
        # not a bug on our end.
        "User-Agent": "BizFind-Importer/1.0 (BizControl; bizcontrol.system@gmail.com)",
        "Accept": "application/json",
    }
    resp = requests.post(OVERPASS_URL, data={"data": query}, headers=headers, timeout=90)
    resp.raise_for_status()
    elements = resp.json().get("elements", [])

    results = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        street = tags.get("addr:street", "")
        house_number = tags.get("addr:housenumber", "")
        address = f"{street} {house_number}".strip() or None
        phone = tags.get("phone") or tags.get("contact:phone")
        results.append({
            "external_id": f"{el['type']}/{el['id']}",
            "name": name.strip(),
            "address": address,
            "phone": phone,
            "lat": lat,
            "lon": lon,
        })
    return results


def import_osm_businesses(db: Session, city: str, category: str, osm_tag: str, limit: int = 50) -> dict:
    """Fetches businesses from OSM and upserts them into businesses/business_sources.
    Safe to re-run — dedupes by (source, external_id), never touches a business
    once it's no longer 'unclaimed'. Returns {found, created, skipped}."""
    if category not in VALID_CATEGORIES:
        raise ValueError(f"Unknown category '{category}'. Valid: {', '.join(sorted(VALID_CATEGORIES))}")

    found = fetch_osm_businesses(city, osm_tag, limit)
    created, skipped = 0, 0

    for biz in found:
        existing = db.execute(
            text("SELECT business_id FROM business_sources WHERE source='osm' AND external_id=:eid"),
            {"eid": biz["external_id"]},
        ).fetchone()
        if existing:
            skipped += 1
            continue

        base_slug = slugify(biz["name"])
        slug = base_slug
        counter = 1
        while db.execute(text("SELECT 1 FROM businesses WHERE slug=:s"), {"s": slug}).fetchone():
            slug = f"{base_slug}-{counter}"
            counter += 1

        business_id = str(uuid.uuid4())
        db.execute(text("""
            INSERT INTO businesses (id, name, slug, category, city, address, phone, latitude, longitude, claim_status)
            VALUES (:id, :name, :slug, :category, :city, :address, :phone, :lat, :lon, 'unclaimed')
        """), {
            "id": business_id, "name": biz["name"], "slug": slug, "category": category,
            "city": city, "address": biz["address"], "phone": biz["phone"],
            "lat": biz["lat"], "lon": biz["lon"],
        })
        db.execute(text("""
            INSERT INTO business_sources (id, business_id, source, external_id, source_url)
            VALUES (:id, :bid, 'osm', :eid, :url)
        """), {
            "id": str(uuid.uuid4()), "bid": business_id, "eid": biz["external_id"],
            "url": f"https://www.openstreetmap.org/{biz['external_id']}",
        })
        created += 1

    db.commit()
    return {"found": len(found), "created": created, "skipped": skipped}
