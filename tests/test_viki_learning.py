"""ויקי, stage 3 (the owner, 2026-10-19): what came of what was done — a message to the clients, and how many of them
booked after it (and for how much): on the broadcasts page, on her card, and in her next suggestion of that kind; a
kind marked "לא רלוונטי" again and again comes up far less. Local test database; nothing is sent."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.broadcast import Broadcast
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.studio import Studio
from app.models.viki_dismissal import VikiDismissal
from app.services import viki, viki_learning
from tests.conftest import register_and_login


def _client(db, studio_id, i, owner_id, now, lapsed=True):
    c = Client(studio_id=studio_id, full_name=f"לקוחה {i}", phone=f"05200000{i:02d}", marketing_consent=True)
    db.add(c)
    db.flush()
    if lapsed:                                                   # came three months ago, nothing since
        db.add(Appointment(studio_id=studio_id, client_id=c.id, artist_id=owner_id, title="קעקוע", status="done",
                           starts_at=now - timedelta(days=90), ends_at=now - timedelta(days=90) + timedelta(hours=1)))
    return c


def _job(studio_id, c, now, key=None, at=None):
    return MessageJob(studio_id=studio_id, client_id=c.id, channel="whatsapp", to_phone=c.phone, body="מתגעגעים",
                      scheduled_at=now, status="sent", reminder_type="broadcast", dedup_key=key, **({"created_at": at} if at else {}))


def test_a_message_and_who_booked_after_it(client, db_session):
    h = register_and_login(client, "viki-learn", "owner@viki-learn.com")
    studio = db_session.scalar(select(Studio).where(Studio.slug == "viki-learn"))
    owner_id = uuid.UUID(client.get("/api/auth/me", headers=h).json()["id"])
    now = datetime.now(timezone.utc)
    got = [_client(db_session, studio.id, i, owner_id, now) for i in range(3)]
    for i in range(3, 6):
        _client(db_session, studio.id, i, owner_id, now)          # still lapsed — the suggestion stays true
    b = Broadcast(studio_id=studio.id, title="מתגעגעים", body="מתגעגעים", audience="lapsed", status="sent", sent_count=3,
                  scheduled_at=now - timedelta(days=3))
    db_session.add(b)
    db_session.flush()
    for c in got:
        db_session.add(_job(studio.id, c, now, key=f"bc:{b.id}:{c.id}"))
    for c, price in ((got[0], 50000), (got[1], 30000)):           # two of them booked after it
        start = now + timedelta(days=5)
        db_session.add(Appointment(studio_id=studio.id, client_id=c.id, artist_id=owner_id, title="קעקוע", status="scheduled",
                                   starts_at=start, ends_at=start + timedelta(hours=1), total_price_cents=price))
    db_session.commit()

    r = viki_learning.result(db_session, b, now)
    assert (r["recipients"], r["booked"], r["appointments"], r["revenue"]) == (3, 2, 2, 800.0)

    viki.forget(studio.id)
    found = {s["key"].split(":")[0]: s for s in viki.suggestions(db_session, studio.id)}
    assert "2 מהם כבר קבעו תור" in found["bc_good"]["text"] and "₪800" in found["bc_good"]["text"]
    assert "בפעם הקודמת" in found["lapsed"]["text"] and "2 לקוחות קבעו תור" in found["lapsed"]["text"]

    listed = next(x for x in client.get("/api/broadcasts", headers=h).json() if x["id"] == str(b.id))
    assert listed["result"]["booked"] == 2

    # an older message (before its messages carried who they were for) — those queued in the minutes it was sent
    old = Broadcast(studio_id=studio.id, title="ישן", body="ישן", audience="all", status="sent", sent_count=1,
                    scheduled_at=now - timedelta(days=20))
    db_session.add(old)
    db_session.flush()
    db_session.add(_job(studio.id, got[2], now, at=old.scheduled_at + timedelta(seconds=40)))
    db_session.commit()
    assert viki_learning.result(db_session, old, now)["recipients"] == 1


def test_a_kind_marked_not_relevant_again_and_again_comes_up_less(client, db_session):
    h = register_and_login(client, "viki-quiet", "owner@viki-quiet.com")
    studio = db_session.scalar(select(Studio).where(Studio.slug == "viki-quiet"))
    owner_id = uuid.UUID(client.get("/api/auth/me", headers=h).json()["id"])
    order = lambda: [s["key"].split(":")[0] for s in viki.suggestions(db_session, studio.id)]
    viki.forget(studio.id)
    before = order()
    assert before.index("fill_next") < before.index("goal_none")
    for key in ("fill_next:2026-08-02", "fill_next:2026-09-06"):
        db_session.add(VikiDismissal(studio_id=studio.id, user_id=owner_id, key=key, kind="not_relevant"))
    db_session.commit()
    assert "fill_next" in viki_learning.quiet_kinds(db_session, studio.id)
    after = order()
    assert after.index("fill_next") > after.index("goal_none")
