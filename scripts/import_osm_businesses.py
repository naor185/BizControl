"""
Seeds the `businesses` table (unclaimed BizFind listings, see business_routes.py)
from OpenStreetMap via the public Overpass API — free, no API key, no
per-request caching restrictions (unlike Google Places).

Usage:
    python scripts/import_osm_businesses.py --city "שוהם" --category barber --osm-tag "shop=hairdresser"

--category must be one of the internal keys BizFind already uses for real
studios (see BUSINESS_TYPE_LABELS in app/api/marketplace_routes.py):
tattoo, barber, nails, laser, pilates, spa, medical, other.

Safe to re-run — dedupes against business_sources (source='osm',
external_id=<osm type>/<osm id>), so already-imported businesses are skipped
rather than duplicated. Never touches a business once claim_status != 'unclaimed'.
"""
import argparse
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import uuid
import re
import requests
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

DATABASE_URL = os.getenv("DATABASE_URL")
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

VALID_CATEGORIES = {"tattoo", "barber", "nails", "laser", "pilates", "spa", "medical", "other"}


def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug, flags=re.UNICODE)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:48] or "business"


def fetch_osm_businesses(city: str, osm_tag: str, limit: int) -> list[dict]:
    key, _, value = osm_tag.partition("=")
    tag_filter = f'["{key}"="{value}"]' if value else f'["{key}"]'

    query = f"""
        [out:json][timeout:60];
        area["name"="{city}"]["boundary"="administrative"]->.searchArea;
        (
          node{tag_filter}(area.searchArea);
          way{tag_filter}(area.searchArea);
        );
        out center {limit};
    """
    resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=90)
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


def import_businesses(city: str, category: str, osm_tag: str, limit: int):
    if category not in VALID_CATEGORIES:
        print(f"❌ Unknown category '{category}'. Valid: {', '.join(sorted(VALID_CATEGORIES))}")
        return
    if not DATABASE_URL:
        print("❌ DATABASE_URL not set.")
        return

    print(f"Querying OpenStreetMap for {osm_tag} in {city}...")
    found = fetch_osm_businesses(city, osm_tag, limit)
    print(f"Found {len(found)} candidates.")

    engine = create_engine(DATABASE_URL)
    created, skipped = 0, 0
    with Session(engine) as db:
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

    print(f"✅ Done. Created {created}, skipped {skipped} (already imported).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True, help='OSM administrative area name, e.g. "שוהם"')
    parser.add_argument("--category", required=True, help="Internal category key, e.g. barber")
    parser.add_argument("--osm-tag", required=True, help='OSM tag to search, e.g. "shop=hairdresser"')
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    import_businesses(args.city, args.category, args.osm_tag, args.limit)
