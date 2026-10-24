"""The till: who did the work or made the sale (the owner, 2026-10-24: "in the till I want to choose who sold, who did
the tattoo"). Chosen at checkout — one of the business's own team, the one at the till by default — shown with the sale
and counted in the team's sales on the dashboard. Local test database; nothing is sent."""
from sqlalchemy import select

from app.models.pos_transaction import PosTransaction
from app.models.studio import Studio
from tests.conftest import register_and_login

ITEM = {"description": "קעקוע", "quantity": 1, "unit_price_cents": 50000}


def _sale(client, h, **extra):
    return client.post("/api/pos/checkout", headers=h, json={"items": [ITEM], "method": "cash", "send_receipt": False, **extra})


def test_the_till_records_who_did_it(client, db_session):
    owner = register_and_login(client, "perf-shop", "owner@perf-shop.com")
    me = client.get("/api/auth/me", headers=owner).json()
    r = client.post("/api/users/artists", headers=owner, json={"email": "dana@perf-shop.com", "password": "secret123",
                                                              "role": "artist", "display_name": "דנה"})
    assert r.status_code == 201, r.text
    dana = r.json()["id"]
    other = register_and_login(client, "perf-other", "owner@perf-other.com")
    stranger = client.get("/api/auth/me", headers=other).json()["id"]

    first = _sale(client, owner)                                           # nothing chosen — no seller (an appointment's work)
    assert first.status_code == 200, first.text
    assert first.json()["performer_name"] is None and me["id"]
    second = _sale(client, owner, performer_id=dana)
    assert second.status_code == 200 and second.json()["performer_name"] == "דנה"
    assert _sale(client, owner, performer_id=stranger).status_code == 400   # another business's — never
    assert _sale(client, owner, performer_id="not-an-id").status_code == 400

    s = db_session.scalar(select(Studio).where(Studio.slug == "perf-shop"))
    txn = db_session.get(PosTransaction, second.json()["id"])
    assert str(txn.performer_id) == dana and txn.studio_id == s.id
    history = client.get("/api/pos/history?days=30", headers=owner).json()
    assert "דנה" in {t.get("performer_name") for t in history}
    team = {a["name"]: a["revenue"] for a in client.get("/api/dashboard/analytics", headers=owner).json().get("artists", [])}
    assert team.get("דנה") == 500                                          # her sale counts in her sales
