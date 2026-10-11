"""A phone typed in is checked (owner, 2026-10-11): a client was saved with 05036140465 (11 digits) and every WhatsApp
to them failed. Refused with a plain message; a good number is kept in the storage format; a client already saved
with a bad number still opens and can be edited. Local test database; nothing is sent."""
from sqlalchemy import select

from app.models.client import Client
from app.models.studio import Studio
from app.utils.phone import INVALID_PHONE
from tests.conftest import register_and_login


def test_a_phone_is_checked_wherever_it_is_typed(client, db_session):
    h = register_and_login(client, slug="ph-shop", email="owner@ph-shop.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "ph-shop"))
    s.subscription_plan = "pro"
    db_session.commit()

    bad = client.post("/api/clients", headers=h, json={"full_name": "ליעד", "phone": "05036140465"})
    assert bad.status_code == 422 and INVALID_PHONE in str(bad.json())
    good = client.post("/api/clients", headers=h, json={"full_name": "ליעד", "phone": "050-361 4046"})
    assert good.status_code in (200, 201), good.text
    assert good.json()["phone"] == "0503614046"                                    # the storage format
    abroad = client.post("/api/clients", headers=h, json={"full_name": "Tom", "phone": "+1 415 555 0101"})
    assert abroad.json()["phone"] == "+14155550101"
    assert client.post("/api/clients", headers=h, json={"full_name": "בלי טלפון"}).status_code in (200, 201)

    # someone saved with a bad number before this: still opens, edits without touching the phone
    old = Client(studio_id=s.id, full_name="ישן", phone="05036140465")
    db_session.add(old)
    db_session.commit()
    assert client.get(f"/api/clients/{old.id}", headers=h).status_code == 200
    assert client.patch(f"/api/clients/{old.id}", headers=h, json={"notes": "לבדוק מספר"}).status_code == 200
    assert client.patch(f"/api/clients/{old.id}", headers=h, json={"phone": "05036140465"}).status_code == 422
    assert client.patch(f"/api/clients/{old.id}", headers=h, json={"phone": "0503614046"}).json()["phone"] == "0503614046"

    # the public forms and the business's other ones
    assert client.post(f"/api/public/studio/{s.id}/join", json={"full_name": "רון", "phone": "123"}).status_code == 422
    assert client.post(f"/api/public/gift-cards/order/{s.id}", json={
        "amount_cents": 20000, "recipient_name": "דנה", "buyer_name": "רון", "buyer_phone": "0501"}).status_code == 422
    assert client.post("/api/leads", headers=h, json={"name": "ליד", "phone": "99999"}).status_code == 422
