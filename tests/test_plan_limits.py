"""A plan's count limits (owner, 2026-10-10): staff — every active user, the owner included — עסק קטן 2, פרו 5,
חברה גדולה no limit; branches — חברה גדולה up to 3, linked by the superadmin only. Only adding is stopped.
Local test database; nothing is sent."""
from sqlalchemy import select

from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login


def _on(db, slug, plan):
    db.scalar(select(Studio).where(Studio.slug == slug)).subscription_plan = plan
    db.commit()


def _add(client, h, email):
    return client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123",
                                                               "display_name": "עובד", "role": "artist"})


def test_staff_up_to_the_plan_the_owner_counted(client, db_session):
    h = register_and_login(client, slug="small-shop", email="owner@small-shop.com")
    _on(db_session, "small-shop", "starter")
    assert client.get("/api/users/artists/seats", headers=h).json() == {"used": 1, "limit": 2, "left": 1}
    first = _add(client, h, "a@small-shop.com")
    assert first.status_code == 201, first.text
    full = _add(client, h, "b@small-shop.com")
    assert full.status_code == 403 and "עד 2 אנשי צוות, כולל בעל העסק" in full.json()["detail"]

    # someone leaves — a place frees; bringing them back while full is like adding
    assert client.delete(f"/api/users/artists/{first.json()['id']}", headers=h).status_code == 204
    assert _add(client, h, "b@small-shop.com").status_code == 201
    back = client.patch(f"/api/users/artists/{first.json()['id']}", headers=h, json={"is_active": True})
    assert back.status_code == 403

    _on(db_session, "small-shop", "pro")                        # an upgrade opens it
    assert client.patch(f"/api/users/artists/{first.json()['id']}", headers=h, json={"is_active": True}).status_code == 200
    assert client.get("/api/users/artists/seats", headers=h).json() == {"used": 3, "limit": 5, "left": 2}
    _on(db_session, "small-shop", "enterprise")
    assert client.get("/api/users/artists/seats", headers=h).json()["limit"] is None
    assert _add(client, h, "c@small-shop.com").status_code == 201


def test_branches_by_the_superadmin_only_and_up_to_three(client, db_session):
    owner = register_and_login(client, slug="chain-main", email="owner@chain-main.com")
    for slug in ("chain-2", "chain-3", "chain-4"):
        register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    ids = {s.slug: str(s.id) for s in db_session.scalars(select(Studio).where(Studio.slug.like("chain-%")))}
    _on(db_session, "chain-main", "enterprise")
    body = {"studio_ids": [ids["chain-main"], ids["chain-2"]], "main_studio_id": ids["chain-main"]}

    assert client.post("/api/locations/admin/link-organization", json=body).status_code in (401, 403)       # was open
    assert client.post("/api/locations/admin/link-organization", headers=owner, json=body).status_code == 403

    sa = register_and_login(client, slug="platform-sa", email="sa@platform.com")
    db_session.scalar(select(User).where(User.email == "sa@platform.com")).role = "superadmin"
    db_session.commit()
    four = {"studio_ids": list(ids.values()), "main_studio_id": ids["chain-main"]}
    too_many = client.post("/api/locations/admin/link-organization", headers=sa, json=four)
    assert too_many.status_code == 400 and "עד 3 סניפים" in too_many.json()["detail"]
    linked = client.post("/api/locations/admin/link-organization", headers=sa, json=body)
    assert linked.status_code == 200, linked.text
    org = linked.json()["organization_id"]
    more = {"studio_ids": [ids["chain-3"], ids["chain-4"]], "organization_id": org, "main_studio_id": ids["chain-main"]}
    assert client.post("/api/locations/admin/link-organization", headers=sa, json=more).status_code == 400   # 2 + 2 > 3

    _on(db_session, "chain-2", "pro")
    no = client.post("/api/locations/admin/link-organization", headers=sa,
                     json={"studio_ids": [ids["chain-2"], ids["chain-3"]], "main_studio_id": ids["chain-2"]})
    assert no.status_code == 400 and "לא כולל סניפים" in no.json()["detail"]
