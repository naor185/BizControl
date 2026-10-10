"""The superadmin's CRM, part ג: the businesses' payments to BizControl. A payment recorded by hand extends the period —
a calendar month or twelve, from the later of today and the current end (a free month is kept) — and the collection
list shows who's due within 7 days and who's late, never a business that cancelled at the end of its period.
Local test database; nothing is sent."""
from datetime import date, datetime, timedelta, timezone

from dateutil.relativedelta import relativedelta
from sqlalchemy import select

from app.models.studio import Studio
from app.models.subscription import Subscription
from app.models.user import User
from tests.conftest import register_and_login

DAY = timedelta(days=1)


def _superadmin(client, db):
    h = register_and_login(client, slug="platform-sa", email="sa@platform.com")
    db.scalar(select(User).where(User.email == "sa@platform.com")).role = "superadmin"
    db.scalar(select(Studio).where(Studio.slug == "platform-sa")).is_platform = True
    db.commit()
    return h


def _business(client, db, slug, *, plan, status, ends_in, cancel=False):
    register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    st = db.scalar(select(Studio).where(Studio.slug == slug))
    sub = db.scalar(select(Subscription).where(Subscription.studio_id == st.id))
    end = datetime.now(timezone.utc) + ends_in
    st.subscription_plan, st.plan_expires_at = plan, end
    sub.plan_id, sub.status, sub.current_period_end, sub.cancel_at_period_end = plan, status, end, cancel
    sub.trial_ends_at = end if status == "trial" else None
    db.commit()
    return st


def test_a_payment_in_the_free_month_starts_when_the_free_month_ends(client, db_session):
    sa = _superadmin(client, db_session)
    st = _business(client, db_session, "new-shop", plan="trial", status="trial", ends_in=10 * DAY)
    trial_end = st.plan_expires_at

    r = client.post("/api/admin/crm/payments", headers=sa, json={
        "studio_id": str(st.id), "plan_id": "pro", "cycle": "monthly", "amount_ils": 249, "method": "bit",
        "paid_on": date.today().isoformat(), "note": "שילם בביט"})
    assert r.status_code == 200, r.text

    db_session.expire_all()
    st = db_session.get(Studio, st.id)
    sub = db_session.scalar(select(Subscription).where(Subscription.studio_id == st.id))
    assert st.plan_expires_at == trial_end + relativedelta(months=1)
    assert (st.subscription_plan, sub.plan_id, sub.status, sub.current_period_end) == ("pro", "pro", "active", st.plan_expires_at)

    row = next(c for c in client.get("/api/admin/crm/customers", headers=sa).json() if c["slug"] == "new-shop")
    assert row["status"] == "active" and row["days_left"] >= 38          # the paid month, not the old free-month date
    paid = client.get(f"/api/admin/crm/payments?studio_id={st.id}", headers=sa).json()
    assert [(p["plan_label"], p["amount_ils"], p["method"], p["note"]) for p in paid] == [("פרו", 249, "ביט", "שילם בביט")]
    money = client.get("/api/admin/crm/billing", headers=sa).json()
    assert money["received_this_month_ils"] == 249
    plans = client.get("/api/admin/crm/payment-options", headers=sa).json()["plans"]
    assert [(p["id"], p["monthly_ils"], p["annual_ils"]) for p in plans] == [
        ("starter", 119, 1188), ("pro", 249, 2508), ("enterprise", 449, 4548)]

    assert client.post("/api/admin/crm/payments", headers=sa, json={
        "studio_id": str(st.id), "plan_id": "trial", "cycle": "monthly", "amount_ils": 0, "method": "bit",
        "paid_on": date.today().isoformat()}).status_code == 400
    owner = register_and_login(client, slug="other", email="o@other.com")
    assert client.get("/api/admin/crm/billing", headers=owner).status_code == 403


def test_who_is_due_who_is_late_and_an_annual_payment(client, db_session):
    sa = _superadmin(client, db_session)
    due = _business(client, db_session, "due-shop", plan="pro", status="active", ends_in=3 * DAY)
    late = _business(client, db_session, "late-shop", plan="starter", status="active", ends_in=-5 * DAY)
    _business(client, db_session, "leaving-shop", plan="pro", status="active", ends_in=3 * DAY, cancel=True)
    _business(client, db_session, "gone-shop", plan="pro", status="active", ends_in=-60 * DAY)
    trial = _business(client, db_session, "trial-shop", plan="trial", status="trial", ends_in=2 * DAY)

    money = client.get("/api/admin/crm/billing", headers=sa).json()
    states = {r["name"]: (r["state"], r["amount_ils"]) for r in money["collect"]}
    assert states == {late.name: ("overdue", 119), due.name: ("due_soon", 249), trial.name: ("trial_ending", 0)}
    assert (money["due_soon_ils"], money["overdue_ils"]) == (249, 119)
    assert money["monthly_ils"] == 249 + 119      # due and late — not the one leaving, the one gone 60 days, the free month

    # an annual payment from a late business: twelve months from today, and it counts as a twelfth a month
    r = client.post("/api/admin/crm/payments", headers=sa, json={
        "studio_id": str(late.id), "plan_id": "starter", "cycle": "annual", "amount_ils": 1188, "method": "bank",
        "paid_on": date.today().isoformat()})
    assert r.status_code == 200, r.text
    db_session.expire_all()
    end = db_session.get(Studio, late.id).plan_expires_at
    assert abs(end - (datetime.now(timezone.utc) + relativedelta(months=12))) < timedelta(minutes=5)
    money = client.get("/api/admin/crm/billing", headers=sa).json()
    assert late.name not in {r["name"] for r in money["collect"]}
    assert money["monthly_ils"] == 249 + 99
