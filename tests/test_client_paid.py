"""What a client paid is one sum (crud.payment.clients_paid) — the client card, the club leaderboard and the average per
client all show it. Paying with club points is recorded as a payment but is not money: the leaderboard used to add it
(and not take refunds off), so a client who paid ₪15,000 showed ₪15,715 there. Local test database; nothing is sent."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.payment import Payment
from app.models.pos_transaction import PosTransaction
from app.models.studio import Studio
from app.models.user import User
from tests.conftest import register_and_login


def test_the_card_the_leaderboard_and_the_average_agree(client, db_session):
    h = register_and_login(client, slug="paidsum", email="owner@paidsum.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "paidsum"))
    owner = db_session.scalar(select(User).where(User.studio_id == s.id))
    c = Client(studio_id=s.id, full_name="אוריאל", phone="0501111111", is_club_member=True)
    db_session.add(c)
    db_session.flush()
    appt = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="קעקוע",
                       starts_at=datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc), ends_at=datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc))
    db_session.add(appt)
    db_session.flush()
    pay = dict(studio_id=s.id, client_id=c.id, appointment_id=appt.id, currency="ILS", status="paid")
    db_session.add_all([
        Payment(**pay, amount_cents=1_500_000, type="payment", method="cash"),
        Payment(**pay, amount_cents=71_500, type="payment", method="other",
                notes="[מערכת] הלקוח מימש 715 ש״ח באמצעות נקודות מועדון"),            # club points — not money
        Payment(**pay, amount_cents=20_000, type="refund", method="cash", notes="[זיכוי אוטומטי] עבור תשלום"),
        PosTransaction(studio_id=s.id, client_id=c.id, total_cents=5_000, method="cash", status="paid"),
    ])
    db_session.commit()

    card = client.get(f"/api/clients/{c.id}/profile", headers=h).json()
    assert (card["total_paid_cents"], card["total_refund_cents"], card["net_paid_cents"]) == (1_505_000, 20_000, 1_485_000)
    top = client.get("/api/clients/club/leaderboard", headers=h).json()["top_payers"]
    assert [(x["full_name"], x["total_paid_cents"]) for x in top] == [("אוריאל", 1_485_000)]
    assert client.get("/api/clients/analytics", headers=h).json()["kpis"]["ltv_ils"] == 14_850
