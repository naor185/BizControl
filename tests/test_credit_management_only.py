"""A credit note (זיכוי) gives money back — the owner's decision (2026-09-26): only the business's management (the owner,
a manager) may issue one, from a payment or from an invoice. Local test database; nothing is sent."""
from sqlalchemy import select, text

from app.models.payment import Payment
from app.models.user import User
from tests.test_classes_stage4 import _business, _client, _sell, _type, clock  # noqa: F401


def test_only_management_issues_a_credit_note(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    c = _client(db_session, s, 1)
    card = _sell(client, h, c, _type(client, h))
    client.post(f"/api/classes/memberships/{card['id']}/payments", headers=h, json={"amount_cents": 60000, "method": "cash", "send_receipt": False})
    paid = db_session.scalar(select(Payment).where(Payment.membership_id == card["id"]))
    invoice_id = db_session.execute(text("SELECT id FROM invoices WHERE source_id = :p"), {"p": str(paid.id)}).scalar()
    me = db_session.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
    me.role = "staff"
    db_session.commit()
    # a worker: refused — receipts are the owner's, or a manager's he allowed (core/permissions, 2026-10-13)
    for path in (f"/api/payments/{paid.id}/credit", f"/api/invoices/{invoice_id}/credit"):
        r = client.post(path, headers=h, json={})
        assert r.status_code == 403 and r.json()["detail"] == "האזור הזה של בעל העסק והמנהלים", path
    # a manager — only once the owner allowed receipts (core/permissions, 2026-10-13; off by default)
    me.role = "admin"
    db_session.commit()
    assert client.post(f"/api/payments/{paid.id}/credit", headers=h).status_code == 403
    import json
    from app.models.studio_settings import StudioSettings
    db_session.get(StudioSettings, s.id).manager_permissions = json.dumps({"receipts": True})
    db_session.commit()
    assert client.post(f"/api/payments/{paid.id}/credit", headers=h).status_code == 200
