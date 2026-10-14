"""BizFind's "field + city" pages (SEO stage 2, owner 2026-10-13) — the businesses that joined and the directory's
imports together, the services' price range, and Google told only from two businesses up."""
import uuid

from sqlalchemy import text

from app.models.studio import Studio
from tests.conftest import register_and_login


def test_a_field_and_city_page_from_both_lists(client, db_session):
    owner = register_and_login(client, "area-ink", "owner@area-ink.com")
    assert client.patch("/api/studio/automation", headers=owner, json={"marketplace_visible": True, "marketplace_city": "חיפה "}).status_code == 200
    db_session.query(Studio).filter(Studio.slug == "area-ink").update({"business_type": "tattoo"})
    db_session.commit()
    for name, cents in (("קעקוע קטן", 30000), ("שרוול", 250000)):
        assert client.post("/api/services", headers=owner, json={"name": name, "price_cents": cents}).status_code == 201

    areas = client.get("/api/marketplace/areas").json()
    alone = next(a for a in areas if a["type"] == "tattoo" and a["city"] == "חיפה")
    assert alone["count"] == 1 and alone["indexed"] is False                 # one business — for people, not Google

    db_session.execute(text("INSERT INTO businesses (id, name, slug, category, city, claim_status) VALUES (:id, 'אינק חיפה', 'ink-haifa', 'tattoo', ' חיפה', 'unclaimed')"),
                       {"id": str(uuid.uuid4())})
    db_session.commit()
    area = next(a for a in client.get("/api/marketplace/areas").json() if a["type"] == "tattoo" and a["city"] == "חיפה")
    assert area["count"] == 2 and area["joined"] == 1 and area["indexed"] is True

    page = client.get("/api/marketplace/areas/tattoo/חיפה").json()
    assert [b["slug"] for b in page["businesses"]] == ["area-ink", "ink-haifa"]
    assert page["label"] and page["count"] == 2
    prices = {s["name"]: (s["min_ils"], s["max_ils"]) for s in page["services"]}
    assert prices["שרוול"] == (2500, 2500) and prices["קעקוע קטן"] == (300, 300)

    assert client.get("/api/marketplace/areas/tattoo/אילת").status_code == 404
