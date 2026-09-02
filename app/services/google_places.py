"""
Live pass-through to Google Places API (New) for photos/hours/rating on
unclaimed BizFind business pages.

Deliberately NOT stored permanently — Google's terms only allow indefinite
caching of the Place ID itself; photos/hours/rating must be re-fetched live
(a short in-memory TTL cache here just avoids hammering the API on rapid
repeat views, well under Google's 30-day caching limit). The Place ID itself
lives in business_sources (source='google', external_id=place_id) — looked
up once per business, never re-searched.
"""
from __future__ import annotations

import os
import time

import httpx

PLACES_HOST = "https://places.googleapis.com/v1"
_DETAILS_CACHE: dict[str, tuple[float, dict]] = {}
_DETAILS_TTL_SECONDS = 3600  # 1h — well within Google's 30-day cache allowance


def _api_key() -> str | None:
    return os.environ.get("GOOGLE_PLACES_API_KEY")


def find_place_id(name: str, address: str | None, city: str | None, category_label: str | None = None) -> str | None:
    """One-time lookup — the result (place_id) is meant to be stored by the
    caller in business_sources, never re-searched for the same business.

    Without a real street address (common — OSM often has none), a bare
    "name + city" text search can match the wrong business entirely.
    Including the category label (e.g. "ספר / ברברשופ") biases Google's
    ranking toward the right *kind* of place, which is the best signal
    available when the address is missing."""
    api_key = _api_key()
    if not api_key:
        return None

    query = " ".join(filter(None, [category_label, name, address, city]))
    try:
        resp = httpx.post(
            f"{PLACES_HOST}/places:searchText",
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": "places.id",
            },
            json={"textQuery": query, "languageCode": "he"},
            timeout=10,
        )
        resp.raise_for_status()
        places = resp.json().get("places", [])
        return places[0]["id"] if places else None
    except Exception:
        return None


def get_place_details(place_id: str) -> dict | None:
    """Live fetch — photos (as proxy-able names), opening hours, rating,
    formatted address/phone, and up to 5 reviews. Cached in-process for
    _DETAILS_TTL_SECONDS to cut down on API calls."""
    cached = _DETAILS_CACHE.get(place_id)
    if cached and time.time() - cached[0] < _DETAILS_TTL_SECONDS:
        return cached[1]

    api_key = _api_key()
    if not api_key:
        return None

    try:
        resp = httpx.get(
            f"{PLACES_HOST}/places/{place_id}",
            headers={
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": "photos,regularOpeningHours,rating,userRatingCount,"
                                     "formattedAddress,nationalPhoneNumber,reviews",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        result = {
            "photo_names": [p["name"] for p in data.get("photos", [])[:5]],
            "opening_hours": (data.get("regularOpeningHours") or {}).get("weekdayDescriptions"),
            "rating": data.get("rating"),
            "rating_count": data.get("userRatingCount"),
            "address": data.get("formattedAddress"),
            "phone": data.get("nationalPhoneNumber"),
            "reviews": [
                {
                    "author": (r.get("authorAttribution") or {}).get("displayName"),
                    "rating": r.get("rating"),
                    "text": (r.get("text") or {}).get("text"),
                    "relative_time": r.get("relativePublishTimeDescription"),
                }
                for r in data.get("reviews", [])[:5]
                if (r.get("text") or {}).get("text")
            ],
        }
        _DETAILS_CACHE[place_id] = (time.time(), result)
        return result
    except Exception:
        return None


def get_place_photo(photo_name: str, max_width: int = 800) -> tuple[bytes, str] | None:
    """Fetches raw photo bytes + content-type for proxying — the API key
    never reaches the browser this way."""
    api_key = _api_key()
    if not api_key:
        return None
    try:
        resp = httpx.get(
            f"{PLACES_HOST}/{photo_name}/media",
            params={"maxWidthPx": max_width, "key": api_key, "skipHttpRedirect": "false"},
            timeout=10,
            follow_redirects=True,
        )
        resp.raise_for_status()
        return resp.content, resp.headers.get("content-type", "image/jpeg")
    except Exception:
        return None
