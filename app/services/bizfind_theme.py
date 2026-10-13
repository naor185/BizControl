"""BizFind's own look — apart from BizControl's (owner, 2026-10-13: "everything for BizFind and everything for
BizControl separately").

The superadmin sets it on the platform settings (the platform's settings row, bizfind_theme as JSON); BizFind reads it
at /api/public/platform-theme (the "bizfind" part) and its ThemeProvider turns it into the --bf-* tokens. A field left
empty keeps BizFind's own default — the black and white look it was built with."""
from __future__ import annotations

import json
import re

COLORS = ("background", "cards", "text", "text_muted", "buttons")
FONTS = ("heading_font", "body_font")
FONT_CHOICES = ("Heebo", "Assistant", "Rubik", "M PLUS Rounded 1c", "Varela Round")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def read(raw: str | None) -> dict:
    """Every field, empty (None) where the default stays."""
    try:
        saved = json.loads(raw or "{}")
    except (TypeError, ValueError):
        saved = {}
    saved = saved if isinstance(saved, dict) else {}
    return {k: saved.get(k) for k in (*COLORS, *FONTS)}


def clean(patch: dict) -> dict:
    """What the superadmin sent, checked: a color is #rrggbb or empty, a font one of the platform's five."""
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
    return out


def merged(raw: str | None, patch: dict) -> str:
    current = read(raw)
    current.update(clean(patch))
    return json.dumps(current, ensure_ascii=False)
