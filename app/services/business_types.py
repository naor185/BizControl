"""
Business types (תחומי עסק) — read from the one table, business_type_templates.

Every screen and endpoint that lists, shows or stores a business type goes through here, so there is
a single list: the signups, BizFind's search/cards/map, the owner's settings, the superadmin, the
BizFind directory import. A value that is not a known type (free text from an older signup form,
an old label) is matched through the type's name and aliases; anything else is "other".
"""
from __future__ import annotations

import re
from typing import Iterable

OTHER = "other"

_PUNCT = re.compile(r"[\s/\\\-_'\"׳״.,:;()+&]+")


def _norm(value) -> str:
    return _PUNCT.sub("", str(value or "")).lower()


def match_business_type(value, types: Iterable[tuple[str, str, list | None]]) -> str | None:
    """The key of the type `value` names — by key, label or alias, ignoring spaces, punctuation and
    case — or None. `types` = (key, label, aliases) rows; pure, so start.py can use it too."""
    wanted = _norm(value)
    if not wanted:
        return None
    for key, label, aliases in types:
        if wanted in {_norm(key), _norm(label), *(_norm(a) for a in (aliases or []))}:
            return key
    return None


def type_rows(db, include_inactive: bool = False):
    from sqlalchemy import select
    from app.models.module import BusinessTypeTemplate as T
    q = select(T)
    if not include_inactive:
        q = q.where(T.is_active.is_(True))
    rows = db.scalars(q).all()
    return sorted(rows, key=lambda t: (t.sort_order if t.sort_order is not None else 500, t.display_name))


def public_type(t) -> dict:
    return {"key": t.business_type, "label": t.display_name, "icon": t.icon or "store",
            "color": t.color or "#475569", "directory_only": bool(t.is_directory_only)}


def list_business_types(db, *, include_directory: bool = True) -> list[dict]:
    """The active types, in display order ("אחר" last)."""
    return [public_type(t) for t in type_rows(db) if include_directory or not t.is_directory_only]


def type_lookup(db) -> dict[str, dict]:
    """key → public_type for every type (inactive too — a studio may still carry one), for rendering."""
    return {t.business_type: public_type(t) for t in type_rows(db, include_inactive=True)}


def describe(lookup: dict[str, dict], key: str | None) -> dict:
    """How to show a stored type; unknown values show as "אחר"."""
    return lookup.get(key or OTHER) or lookup.get(OTHER) or {"key": OTHER, "label": "אחר", "icon": "store",
                                                             "color": "#475569", "directory_only": False}


def resolve_with_note(db, value, other_text: str | None = None) -> tuple[str, str | None]:
    """(type, note) for a signup or profile form: the chosen type, and — when it is "other" — what the
    owner wrote to describe their business. An older form sent that text as the value itself."""
    key = match_business_type(value, [(t.business_type, t.display_name, t.aliases) for t in type_rows(db)])
    text = (other_text or "").strip() or (None if key else (str(value or "").strip() or None))
    key = key or OTHER
    return key, (text[:120] if key == OTHER and text else None)


def resolve_business_type(db, value, *, strict: bool = False) -> str:
    """The key to store for `value` (a key, a label or an older name). Unknown → "other", or
    ValueError when strict (a choice from our own list must be a real type)."""
    key = match_business_type(value, [(t.business_type, t.display_name, t.aliases) for t in type_rows(db)])
    if key:
        return key
    if strict:
        raise ValueError("תחום העסק לא מוכר")
    return OTHER
