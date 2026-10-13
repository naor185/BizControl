"""BizFind's "my business" page — a client with a BizFind account sees the business, the receipts and the photos
(owner, 2026-10-13: the page showed "שגיאה בטעינת הנתונים")."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.api.marketplace_customer_routes import _make_token
from tests.conftest import register_and_login


def test_the_client_opens_the_business_in_bizfind(client, db_session):
    owner = register_and_login(client, "bf-page", "owner@bf-page.com")
    me = client.get("/api/auth/me", headers=owner).json()
    c = client.post("/api/clients", headers=owner, json={"full_name": "דנה כהן", "phone": "0521234567"}).json()
    start = datetime.now(timezone.utc) + timedelta(days=2)
    a = client.post("/api/appointments", headers=owner, json={"client_id": c["id"], "artist_id": me["id"], "title": "תור",
                                                              "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=1)).isoformat()})
    assert a.status_code in (200, 201), a.text
    r = client.post("/api/invoices", headers=owner, json={"doc_type": "receipt", "client_id": c["id"], "payment_method": "cash",
                                                           "items": [{"description": "תור", "quantity": 1, "unit_price_cents": 30000}]})
    assert r.status_code == 200, r.text

    phone = db_session.execute(text("SELECT phone FROM clients WHERE id = :id"), {"id": c["id"]}).scalar()
    cid = str(uuid.uuid4())
    db_session.execute(text("INSERT INTO marketplace_customers (id, phone, first_name) VALUES (:id, :p, 'דנה')"), {"id": cid, "p": phone})
    db_session.commit()
    bf = {"Authorization": f"Bearer {_make_token(cid)}"}

    mine = client.get("/api/marketplace/auth/my-businesses", headers=bf)
    assert mine.status_code == 200, mine.text
    assert [b["studio_slug"] for b in mine.json()] == ["bf-page"]
    inv = client.get("/api/marketplace/auth/my-invoices", headers=bf, params={"studio_slug": "bf-page"})
    assert inv.status_code == 200, inv.text
    assert len(inv.json()) == 1
    ph = client.get("/api/marketplace/auth/my-photos", headers=bf, params={"studio_slug": "bf-page"})
    assert ph.status_code == 200, ph.text
