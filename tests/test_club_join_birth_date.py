"""The birth date a client fills in on joining the club (the owner, 2026-11-04): a client already on file who joined
through the link lost it — the server kept it only for a new client — so the birthday benefit never reached them.
Now it is kept when the card has none, and a date already on the card is never replaced. Local test database; the
senders are fakes — nothing is sent."""
from datetime import date, datetime, timezone

from sqlalchemy import select

from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.crud.birthday_coupon import birthday_message_key
from tests.conftest import register_and_login


def _pro(client, db, slug):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    s.subscription_plan = "pro"
    db.commit()
    return h, s


def test_a_client_on_file_who_joins_through_the_link_keeps_the_birth_date(client, db_session):
    h, s = _pro(client, db_session, "bd-link")
    known = Client(studio_id=s.id, full_name="דנה", phone="0501112233")
    db_session.add(known)
    db_session.commit()
    now = datetime.now(timezone.utc)
    born = date(1995, now.month, 1)

    r = client.post(f"/api/public/studio/{s.id}/join",
                    json={"full_name": "דנה", "phone": "0501112233", "birth_date": born.isoformat()})
    assert r.status_code == 200
    db_session.refresh(known)
    assert known.birth_date == born and known.is_club_member
    # a birthday this month: the coupon goes out with the joining, as for a new client
    assert db_session.scalar(select(MessageJob).where(
        MessageJob.client_id == known.id, MessageJob.reminder_type == birthday_message_key(now.year, now.month)))


def test_a_birth_date_already_on_the_card_is_never_replaced(client, db_session):
    h, s = _pro(client, db_session, "bd-keep")
    known = Client(studio_id=s.id, full_name="רון", phone="0502223344", birth_date=date(1980, 5, 5))
    db_session.add(known)
    db_session.commit()

    r = client.post(f"/api/public/studio/{s.id}/join",
                    json={"full_name": "רון", "phone": "0502223344", "birth_date": "1999-01-02"})
    assert r.status_code == 200
    db_session.refresh(known)
    assert known.birth_date == date(1980, 5, 5)


def test_the_owner_adding_a_client_on_file_to_the_club_keeps_the_birth_date(client, db_session):
    h, s = _pro(client, db_session, "bd-owner")
    known = Client(studio_id=s.id, full_name="יעל", phone="0503334455")
    db_session.add(known)
    db_session.commit()

    r = client.post("/api/clients", headers=h,
                    json={"full_name": "יעל", "phone": "0503334455", "birth_date": "1992-03-04", "is_club_member": True})
    assert r.status_code in (200, 201)
    db_session.refresh(known)
    assert known.birth_date == date(1992, 3, 4) and known.is_club_member
