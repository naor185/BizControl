"""The superadmin's CRM (owner, 2026-10-10): every business using BizControl, with its plan, activity and a retention
signal — active / at risk (free month ends within 7 days, no one in for 14 days, no appointments in 30) / inactive
(the plan ended, no one in for 30 days). Only the superadmin sees it. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.studio import Studio
from app.models.user import User
from app.services.platform_crm import ACTIVE, AT_RISK, INACTIVE, signal
from tests.conftest import register_and_login

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
DAY = timedelta(days=1)


def test_the_retention_signal():
    old = NOW - 60 * DAY
    assert signal("expired", None, NOW, 5, old, NOW) == (INACTIVE, "המנוי הסתיים")
    assert signal("active", None, NOW - 31 * DAY, 5, old, NOW) == (INACTIVE, "לא נכנס 31 ימים")
    assert signal("active", None, None, 0, old, NOW) == (INACTIVE, "לא נכנס למערכת")
    assert signal("trial", None, None, 0, NOW - 2 * DAY, NOW) == (ACTIVE, "עסק חדש")
    assert signal("trial", NOW + 5 * DAY + timedelta(hours=1), NOW, 3, NOW - 25 * DAY, NOW) == (AT_RISK, "החודש החינמי נגמר בעוד 5 ימים")
    assert signal("active", None, NOW - 15 * DAY, 3, old, NOW) == (AT_RISK, "לא נכנס 15 ימים")
    assert signal("active", None, NOW - DAY, 0, old, NOW) == (AT_RISK, "לא קבע תורים בחודש האחרון")
    assert signal("active", None, NOW - DAY, 4, old, NOW) == (ACTIVE, "פעיל")


def test_only_the_superadmin_sees_every_business(client, db_session):
    owner = register_and_login(client, slug="crm-shop", email="owner@crm-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "crm-shop"))
    s.subscription_plan = "pro"
    db_session.commit()
    assert client.get("/api/admin/crm/customers", headers=owner).status_code == 403

    sa = register_and_login(client, slug="platform-sa", email="sa@platform.com")
    db_session.scalar(select(User).where(User.email == "sa@platform.com")).role = "superadmin"
    sa_studio = db_session.scalar(select(Studio).where(Studio.slug == "platform-sa"))
    sa_studio.is_platform = True                                               # the platform's own — not a customer
    db_session.commit()
    rows = {r["slug"]: r for r in client.get("/api/admin/crm/customers", headers=sa).json()}
    assert "platform-sa" not in rows
    shop = rows["crm-shop"]
    assert (shop["owner_email"], shop["plan_label"], shop["monthly_ils"]) == ("owner@crm-shop.com", "פרו", 249)
    assert shop["signal"] in (ACTIVE, AT_RISK, INACTIVE) and shop["last_active"] is not None   # it just signed in
