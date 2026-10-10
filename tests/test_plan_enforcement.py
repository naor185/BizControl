"""Stage 2 of the plans (owner, 2026-10-10 — every plan a fixed bundle): the plan is the ceiling. A feature the plan
doesn't sell is closed in the server — the club, coupons, selling gift cards, the wallet card, branches — and only a
locked decision of the superadmin for one business beats it. Group classes need the plan AND a field that uses them.
A card already sold keeps working. Local test database; nothing is sent."""
from sqlalchemy import select, text

from app.core.features import has_module
from app.models.client import Client
from app.models.coupon import Coupon
from app.models.module import StudioModule
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.subscription import Subscription
from app.models.user import User
from app.services import club, coupons
from tests.conftest import register_and_login


def _on(client, db, slug, plan, business_type=None):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.subscription_plan = plan
    if business_type:
        s.business_type = business_type
    db.commit()
    return h, s


def _superadmin(client, db):
    h = register_and_login(client, slug="platform-sa", email="sa@platform.com")
    db.scalar(select(User).where(User.email == "sa@platform.com")).role = "superadmin"
    db.commit()
    return h


def test_the_plan_is_the_ceiling_and_only_the_superadmins_decision_beats_it(client, db_session):
    _, small = _on(client, db_session, "small", "starter")
    assert [has_module(db_session, small.id, m) for m in ("customer_club", "coupons", "gift_cards", "wallet")] == [False] * 4
    assert has_module(db_session, small.id, "whatsapp") and has_module(db_session, small.id, "wait_list")

    db_session.add(StudioModule(studio_id=small.id, module_id="customer_club", is_enabled=True))   # not a decision
    db_session.commit()
    assert not has_module(db_session, small.id, "customer_club")                                  # the plan is the ceiling
    sa = _superadmin(client, db_session)
    r = client.put(f"/api/admin/studios/{small.id}/modules/customer_club", headers=sa, json={"is_enabled": True})
    assert r.json()["is_locked"] is True
    db_session.expire_all()
    assert has_module(db_session, small.id, "customer_club")                                      # the superadmin's word

    _, pro = _on(client, db_session, "pro-one", "pro")
    assert has_module(db_session, pro.id, "customer_club")
    db_session.add(StudioModule(studio_id=pro.id, module_id="customer_club", is_enabled=False))     # turned off, in the plan
    db_session.commit()
    assert not has_module(db_session, pro.id, "customer_club")


def test_group_classes_need_the_plan_and_a_field_that_uses_them(client, db_session):
    _, small_pilates = _on(client, db_session, "pilates-small", "starter", "pilates")
    _, pro_pilates = _on(client, db_session, "pilates-pro", "pro", "pilates")
    _, pro_tattoo = _on(client, db_session, "ink-pro", "pro", "tattoo")
    assert not has_module(db_session, small_pilates.id, "classes")
    assert has_module(db_session, pro_pilates.id, "classes") and has_module(db_session, pro_pilates.id, "memberships")
    assert not has_module(db_session, pro_tattoo.id, "classes")
    db_session.add(StudioModule(studio_id=pro_tattoo.id, module_id="classes", is_enabled=True, is_locked=True))
    db_session.commit()
    assert has_module(db_session, pro_tattoo.id, "classes")                                       # the superadmin's word


def test_a_small_business_has_no_club_coupons_or_gift_card_sales_until_it_moves_up(client, db_session):
    h, s = _on(client, db_session, "small-shop", "starter")
    db_session.get(StudioSettings, s.id).points_percent_per_payment = 5
    member = Client(studio_id=s.id, full_name="יעל", phone="0501112233", is_club_member=True)
    db_session.add_all([member, Coupon(studio_id=s.id, code="SUMMER", discount_percent=10)])
    db_session.commit()

    assert client.get("/api/coupons", headers=h).status_code == 403
    assert client.post("/api/gift-cards", headers=h, json={"amount_cents": 20000, "recipient_name": "דנה"}).status_code == 403
    assert client.get(f"/api/public/gift-cards/shop/{s.id}").status_code == 404
    assert client.post(f"/api/public/studio/{s.id}/join", json={"full_name": "רון", "phone": "0509998877"}).status_code == 404
    assert club.cashback_percent(db_session, s.id, member) == 0
    try:
        coupons.find(db_session, s.id, "SUMMER")
        raise AssertionError("a coupon worked without the plan")
    except ValueError as e:
        assert str(e) == "קופונים לא כלולים במסלול של העסק"

    s.subscription_plan = "pro"
    db_session.commit()
    assert client.get("/api/coupons", headers=h).status_code == 200
    assert client.get(f"/api/public/gift-cards/shop/{s.id}").status_code == 200
    assert club.cashback_percent(db_session, s.id, member) == 5
    assert coupons.find(db_session, s.id, "SUMMER").percent == 10


def test_the_old_registration_opens_the_free_month(client, db_session):
    r = client.post("/api/studios/register", json={"name": "עסק חדש", "slug": "brand-new", "email": "new@x.com",
                                                    "password": "password123"})
    assert r.status_code == 200, r.text
    s = db_session.scalar(select(Studio).where(Studio.slug == "brand-new"))
    sub = db_session.scalar(select(Subscription).where(Subscription.studio_id == s.id))
    assert (s.subscription_plan, sub.plan_id, sub.status) == ("trial", "trial", "trial")
    assert db_session.execute(text("SELECT count(*) FROM studios WHERE subscription_plan = 'free' AND slug = 'brand-new'")).scalar() == 0


def test_a_locked_feature_names_the_plan_that_has_it(client, db_session):
    h, s = _on(client, db_session, "small-up", "starter", "pilates")
    up = client.get("/api/modules/me/upgrades", headers=h).json()
    assert (up["customer_club"], up["gift_cards"], up["coupons"], up["multi_location"]) == ("פרו", "פרו", "פרו", "חברה גדולה")
    assert up["classes"] == "פרו" and "whatsapp" not in up                 # a pilates studio's field uses classes
    hi, _ = _on(client, db_session, "ink-up", "starter", "tattoo")
    assert "classes" not in client.get("/api/modules/me/upgrades", headers=hi).json()   # no plan gives a tattoo studio classes

    assert client.get("/api/public/landing/small-up").json()["club_open"] is False      # the join page shows no form
    s.subscription_plan = "pro"
    db_session.commit()
    assert client.get("/api/public/landing/small-up").json()["club_open"] is True
