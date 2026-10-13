"""The list Google reads (BizFind's sitemap.xml) — every business BizFind shows, none it hides (owner, 2026-10-13)."""
from tests.conftest import register_and_login


def test_the_sitemap_lists_the_businesses_bizfind_shows(client):
    shown = register_and_login(client, "seo-shown", "owner@seo-shown.com")
    register_and_login(client, "seo-hidden", "owner@seo-hidden.com")
    r = client.patch("/api/studio/automation", headers=shown, json={"marketplace_visible": True, "marketplace_city": " חיפה "})
    assert r.status_code == 200, r.text

    entries = {e["slug"]: e for e in client.get("/api/marketplace/sitemap").json()}
    assert "seo-shown" in entries and "seo-hidden" not in entries
    assert entries["seo-shown"]["city"] == "חיפה"
