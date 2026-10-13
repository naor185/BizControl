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


def test_a_payment_event_stripe_did_not_sign_is_refused(client, db_session, monkeypatch):
    """Without the webhook secret no event can be told from a made-up one — an unsigned "invoice.paid" used to be
    accepted and would extend any business's plan for free."""
    import app.api.billing_routes as billing
    made_up = {"id": "evt_fake", "type": "invoice.paid", "data": {"object": {"metadata": {"studio_id": "x", "plan": "pro"}}}}
    monkeypatch.setattr(billing, "WEBHOOK_SECRET", "")
    assert client.post("/api/billing/webhook", json=made_up).status_code == 503
    monkeypatch.setattr(billing, "WEBHOOK_SECRET", "whsec_test")
    assert client.post("/api/billing/webhook", json=made_up, headers={"stripe-signature": "t=1,v1=bad"}).status_code == 400


def test_a_branch_manager_stays_in_their_branch_the_owner_moves_between_them(client, db_session):
    """The owner, 2026-10-13: a deputy manager is locked to their branch — the switch let any admin into any sibling
    branch with its owner's sign-in."""
    owner = register_and_login(client, slug="lock-main", email="owner@lock-main.com")
    register_and_login(client, slug="lock-2", email="owner@lock-2.com")
    ids = {s.slug: str(s.id) for s in db_session.scalars(select(Studio).where(Studio.slug.like("lock-%")))}
    _on(db_session, "lock-main", "enterprise")
    _on(db_session, "lock-2", "enterprise")
    sa = register_and_login(client, slug="platform-sa", email="sa@platform.com")
    db_session.scalar(select(User).where(User.email == "sa@platform.com")).role = "superadmin"
    db_session.commit()
    assert client.post("/api/locations/admin/link-organization", headers=sa,
                       json={"studio_ids": [ids["lock-main"], ids["lock-2"]], "main_studio_id": ids["lock-main"]}).status_code == 200

    r = client.post("/api/users/artists", headers=owner, json={"email": "deputy@lock-main.com", "password": "secret123",
                                                                "display_name": "סגן", "role": "admin"})
    assert r.status_code == 201, r.text
    t = client.post("/api/auth/login-by-email", json={"email": "deputy@lock-main.com", "password": "secret123"}).json()["access_token"]
    deputy = {"Authorization": f"Bearer {t}"}

    assert [b["id"] for b in client.get("/api/locations", headers=deputy).json()] == [ids["lock-main"]]   # only theirs
    assert client.post(f"/api/locations/switch/{ids['lock-2']}", headers=deputy).status_code == 403
    assert client.get("/api/locations/unified-stats", headers=deputy).status_code == 403

    assert len(client.get("/api/locations", headers=owner).json()) == 2
    switched = client.post(f"/api/locations/switch/{ids['lock-2']}", headers=owner)
    assert switched.status_code == 200
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {switched.json()['access_token']}"}).json()
    assert me["studio_id"] == ids["lock-2"] and me["role"] == "owner"
