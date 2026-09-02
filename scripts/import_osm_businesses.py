"""
CLI wrapper for app/services/osm_import.py — seeds the `businesses` table
(unclaimed BizFind listings) from OpenStreetMap. The same import is also
available from Super Admin > Import Businesses without needing a terminal.

Usage:
    python scripts/import_osm_businesses.py --city "שוהם" --category barber --osm-tag "shop=hairdresser"
"""
import argparse
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.osm_import import import_osm_businesses, VALID_CATEGORIES

DATABASE_URL = os.getenv("DATABASE_URL")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True, help='OSM administrative area name, e.g. "שוהם"')
    parser.add_argument("--category", required=True, help=f"Internal category key: {', '.join(sorted(VALID_CATEGORIES))}")
    parser.add_argument("--osm-tag", required=True, help='OSM tag to search, e.g. "shop=hairdresser"')
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()

    if not DATABASE_URL:
        print("❌ DATABASE_URL not set.")
        sys.exit(1)

    engine = create_engine(DATABASE_URL)
    print(f"Querying OpenStreetMap for {args.osm_tag} in {args.city}...")
    with Session(engine) as db:
        try:
            result = import_osm_businesses(db, args.city, args.category, args.osm_tag, args.limit)
        except ValueError as e:
            print(f"❌ {e}")
            sys.exit(1)

    print(f"✅ Found {result['found']}. Created {result['created']}, skipped {result['skipped']} (already imported).")
