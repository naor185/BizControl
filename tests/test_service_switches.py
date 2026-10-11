"""The owner's on/off for each service (owner, 2026-10-10): the aftercare & review message, the club's joining gift,
cashback, the birthday benefit, selling gift cards and the designed voucher. All start on — nothing changes until
the owner turns one off; off, it stops everywhere; the amounts are kept and come back. Local test database; the
senders are fakes — nothing is sent."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services import club
from app.services.service_switches import birthday_percent, join_gift_points
from tests.conftest import register_and_login

SWITCHES = ("aftercare_enabled", "club_join_gift_enabled", "cashback_enabled", "gift_card_sales_enabled",
            "gift_voucher_design_enabled", "birthday_automation_enabled")


def _pro(client, db, slug):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.subscription_plan = "pro"
    settings = db.get(StudioSettings, s.id)
    settings.aftercare_message = "שמרו על האזור נקי"
    db.commit()
    return h, s


def _done(client, db, h, s, phone):
    owner = db.scalar(select(User).where(User.studio_id == s.id, User.role == "owner"))
    c = Client(studio_id=s.id, full_name="דנה", phone=phone)
    db.add(c)
    db.flush()
    now = datetime.now(timezone.utc)
    appt = Appointment(studio_id=s.id, client_id=c.id, artist_id=owner.id, title="טיפול",
                       starts_at=now - timedelta(hours=2), ends_at=now - timedelta(hours=1))
    db.add(appt)
    db.commit()
    assert client.post(f"/api/appointments/{appt.id}/mark-done", headers=h).status_code == 200
    return db.scalar(select(MessageJob).where(MessageJob.appointment_id == appt.id, MessageJob.reminder_type == "post_payment"))


def test_every_service_starts_on_and_works_as_before(client, db_session):
    h, s = _pro(client, db_session, "on-shop")
    settings = client.get("/api/studio/automation", headers=h).json()
    assert all(settings[k] is True for k in SWITCHES) and settings["birthday_benefit_percent"] == 10
    member = Client(studio_id=s.id, full_name="יעל", phone="0501112233", is_club_member=True)
    db_session.add(member)
    db_session.commit()
    assert club.cashback_percent(db_session, s.id, member) == 5
    assert join_gift_points(db_session, s.id) == 50
    assert client.get(f"/api/public/gift-cards/shop/{s.id}").status_code == 200
    assert _done(client, db_session, h, s, "0501230000") is not None                    # the message after the appointment


def test_off_stops_the_service_everywhere_and_on_brings_it_back(client, db_session):
    h, s = _pro(client, db_session, "off-shop")
    off = {k: False for k in SWITCHES}
    assert client.patch("/api/studio/automation", headers=h, json=off).status_code == 200
    member = Client(studio_id=s.id, full_name="יעל", phone="0501112233", is_club_member=True,
                    birth_date=date(1990, date.today().month, 1))
    db_session.add(member)
    db_session.commit()

    assert _done(client, db_session, h, s, "0501230001") is None                         # no aftercare / review
    assert club.cashback_percent(db_session, s.id, member) == 0                           # no cashback
    r = client.post(f"/api/public/studio/{s.id}/join", json={"full_name": "רון", "phone": "0509998877"})
    assert r.status_code == 200, r.text
    assert db_session.scalar(select(Client).where(Client.phone == "0509998877")).loyalty_points == 0   # no joining gift
    assert client.get("/api/public/landing/off-shop").json()["points_on_signup"] == 0
    today = date.today()
    sent = client.post(f"/api/customer-club/send-birthday-coupon/{member.id}?month={today.month}&year={today.year}", headers=h)
    assert sent.status_code == 400 and sent.json()["detail"] == "הטבת יום ההולדת כבויה בהגדרות העסק"
    sell = client.post("/api/gift-cards", headers=h, json={"amount_cents": 20000, "recipient_name": "דנה"})
    assert sell.status_code == 400 and "כבויה" in sell.json()["detail"]                    # not from the business either
    assert client.get(f"/api/public/gift-cards/shop/{s.id}").status_code == 404           # nor online

    # the amounts were kept; turned on, they come back
    db_session.expire_all()
    kept = db_session.get(StudioSettings, s.id)
    assert (kept.points_on_signup, kept.points_percent_per_payment, birthday_percent(kept)) == (50, 5, 10)
    assert client.patch("/api/studio/automation", headers=h, json={k: True for k in SWITCHES}).status_code == 200
    db_session.expire_all()
    assert club.cashback_percent(db_session, s.id, member) == 5 and join_gift_points(db_session, s.id) == 50
    assert client.get(f"/api/public/gift-cards/shop/{s.id}").status_code == 200


def test_a_birthday_percent_is_what_the_owner_set_and_a_cleared_field_isnt_saved(client, db_session):
    h, s = _pro(client, db_session, "bday-shop")
    assert client.patch("/api/studio/automation", headers=h, json={"birthday_benefit_percent": 15}).json()["birthday_benefit_percent"] == 15
    assert client.patch("/api/studio/automation", headers=h, json={"birthday_benefit_percent": 0}).json()["birthday_benefit_percent"] == 15
    db_session.expire_all()
    assert birthday_percent(db_session.get(StudioSettings, s.id)) == 15                  # not turned into 10 any more


def test_the_voucher_picture_only_while_its_design_is_on(client, db_session, monkeypatch):
    import app.api.gift_card_routes as gc
    drawn = []
    monkeypatch.setattr(gc, "_build_gift_card_voucher_png", lambda **k: drawn.append(1) or b"png")
    monkeypatch.setattr(gc, "_save_voucher_image", lambda png, sid, db=None: "https://cdn.example/voucher.png")
    h, s = _pro(client, db_session, "voucher-shop")

    def sell_and_approve(phone):
        order = client.post(f"/api/public/gift-cards/order/{s.id}", json={
            "amount_cents": 20000, "recipient_name": "דנה", "buyer_name": "רון", "buyer_phone": phone})
        assert order.status_code == 201, order.text
        from sqlalchemy import text
        card_id = db_session.execute(text("SELECT id FROM gift_cards WHERE buyer_phone = :p"), {"p": phone}).scalar()
        assert client.post(f"/api/gift-cards/{card_id}/approve-payment", headers=h, json={}).status_code == 200
        return db_session.scalar(select(MessageJob).where(MessageJob.to_phone == phone, MessageJob.reminder_type == "gift_card_voucher"))

    with_picture = sell_and_approve("0501110001")
    assert drawn == [1] and with_picture.media_url == "https://cdn.example/voucher.png"
    client.patch("/api/studio/automation", headers=h, json={"gift_voucher_design_enabled": False})
    plain = sell_and_approve("0501110002")
    assert drawn == [1] and plain is not None and plain.media_url is None             # the code and link, no picture
