"""ויקי's suggestions (the owner, 2026-10-16) — worked out from the system's own numbers, each with its button; "עשיתי"
/ "לא רלוונטי" hides one for that user; her moments are what just happened. The owner's and a manager's allowed the
money — not a worker's. Local test database; nothing is sent."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.lead import Lead
from app.models.studio import Studio
from app.services import viki
from tests.conftest import register_and_login


def _business(client, db, slug):
    h = register_and_login(client, slug, f"owner@{slug}.com")
    studio = db.scalar(select(Studio).where(Studio.slug == slug))
    me = client.get("/api/auth/me", headers=h).json()
    return h, studio, me["id"]


def _two_days_left(now) -> bool:
    """At least two working days (Sunday–Friday, a new business's) left this week from tomorrow."""
    today = now.astimezone(viki.IL).date()
    sunday = today - timedelta(days=(today.weekday() + 1) % 7)
    tomorrow = today + timedelta(days=1)
    return sum(1 for i in range((sunday + timedelta(days=7) - tomorrow).days)
               if ((tomorrow + timedelta(days=i)).weekday() + 1) % 7 in (0, 1, 2, 3, 4, 5)) >= 2


def _keys(client, h):
    r = client.get("/api/viki", headers=h)
    assert r.status_code == 200, r.text
    return [s["key"].split(":")[0] for s in r.json()["suggestions"]], r.json()


def test_her_suggestions_come_from_the_numbers_and_an_answer_hides_one(client, db_session):
    h, studio, owner_id = _business(client, db_session, "viki-shop")
    now = datetime.now(timezone.utc)
    db_session.add(Lead(studio_id=studio.id, name="רון כהן", status="new", created_at=now - timedelta(days=2)))
    for i in range(3):                                           # three clients who haven't come back for 3 months
        c = Client(studio_id=studio.id, full_name=f"לקוחה {i}", phone=f"05000000{i:02d}", marketing_consent=True)
        db_session.add(c)
        db_session.flush()
        db_session.add(Appointment(studio_id=studio.id, client_id=c.id, artist_id=owner_id, title="קעקוע", status="done",
                                   starts_at=now - timedelta(days=90), ends_at=now - timedelta(days=90) + timedelta(hours=1)))
    db_session.commit()
    viki.forget(studio.id)

    keys, body = _keys(client, h)
    # the rest of this week is empty too — said while at least two working days are left in it (2026-10-27)
    expected = ["leads", "lapsed"] + (["fill_this"] if _two_days_left(now) else []) + ["fill_next", "goal_none"]
    assert keys == expected[:3] and body["more"] == len(expected) - 3            # the most important first; the goal waits
    all_of_them = {s["key"].split(":")[0]: s for s in viki.suggestions(db_session, studio.id)}
    assert "goal_none" in all_of_them                                             # no goal set this month
    lapsed = next(s for s in body["suggestions"] if s["key"].startswith("lapsed:"))
    assert lapsed["text"].startswith("3 לקוחות לא הגיעו") and lapsed["action"]["href"] == "/broadcasts?audience=lapsed"

    # a message to exactly them
    sent = client.post("/api/broadcasts", headers=h, json={"title": "מתגעגעים", "body": "היי! מתגעגעים אליך", "audience": "lapsed",
                                                           "scheduled_at": (now + timedelta(days=1)).isoformat()})
    assert sent.status_code in (200, 201), sent.text

    # "עשיתי" — gone for this user; the next one comes up
    assert client.post("/api/viki/answer", headers=h, json={"key": lapsed["key"], "kind": "done"}).status_code == 204
    keys, _ = _keys(client, h)
    assert keys == [k for k in expected if k != "lapsed"][:3]


def test_the_waiting_leads_once_a_week_and_quiet_after_an_answer(client, db_session):
    """The owner, 2026-10-27: not every day — once a week; answered, the same leads don't come back."""
    h, studio, _ = _business(client, db_session, "viki-leads")
    now = datetime.now(timezone.utc)
    db_session.add(Lead(studio_id=studio.id, name="רון כהן", status="new", created_at=now - timedelta(days=2)))
    db_session.commit()

    def leads(at):
        return next((s for s in viki.suggestions(db_session, studio.id, now=at) if s["key"].startswith("leads:")), None)

    first = leads(now)
    assert first is not None and first["text"].startswith("ליד אחד מחכה")
    today = now.astimezone(viki.IL).date()
    assert first["key"] == f"leads:{(today - timedelta(days=(today.weekday() + 1) % 7)).isoformat()}"   # the week's, not the day's

    assert client.post("/api/viki/answer", headers=h, json={"key": first["key"], "kind": "not_relevant"}).status_code == 204
    viki.forget(studio.id)
    assert "leads" not in _keys(client, h)[0]                                    # gone now
    assert leads(now + timedelta(days=8)) is None                                 # and next week — the same lead stays quiet

    db_session.add(Lead(studio_id=studio.id, name="דנה לוי", status="new", created_at=now + timedelta(minutes=1)))
    db_session.commit()
    later = leads(now + timedelta(days=8))                                        # a lead that started waiting since
    assert later is not None and later["text"].startswith("ליד אחד מחכה") and later["key"] != first["key"]


def test_a_deleted_or_answered_lead_leaves_her_alert_at_once(client, db_session):
    """The owner, 2026-10-27: deleted the lead — the alert stayed (her suggestions are kept a few minutes)."""
    h, studio, _ = _business(client, db_session, "viki-del")
    now = datetime.now(timezone.utc)
    gone = Lead(studio_id=studio.id, name="רון כהן", status="new", created_at=now - timedelta(days=2))
    called = Lead(studio_id=studio.id, name="דנה לוי", status="new", created_at=now - timedelta(days=2))
    db_session.add_all([gone, called])
    db_session.commit()
    viki.forget(studio.id)
    leads = lambda: next((s for s in client.get("/api/viki", headers=h).json()["suggestions"] if s["key"].startswith("leads:")), None)
    assert leads()["text"].startswith("2 לידים מחכים")                          # now kept for a few minutes
    assert client.delete(f"/api/leads/{gone.id}", headers=h).status_code == 204
    assert leads()["text"].startswith("ליד אחד מחכה")                           # at once, not in 5 minutes
    assert client.patch(f"/api/leads/{called.id}", headers=h, json={"status": "contacted"}).status_code == 200
    assert leads() is None


def _paid(client, h, studio, owner_id, db, amount_cents, starts_at, phone):
    c = Client(studio_id=studio.id, full_name="לקוחה", phone=phone)
    db.add(c)
    db.flush()
    a = Appointment(studio_id=studio.id, client_id=c.id, artist_id=owner_id, title="קעקוע", status="scheduled",
                    starts_at=starts_at, ends_at=starts_at + timedelta(minutes=30))
    db.add(a)
    db.commit()
    if amount_cents:
        r = client.post("/api/payments", headers=h, json={"appointment_id": str(a.id), "client_id": str(c.id),
                                                          "amount_cents": amount_cents, "type": "deposit", "method": "cash",
                                                          "send_receipt": False})
        assert r.status_code == 201, r.text
    return a


def test_the_week_we_are_in_what_was_done_what_is_ahead_and_the_step_to_the_goal(client, db_session):
    """The owner, 2026-10-27: focus on what was done and what will be done this week, a bit of next week, and the
    goal reached gradually."""
    from decimal import Decimal
    from app.repositories.goal_repository import GoalRepository
    from app.services import viki_summary
    h, studio, owner_id = _business(client, db_session, "viki-week")
    now = datetime.now(timezone.utc)
    today = now.astimezone(viki.IL).date()
    sunday = viki.IL.localize(datetime.combine(today - timedelta(days=(today.weekday() + 1) % 7), datetime.min.time()))
    assert viki_summary.this_week(db_session, studio.id) is None                 # nothing in the week yet

    _paid(client, h, studio, owner_id, db_session, 50000, max(now - timedelta(hours=1), sunday + timedelta(minutes=1)), "0500000101")
    later = _paid(client, h, studio, owner_id, db_session, 0, now + timedelta(minutes=5), "0500000102")
    later.ends_at = later.starts_at + timedelta(hours=2)
    db_session.commit()
    GoalRepository(db_session).set_goal(studio.id, today.year, today.month, Decimal("100000"))

    week = viki_summary.this_week(db_session, studio.id)
    assert week["title"].startswith("השבוע הזה")
    lines = {x["kind"]: x["text"] for x in week["lines"]}
    assert lines["done"].startswith("עד עכשיו השבוע: ₪500 הכנסות מתור אחד")
    assert lines["ahead"].startswith("עוד השבוע: תור אחד — 2 שעות")
    if GoalRepository(db_session).get_progress(studio.id, today.year, today.month)["days_remaining"]:
        assert lines["goal"].startswith("לקראת יעד החודש (₪100,000): נשארו ₪99,500")
    assert ("next" in lines) == ((today.weekday() + 1) % 7 < 4)                  # Sunday–Wednesday; then "השבועות הבאים"
    en = viki_summary.this_week(db_session, studio.id, lang="en")
    assert en["title"].startswith("This week") and en["lines"][0]["text"].startswith("So far this week: ₪500 came in")


def test_half_the_goal_and_three_quarters_a_good_word_and_the_way_there(client, db_session):
    from decimal import Decimal
    from app.repositories.goal_repository import GoalRepository
    h, studio, owner_id = _business(client, db_session, "viki-half")
    now = datetime.now(timezone.utc)
    today = now.astimezone(viki.IL).date()
    GoalRepository(db_session).set_goal(studio.id, today.year, today.month, Decimal("1000"))
    _paid(client, h, studio, owner_id, db_session, 60000, now - timedelta(minutes=5), "0500000103")

    def milestone():
        found = [s for s in viki.suggestions(db_session, studio.id) if s["key"].startswith("goal_5") or s["key"].startswith("goal_7")]
        return found[0] if found else None

    half = milestone()
    assert half["key"].startswith("goal_50:") and half["tone"] == "good"
    assert half["text"].startswith("כל הכבוד — עברת חצי מהיעד! ₪600 מתוך ₪1,000 (60%).")
    assert "goal_pace" not in [s["key"].split(":")[0] for s in viki.suggestions(db_session, studio.id)]   # said once
    _paid(client, h, studio, owner_id, db_session, 20000, now - timedelta(minutes=4), "0500000104")
    assert milestone()["text"].startswith("כל הכבוד — כבר שלושה רבעים מהיעד! ₪800 מתוך ₪1,000 (80%).")


def test_her_moments_and_who_she_talks_to(client, db_session):
    h, studio, owner_id = _business(client, db_session, "viki-moments")
    since = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert client.post("/api/leads", headers=h, json={"name": "דנה לוי", "service_interest": "קעקוע קטן"}).status_code == 201
    c = Client(studio_id=studio.id, full_name="שי גבריאלי", phone="0524448808")
    db_session.add(c)
    db_session.flush()
    start = datetime.now(timezone.utc) + timedelta(days=3)
    db_session.add(Appointment(studio_id=studio.id, client_id=c.id, artist_id=owner_id, title="קעקוע", status="scheduled",
                               starts_at=start, ends_at=start + timedelta(hours=2), deposit_amount_cents=20000,
                               payment_sent_at=datetime.now(timezone.utc)))
    db_session.commit()

    r = client.get("/api/viki/moments", headers=h, params={"since": since.isoformat()})
    texts = [m["text"] for m in r.json()["moments"]]
    assert texts == ["נכנס ליד חדש: דנה לוי — קעקוע קטן. ליד שעונים לו מהר — נסגר הרבה יותר!",
                     "שי גבריאלי דיווח ששילם מקדמה של ₪200. לאשר?"]
    later = client.get("/api/viki/moments", headers=h, params={"since": r.json()["now"]}).json()
    assert later["moments"] == []                                                  # nothing new since

    w = client.post("/api/users/artists", headers=h, json={"email": "w@viki-moments.com", "password": "secret123",
                                                             "display_name": "עובד", "role": "artist"})
    assert w.status_code == 201
    t = client.post("/api/auth/login-by-email", json={"email": "w@viki-moments.com", "password": "secret123"}).json()["access_token"]
    assert client.get("/api/viki", headers={"Authorization": f"Bearer {t}"}).status_code == 403
