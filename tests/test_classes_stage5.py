"""Classes & memberships, stage 5 — freeze, stop, cancel, the change log and the membership notices.
The plan's end-of-stage check: freeze a membership with a return date, see the bookings it cancelled,
and the messages sent. Only the moves in the plan's state diagram are allowed. Frozen clock; local test
database; nothing is sent."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.classes import ClassBooking, ClassSession
from app.models.client import Client
from app.models.memberships import Membership
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.notification import Notification
from app.models.studio import Studio
from app.models.user import User
from app.services import classes as svc
from app.services import membership_changes as changes
from app.services import memberships as ms
from tests.conftest import register_and_login

NOW = datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)          # Thursday 1 Oct, 10:00 in Israel


@pytest.fixture()
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(svc, "now_utc", lambda: state["now"])
    return state


def _business(client, db, **type_extra):
    h = register_and_login(client, slug="pilates", email="owner@pilates.com")
    s = db.scalar(select(Studio).where(Studio.slug == "pilates"))
    s.name = "פילאטיס בלב"
    for m in ("classes", "memberships"):
        db.add(StudioModule(studio_id=s.id, module_id=m, is_enabled=True))
    db.commit()
    t = client.post("/api/classes/templates", headers=h, json={
        "name": "פילאטיס מכשירים", "weekdays": [0, 2], "start_time": "18:00", "duration_minutes": 55,
        "starts_on": "2026-10-01", "capacity": 10}).json()
    kind = client.post("/api/classes/membership-types", headers=h, json={
        "name": "כרטיסייה 10", "kind": "punch", "entries": 10, "duration_days": 90, **type_extra}).json()
    c = Client(studio_id=s.id, full_name="יעל כהן", phone="0501111111", email="yael@x.com")
    db.add(c)
    db.commit()
    card = client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": kind["id"]}).json()
    return h, s, t, c, card


def _sessions(db, template_id):
    db.expire_all()
    return db.scalars(select(ClassSession).where(ClassSession.template_id == template_id).order_by(ClassSession.starts_at)).all()


def _book(client, h, session, c):
    return client.post(f"/api/classes/sessions/{session.id}/bookings", headers=h, json={"client_id": str(c.id)})


def _detail(client, h, card):
    return client.get(f"/api/classes/memberships/{card['id']}", headers=h).json()


def _messages(db, kind):
    db.expire_all()
    return [j.body for j in db.scalars(select(MessageJob).where(MessageJob.reminder_type == f"notify-{kind}",
                                                                MessageJob.channel == "whatsapp")).all()]


# ── freeze ───────────────────────────────────────────────────────────────────

def test_a_freeze_moves_the_end_cancels_the_bookings_inside_it_and_tells_the_client(client, db_session, clock):
    h, s, t, c, card = _business(client, db_session)
    sessions = _sessions(db_session, t["id"])                  # Sun 4, Tue 6, Sun 11, Tue 13, Sun 18, Tue 20 …
    for x in sessions[:4] + [sessions[5]]:
        _book(client, h, x, c)
    assert _detail(client, h, card)["balance"]["available"] == 5

    r = client.post(f"/api/classes/memberships/{card['id']}/freeze", headers=h,
                    json={"from_on": "2026-10-05", "until_on": "2026-10-19", "reason": "חופשה"}).json()
    assert (r["status"], r["freeze_from"], r["freeze_until"]) == ("active", "2026-10-05", "2026-10-19")   # starts on the 5th
    assert r["ends_on"] == "2027-01-12"                                     # 29/12 + 14 days
    assert r["balance"]["available"] == 8                                   # 6/10, 11/10, 13/10 cancelled — entries back
    db_session.expire_all()
    kept = {b.session_id: b.status for b in db_session.scalars(select(ClassBooking).where(ClassBooking.client_id == c.id))}
    assert [kept[x.id] for x in (sessions[0], sessions[1], sessions[2], sessions[3], sessions[5])] == \
        ["booked", "canceled", "canceled", "canceled", "booked"]
    msg = _messages(db_session, "membership_frozen")
    assert len(msg) == 1 and "מוקפא מ-5/10 ויחזור לפעילות ב-19/10" in msg[0] and "3 הרשמות בתקופה הזו בוטלו והכניסות חזרו" in msg[0]
    assert _book(client, h, sessions[2], c).json()["detail"].startswith("המנוי מוקפא ביום השיעור")
    assert [e["action"] for e in r["events"]] == ["sold", "freeze"] and r["events"][1]["reason"] == "חופשה"

    clock["now"] = datetime(2026, 10, 5, 1, 0, tzinfo=timezone.utc)
    ms.refresh_statuses(db_session)
    assert db_session.get(Membership, card["id"]).status == "frozen"
    clock["now"] = datetime(2026, 10, 18, 7, 0, tzinfo=timezone.utc)
    changes.sweep_notices(db_session)
    changes.sweep_notices(db_session)
    assert [m for m in _messages(db_session, "membership_frozen") if "חוזר לפעילות מחר, 19/10" in m] != []
    assert len([m for m in _messages(db_session, "membership_frozen") if "מחר" in m]) == 1
    clock["now"] = datetime(2026, 10, 19, 1, 0, tzinfo=timezone.utc)
    ms.refresh_statuses(db_session)
    assert db_session.get(Membership, card["id"]).status == "active"
    assert [e["action"] for e in _detail(client, h, card)["events"]] == ["sold", "freeze", "freeze_start", "unfreeze"]


def test_the_types_freeze_rules_and_an_early_return(client, db_session, clock):
    h, s, t, c, card = _business(client, db_session, freeze_min_days=7, freeze_max_days=20, freeze_max_count=2, freeze_fee_cents=5000)
    freeze = lambda a, b: client.post(f"/api/classes/memberships/{card['id']}/freeze", headers=h, json={"from_on": a, "until_on": b})
    assert freeze("2026-10-01", "2026-10-04").json()["detail"] == "הקפאה קצרה מדי — לפחות 7 ימים"
    first = freeze("2026-10-01", "2026-10-15").json()
    assert first["status"] == "frozen" and first["events"][-1]["fee_cents"] == 5000
    assert freeze("2026-10-20", "2026-10-30").json()["detail"] == "אפשר להקפיא רק מנוי פעיל"     # frozen now

    clock["now"] = datetime(2026, 10, 5, 7, 0, tzinfo=timezone.utc)       # back after 4 days
    back = client.post(f"/api/classes/memberships/{card['id']}/unfreeze", headers=h).json()
    assert (back["status"], back["ends_on"], back["freeze"]["used_days"]) == ("active", "2027-01-02", 4)
    assert freeze("2026-10-10", "2026-11-10").json()["detail"] == "נשארו 16 ימי הקפאה במנוי הזה"
    assert freeze("2026-10-10", "2026-10-24").status_code == 200
    assert freeze("2026-11-01", "2026-11-08").json()["detail"] == "למנוי כבר יש הקפאה — קודם מחזירים אותו ממנה"   # one coming
    client.post(f"/api/classes/memberships/{card['id']}/unfreeze", headers=h)  # the coming freeze called off
    assert freeze("2026-11-01", "2026-11-08").json()["detail"] == "כבר נוצלו 2 הקפאות — המקסימום בסוג המנוי הזה"

    h2 = client.post("/api/classes/membership-types", headers=h, json={"name": "בלי הקפאה", "kind": "unlimited",
                                                                       "duration_days": 30, "freeze_allowed": False}).json()
    other = client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": h2["id"]}).json()
    no = client.post(f"/api/classes/memberships/{other['id']}/freeze", headers=h, json={"from_on": "2026-10-10", "until_on": "2026-10-20"})
    assert no.json()["detail"] == "סוג המנוי הזה לא מאפשר הקפאה"


# ── stop, cancel, the diagram ────────────────────────────────────────────────

def test_stop_keeps_the_bookings_cancel_ends_them_and_only_the_diagrams_moves_are_allowed(client, db_session, clock):
    h, s, t, c, card = _business(client, db_session)
    sessions = _sessions(db_session, t["id"])
    for x in sessions[:2]:
        _book(client, h, x, c)
    stopped = client.post(f"/api/classes/memberships/{card['id']}/stop", headers=h, json={"reason": "עוברת עיר"}).json()
    assert stopped["status"] == "ending" and stopped["coming_bookings"] == 2
    assert "המנוי שלך נעצר מתאריך 29/12" in _messages(db_session, "membership_ended")[0]
    assert client.post(f"/api/classes/memberships/{card['id']}/freeze", headers=h,
                       json={"from_on": "2026-10-05", "until_on": "2026-10-19"}).json()["detail"] == "אפשר להקפיא רק מנוי פעיל"
    assert client.post(f"/api/classes/memberships/{card['id']}/unstop", headers=h).json()["status"] == "active"
    assert client.post(f"/api/classes/memberships/{card['id']}/unstop", headers=h).json()["detail"] == "המנוי לא נעצר"

    gone = client.post(f"/api/classes/memberships/{card['id']}/cancel", headers=h, json={}).json()
    assert (gone["status"], gone["ends_on"], gone["coming_bookings"], gone["balance"]["available"]) == ("canceled", "2026-10-01", 0, 10)
    assert "המנוי שלך בוטל מתאריך 1/10" in _messages(db_session, "membership_ended")[-1]
    assert client.post(f"/api/classes/memberships/{card['id']}/stop", headers=h, json={}).json()["detail"] == "אפשר לעצור רק מנוי פעיל"
    assert [e["action"] for e in gone["events"]] == ["sold", "stop", "unstop", "cancel"]


def test_a_managers_change_rings_the_owners_bell_and_the_front_desk_cannot_change(client, db_session, clock):
    h, s, t, c, card = _business(client, db_session)
    me = db_session.scalar(select(User).where(User.studio_id == s.id))
    me.role, me.display_name = "admin", "נועה"
    db_session.commit()
    client.post(f"/api/classes/memberships/{card['id']}/stop", headers=h, json={})
    bells = db_session.scalars(select(Notification).where(Notification.studio_id == s.id)).all()
    assert [b.body for b in bells] == ["המנוי של יעל כהן נעצר על ידי נועה"]
    me.role = "staff"
    db_session.commit()
    assert client.post(f"/api/classes/memberships/{card['id']}/unstop", headers=h).status_code == 403


# ── notices ──────────────────────────────────────────────────────────────────

def test_ending_soon_and_two_entries_left_are_told_once_and_not_after_a_renewal(client, db_session, clock):
    h, s, t, c, card = _business(client, db_session)
    clock["now"] = datetime(2026, 12, 22, 7, 0, tzinfo=timezone.utc)       # ends 29/12: 7 days
    changes.sweep_notices(db_session)
    changes.sweep_notices(db_session)
    clock["now"] = datetime(2026, 12, 26, 7, 0, tzinfo=timezone.utc)       # 3 days
    changes.sweep_notices(db_session)
    notes = _messages(db_session, "membership_expiring")
    assert len(notes) == 2 and "בעוד 7 ימים (29/12)" in notes[0] and "בעוד 3 ימים (29/12)" in notes[1]

    client.post(f"/api/classes/memberships/{card['id']}/adjust", headers=h, json={"delta": -8, "reason": "בדיקה"})
    changes.sweep_notices(db_session)
    assert "נותרו לך 2 כניסות בכרטיסייה." in _messages(db_session, "membership_expiring")[-1]

    client.post(f"/api/classes/memberships/{card['id']}/renew", headers=h, json={})
    clock["now"] = datetime(2026, 12, 28, 7, 0, tzinfo=timezone.utc)
    before = len(_messages(db_session, "membership_expiring"))
    changes.sweep_notices(db_session)
    assert len(_messages(db_session, "membership_expiring")) == before     # a renewal is already sold
