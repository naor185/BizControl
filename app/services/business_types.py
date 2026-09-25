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


def studio_terms(db, studio_id) -> dict[str, str]:
    """The words this business uses: the generic words, its field's words over them, then the owner's own
    over those. Every key of TERM_LABELS is always present."""
    from app.data.business_types import GENERIC_TERMS, TERM_LABELS
    from app.models.module import BusinessTypeTemplate
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    studio = db.get(Studio, studio_id)
    t = db.get(BusinessTypeTemplate, studio.business_type) if studio and studio.business_type else None
    settings = db.get(StudioSettings, studio_id)
    words = dict(GENERIC_TERMS)
    for layer in ((t.terms if t else None) or {}, (settings.business_terms if settings else None) or {}):
        words.update({k: v for k, v in layer.items() if k in TERM_LABELS and isinstance(v, str) and v.strip()})
    return words


def message_default(db, studio_id, key: str) -> str:
    """The default text of a message for this business's field (e.g. "aftercare") — the field's own text,
    or the generic one. Used when the owner has not written their own."""
    from app.data.business_types import GENERIC_MESSAGES
    from app.models.module import BusinessTypeTemplate
    from app.models.studio import Studio
    studio = db.get(Studio, studio_id)
    t = db.get(BusinessTypeTemplate, studio.business_type) if studio and studio.business_type else None
    own = ((t.message_defaults if t else None) or {}).get(key)
    return own if isinstance(own, str) and own.strip() else GENERIC_MESSAGES.get(key, "")


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


def enable_field_modules(db, studio_id, business_type: str | None) -> list[str]:
    """Turns on the modules that come with the business's field — in the type's default modules and
    not sold in any plan (e.g. group classes for pilates and gyms). Modules a plan sells stay with the
    plan; a module the superadmin already set for this business (on or off) is left as it is.
    Returns the modules turned on. The owner's decision, 2026-09-25: a new pilates business sees its
    classes from signup."""
    from sqlalchemy import select
    from app.models.module import BusinessTypeTemplate, Module, PlanModule, StudioModule
    tmpl = db.get(BusinessTypeTemplate, business_type) if business_type else None
    if not tmpl:
        return []
    sold = set(db.scalars(select(PlanModule.module_id).distinct()).all())
    already = set(db.scalars(select(StudioModule.module_id).where(StudioModule.studio_id == studio_id)).all())
    turned_on = []
    for mid in tmpl.default_modules or []:
        if mid in sold or mid in already or mid in turned_on or not db.get(Module, mid):
            continue
        db.add(StudioModule(studio_id=studio_id, module_id=mid, is_enabled=True))
        turned_on.append(mid)
    return turned_on
