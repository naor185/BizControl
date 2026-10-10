"""The plans as sold from October 2026 (owner, 2026-10-10): three paid plans — עסק קטן, פרו, חברה גדולה — and a free first
month with everything open; no free plan. Every new business starts with the free month. What the superadmin changes
in a plan stays — the startup no longer re-seeds plans over it. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text

from app.models.subscription import Subscription
from app.models.studio import Studio
from tests.conftest import SENT, _build_production_schema


def _contents(db, plan):
    return {r[0]: (r[1], r[2]) for r in db.execute(text(
        "SELECT module_id, limit_value, period_type FROM plan_modules WHERE plan = :p"), {"p": plan}).fetchall()}


def test_three_paid_plans_and_a_free_first_month(client, db_session):
    plans = {r[0]: r[1:] for r in db_session.execute(text(
        "SELECT id, display_name, price_cents, price_annual_cents, trial_days, is_visible, is_purchasable FROM plans")).fetchall()}
    assert plans["trial"][:4] == ("חודש ראשון חינם", 0, None, 30) and plans["trial"][4] is True
    assert plans["starter"] == ("עסק קטן", 11900, 118800, 0, True, True)
    assert plans["pro"] == ("פרו", 24900, 250800, 0, True, True)
    assert plans["enterprise"] == ("חברה גדולה", 44900, 454800, 0, True, True)
    for retired in ("free", "studio", "bizfind_basic", "bizfind_pro"):
        assert plans[retired][4:] == (False, False), retired

    small, pro, big, trial = (_contents(db_session, p) for p in ("starter", "pro", "enterprise", "trial"))
    assert small["whatsapp"] == (400, "monthly") and pro["whatsapp"] == (1500, "monthly") and big["whatsapp"] == (8000, "monthly")
    assert small["broadcasts"] == (10, "monthly") and pro["broadcasts"] == (None, "unlimited")
    assert small["staff_seats"] == (2, "lifetime") and pro["staff_seats"] == (5, "lifetime") and big["staff_seats"] == (None, "unlimited")
    assert big["multi_location"] == (3, "lifetime") and "multi_location" not in pro
    for paid_only in ("coupons", "customer_club", "gift_cards", "wallet"):
        assert paid_only not in small and paid_only in pro and paid_only in big
    for everyone in ("wait_list", "employee_mgmt", "analytics", "online_booking", "marketplace", "whatsapp"):
        assert everyone in small and everyone in pro and everyone in big
    assert set(trial) == set(big)                                             # the free month: everything open
    assert db_session.execute(text("SELECT count(*) FROM plan_modules WHERE module_id IN ('sms', 'voice')")).scalar() == 0

    shown = client.get("/api/marketplace/plans").json()
    assert [(p["key"], p["price_ils"]) for p in shown] == [("trial", 0), ("starter", 119), ("pro", 249), ("enterprise", 449)]


def test_a_new_business_starts_with_the_free_month_whatever_plan_it_picked(client, db_session):
    r = client.post("/api/marketplace/auth/register", json={
        "business_name": "מספרת הדר", "category": "barber", "city": "חיפה", "owner_name": "הדר לוי",
        "email": "hadar@example.com", "password": "secret123", "plan_key": "pro"})        # an older page sent a plan
    assert r.status_code in (200, 201), r.text
    assert (r.json()["plan_key"], r.json()["trial_days"]) == ("trial", 30)
    SENT.clear()                                                                          # sign-up's own e-mails
    studio = db_session.scalar(select(Studio).where(Studio.name == "מספרת הדר"))
    sub = db_session.scalar(select(Subscription).where(Subscription.studio_id == studio.id))
    assert (sub.plan_id, sub.status) == ("trial", "trial")
    assert abs(sub.trial_ends_at - (datetime.now(timezone.utc) + timedelta(days=30))) < timedelta(minutes=5)


def test_what_the_superadmin_changes_in_a_plan_stays_after_the_next_startup(db_session):
    db_session.execute(text("DELETE FROM plan_modules WHERE plan = 'starter' AND module_id = 'broadcasts'"))
    db_session.execute(text("UPDATE plan_modules SET limit_value = 2000 WHERE plan = 'pro' AND module_id = 'whatsapp'"))
    db_session.execute(text("UPDATE plan_modules SET limit_value = 5 WHERE plan = 'pro' AND module_id = 'ai_theme_generate'"))
    db_session.execute(text("DELETE FROM plan_modules WHERE plan = 'free' AND module_id = 'crm'"))
    db_session.execute(text("UPDATE plans SET price_cents = 12900 WHERE id = 'starter'"))
    db_session.commit()

    _build_production_schema(db_session.connection().connection.dbapi_connection)      # the next deploy
    db_session.expire_all()

    pro = _contents(db_session, "pro")
    assert "broadcasts" not in _contents(db_session, "starter")                         # used to come back
    assert pro["whatsapp"][0] == 2000 and pro["ai_theme_generate"][0] == 5               # used to reset to 3
    assert "crm" not in _contents(db_session, "free")
    assert db_session.execute(text("SELECT price_cents FROM plans WHERE id = 'starter'")).scalar() == 12900
