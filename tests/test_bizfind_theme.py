"""BizFind's own look, apart from BizControl's (owner, 2026-10-13) — what the superadmin may store, and that BizFind
gets it from the public theme."""
import json

import pytest

from app.services import bizfind_theme


def test_a_field_is_a_color_a_known_font_or_empty():
    assert bizfind_theme.clean({"background": "#FAFAFA", "text": "", "heading_font": "Rubik", "nonsense": "x"}) == {
        "background": "#fafafa", "text": None, "heading_font": "Rubik"}
    with pytest.raises(ValueError):
        bizfind_theme.clean({"buttons": "red"})
    with pytest.raises(ValueError):
        bizfind_theme.clean({"body_font": "Comic Sans"})


def test_saving_changes_only_what_was_sent():
    saved = bizfind_theme.merged(None, {"background": "#ffffff", "text": "#111111"})
    again = json.loads(bizfind_theme.merged(saved, {"text": ""}))          # "" — back to BizFind's default
    assert again["background"] == "#ffffff" and again["text"] is None and again["buttons"] is None
    assert bizfind_theme.read("not json") == {k: None for k in (*bizfind_theme.COLORS, *bizfind_theme.FONTS)}


def test_bizfind_reads_its_part_of_the_public_theme(client):
    theme = client.get("/api/public/platform-theme").json()
    assert "bizfind" in theme and isinstance(theme["bizfind"], dict)
