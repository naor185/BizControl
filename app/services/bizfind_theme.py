"""BizFind's own look and its home page's words — apart from BizControl's (owner, 2026-10-13: "everything for BizFind
and everything for BizControl separately", "the HERO's settings too").

The superadmin sets them in the "הגדרות BizFind" tab (stored on the platform's settings row, bizfind_theme as JSON);
BizFind reads them at /api/public/platform-theme (the "bizfind" part): its ThemeProvider turns the colors into the
--bf-* tokens, its home page shows the HERO's words. A field left empty keeps BizFind's own default — the black and
white look it was built with, the HERO's words it has always had. The HERO's pictures are their own list
(hero_slides, /api/admin/hero-slides)."""
from __future__ import annotations

import json
import re

COLORS = ("background", "cards", "text", "text_muted", "buttons")
FONTS = ("heading_font", "body_font")
TEXTS = ("hero_badge", "hero_title_dim", "hero_title", "hero_subtitle")
FONT_CHOICES = ("Heebo", "Assistant", "Rubik", "M PLUS Rounded 1c", "Varela Round")
HERO_DEFAULTS = {
    "hero_badge": "גלה עסקים סביבך",
    "hero_title_dim": "כל מה שאתה מחפש,",
    "hero_title": "קרוב אליך.",
    "hero_subtitle": "ספרים, סטודיואים, ציפורניים, ספא ועוד — מצא וקבע תור בשניות",
}
TEXT_MAX = 160
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
FIELDS = (*COLORS, *FONTS, *TEXTS)


def read(raw: str | None) -> dict:
    """Every field, empty (None) where the default stays."""
    try:
        saved = json.loads(raw or "{}")
    except (TypeError, ValueError):
        saved = {}
    saved = saved if isinstance(saved, dict) else {}
    return {k: saved.get(k) for k in FIELDS}


def public(raw: str | None) -> dict:
    """What BizFind gets: the colors and fonts as set (empty: its default), the HERO's words always filled."""
    out = read(raw)
    for k, default in HERO_DEFAULTS.items():
        out[k] = out[k] or default
    return out


def clean(patch: dict) -> dict:
    """What the superadmin sent, checked: a color is #rrggbb, a font one of the platform's five, a text up to
    TEXT_MAX characters — or empty (back to the default)."""
    out = {}
    for k, v in (patch or {}).items():
        v = (v.strip() or None) if isinstance(v, str) else None       # empty: back to BizFind's default
        if k in COLORS:
            if v is not None and not _HEX.match(v):
                raise ValueError(f"צבע לא תקין: {v}")
            out[k] = v.lower() if v else None
        elif k in FONTS:
            if v is not None and v not in FONT_CHOICES:
                raise ValueError(f"פונט לא מוכר: {v}")
            out[k] = v
        elif k in TEXTS:
            if v is not None and len(v) > TEXT_MAX:
                raise ValueError(f"הטקסט ארוך מדי — עד {TEXT_MAX} תווים")
            out[k] = v
    return out


def merged(raw: str | None, patch: dict) -> str:
    current = read(raw)
    current.update(clean(patch))
    return json.dumps(current, ensure_ascii=False)
