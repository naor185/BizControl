"""Classes & memberships, stage 1 — the infrastructure the later stages stand on. The plan's end-of-stage
checks: a test message is sent once; an event from a migration sends nothing; changing a setting on the
settings page changes behaviour without a code change. Local test database; nothing is sent."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.permissions import CLASS_ACTIONS, may
from app.events.event_bus import EventBus
from app.models.client import Client
from app.models.message_job import MessageJob
from app.models.module import StudioModule
from app.models.notification import Notification
from app.models.studio import Studio
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services import notifications, policies
from app.services.marketing import is_marketing
from tests.conftest import register_and_login


def _studio(db, slug="cls", business_type="pilates"):
    s = Studio(name="פילאטיס בלב", slug=slug, business_type=business_type)
    db.add(s)
    db.flush()
    db.add(StudioSettings(studio_id=s.id))
    db.commit()
    return s


def _client(db, studio, n=1):
    c = Client(studio_id=studio.id, full_name=f"מתאמנת {n}", phone=f"05000000{n:02d}", email=f"c{n}@x.com")
    db.add(c)
    db.commit()
    return c


def _jobs(db, studio):
    db.expire_all()
    return db.scalars(select(MessageJob).where(MessageJob.studio_id == studio.id)).all()


# ── the one decision point ───────────────────────────────────────────────────

def test_an_event_from_a_migration_sends_nothing(db_session):
    s = _studio(db_session)
    c = _client(db_session, s)
    ctx = {"class_name": "פילאטיס", "class_date": "1/10", "class_time": "18:00"}
    assert notifications.notify(db_session, s.id, "class_booked", origin="migration", about="b1",
                                context=ctx, clients=[c]) == 0
    assert _jobs(db_session, s) == []


def test_an_event_is_sent_once_per_client_and_channel(db_session):
    s = _studio(db_session)
    c = _client(db_session, s)
    ctx = {"class_name": "פילאטיס מכשירים", "class_date": "1/10", "class_time": "18:00"}
    assert notifications.notify(db_session, s.id, "class_booked", origin="user", about="b1", context=ctx, clients=[c]) == 2
    assert notifications.notify(db_session, s.id, "class_booked", origin="user", about="b1", context=ctx, clients=[c]) == 0
    db_session.commit()
    jobs = _jobs(db_session, s)
    assert sorted(j.channel for j in jobs) == ["email", "whatsapp"]
    wa = next(j for j in jobs if j.channel == "whatsapp")
    assert wa.body.startswith("היי מתאמנת 1, נרשמת לפילאטיס מכשירים ב-1/10 בשעה 18:00") and "{" not in wa.body
    assert wa.reminder_type == "notify-class_booked" and not is_marketing(wa.reminder_type)   # a service message


def test_the_database_itself_refuses_a_second_identical_message(db_session):
    s = _studio(db_session)
    now = datetime.now(timezone.utc)
    for _ in range(2):
        db_session.add(MessageJob(studio_id=s.id, channel="whatsapp", to_phone="0500000000", body="x",
                                  scheduled_at=now, status="pending", dedup_key="same"))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_the_owners_choices_decide_and_always_on_events_stay_on(client, db_session):
    h = register_and_login(client, slug="cls-api", email="owner@cls.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "cls-api"))
    assert client.get("/api/classes/notifications", headers=h).status_code == 403    # module off
    db_session.add(StudioModule(studio_id=s.id, module_id="classes", is_enabled=True))
    db_session.commit()

    r = client.patch("/api/classes/notifications/class_booked", headers=h, json={"channel": "whatsapp", "enabled": False})
    assert r.status_code == 200
    assert client.patch("/api/classes/notifications/class_changed", headers=h,
                        json={"channel": "whatsapp", "enabled": False}).status_code == 400
    c = _client(db_session, s)
    ctx = {"class_name": "יוגה", "class_date": "2/10", "class_time": "08:00", "change_note": "חדר 2"}
    assert notifications.notify(db_session, s.id, "class_booked", origin="user", about="b2", context=ctx, clients=[c]) == 1
    assert notifications.notify(db_session, s.id, "class_changed", origin="system", about="s2", context=ctx, clients=[c]) == 2
    db_session.commit()
    assert sorted((j.reminder_type, j.channel) for j in _jobs(db_session, s)) == [
        ("notify-class_booked", "email"), ("notify-class_changed", "email"), ("notify-class_changed", "whatsapp")]

    r = client.patch("/api/classes/notifications/class_reminder", headers=h,
                     json={"channel": "whatsapp", "body": "היי {client_name}! מחכים לך ב{class_name} 💪"})
    row = next(e for e in r.json() if e["event"] == "class_reminder")["channels"][0]
    assert row["body"].startswith("היי {client_name}! מחכים") and row["is_default_body"] is False
    bad = client.patch("/api/classes/notifications/class_reminder", headers=h,
                       json={"channel": "whatsapp", "body": "היי {client_nmae}"})
    assert bad.status_code == 400 and "{client_nmae}" in bad.json()["detail"]


def test_many_recipients_are_spaced_out_not_sent_at_once(db_session):
    s = _studio(db_session)
    clients = [_client(db_session, s, n) for n in range(1, 4)]
    notifications.notify(db_session, s.id, "class_auto_cancel", origin="system", about="s9",
                         context={"class_name": "HIIT", "class_date": "3/10", "class_time": "07:00", "entry_note": ""},
                         clients=clients)
    db_session.commit()
    times = sorted(j.scheduled_at for j in _jobs(db_session, s) if j.channel == "whatsapp")
    assert [(b - a).total_seconds() for a, b in zip(times, times[1:])] == [3.0, 3.0]


def test_staff_events_go_to_the_bell_once(db_session):
    s = _studio(db_session)
    ctx = {"client_name": "רון", "status_word": "הוקפא", "staff_name": "נועה"}
    for _ in range(2):
        notifications.notify(db_session, s.id, "membership_changed_by_staff", origin="user", about="m1", context=ctx)
    db_session.commit()
    bells = db_session.scalars(select(Notification).where(Notification.studio_id == s.id)).all()
    assert len(bells) == 1 and bells[0].body == "המנוי של רון הוקפא על ידי נועה"


def test_a_test_message_is_sent_once_per_wording(client, db_session):
    h = register_and_login(client, slug="cls-test", email="owner@clstest.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "cls-test"))
    db_session.add(StudioModule(studio_id=s.id, module_id="classes", is_enabled=True))
    user = db_session.scalar(select(User).where(User.email == "owner@clstest.com"))
    user.phone = "0527777777"
    db_session.commit()
    first = client.post("/api/classes/notifications/class_booked/test", headers=h, json={"channel": "whatsapp"})
    assert first.status_code == 200 and first.json() == {"sent_to": "0527777777"}
    again = client.post("/api/classes/notifications/class_booked/test", headers=h, json={"channel": "whatsapp"})
    assert again.status_code == 400 and "כבר נשלחה" in again.text
    client.patch("/api/classes/notifications/class_booked", headers=h, json={"channel": "whatsapp", "body": "נוסח חדש {client_name}"})
    assert client.post("/api/classes/notifications/class_booked/test", headers=h, json={"channel": "whatsapp"}).status_code == 200
    tests = [j for j in _jobs(db_session, s) if (j.dedup_key or "").startswith("test:")]
    assert len(tests) == 2 and all("{" not in j.body for j in tests)


# ── the owner's settings ─────────────────────────────────────────────────────

def test_changing_a_setting_changes_behaviour_without_code(client, db_session):
    h = register_and_login(client, slug="cls-set", email="owner@clsset.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "cls-set"))
    db_session.add(StudioModule(studio_id=s.id, module_id="classes", is_enabled=True))
    db_session.commit()
    starts = datetime(2026, 10, 5, 18, 0, tzinfo=timezone.utc)
    cancel = starts - timedelta(hours=8)
    assert policies.is_late_cancel(db_session, s.id, starts, cancel) is False          # default window: 6 hours

    r = client.patch("/api/classes/settings", headers=h, json={"values": {"free_cancel_hours": 12}})
    assert r.status_code == 200
    setting = next(x for x in r.json() if x["key"] == "free_cancel_hours")
    assert setting["value"] == 12 and setting["is_default"] is False
    db_session.expire_all()
    assert policies.is_late_cancel(db_session, s.id, starts, cancel) is True           # the owner's 12 hours

    assert client.patch("/api/classes/settings", headers=h, json={"values": {"free_cancel_hours": 500}}).status_code == 400
    assert client.patch("/api/classes/settings", headers=h, json={"values": {"waitlist_mode": "lottery"}}).status_code == 400
    back = client.patch("/api/classes/settings", headers=h, json={"values": {"free_cancel_hours": 6}}).json()
    assert next(x for x in back if x["key"] == "free_cancel_hours")["is_default"] is True


def test_the_most_specific_level_wins_and_a_class_template_beats_a_membership_type(db_session):
    s = _studio(db_session)
    template, membership = uuid.uuid4(), uuid.uuid4()
    assert policies.get_policy(db_session, s.id, "free_cancel_hours") == 6
    policies.set_policy(db_session, s.id, "free_cancel_hours", 8)
    policies.set_policy(db_session, s.id, "free_cancel_hours", 24, scope_type=policies.TEMPLATE, scope_id=template)
    db_session.commit()
    assert policies.get_policy(db_session, s.id, "free_cancel_hours") == 8
    assert policies.get_policy(db_session, s.id, "free_cancel_hours", template_id=template, membership_type_id=membership) == 24
    assert policies.get_policy(db_session, s.id, "free_cancel_hours", template_id=uuid.uuid4()) == 8
    with pytest.raises(ValueError):   # this setting has no membership-type level
        policies.set_policy(db_session, s.id, "free_cancel_hours", 3, scope_type=policies.MEMBERSHIP, scope_id=membership)
    with pytest.raises(ValueError):   # reminder time is a business-wide setting only
        policies.set_policy(db_session, s.id, "reminder_hours", 2, scope_type=policies.TEMPLATE, scope_id=template)


# ── permissions and events ───────────────────────────────────────────────────

def test_who_may_do_what(client, db_session):
    assert may("owner", "classes.configure") and may("superadmin", "limits.override")
    assert not may("staff", "classes.configure") and not may("artist", "memberships.sell")
    assert may("artist", "attendance.mark") and may("staff", "memberships.sell") and not may("staff", "memberships.change")
    assert not may("receptionist", "bookings.manage")          # not a role in this system
    assert set(CLASS_ACTIONS) == {"classes.configure", "sessions.change", "bookings.manage", "attendance.mark",
                                  "memberships.sell", "memberships.change", "limits.override", "reports.view"}
    h = register_and_login(client, slug="cls-perm", email="owner@clsperm.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "cls-perm"))
    db_session.add(StudioModule(studio_id=s.id, module_id="classes", is_enabled=True))
    db_session.scalar(select(User).where(User.email == "owner@clsperm.com")).role = "staff"
    db_session.commit()
    assert client.get("/api/classes/settings", headers=h).status_code == 200            # may look
    assert client.patch("/api/classes/settings", headers=h, json={"values": {"weeks_ahead": 4}}).status_code == 403


def test_every_event_carries_its_origin():
    seen = []
    EventBus.register("test.stage1", seen.append)
    try:
        EventBus.emit("test.stage1", {"x": 1})
        EventBus.emit("test.stage1", {"x": 2}, origin="migration")
        with pytest.raises(ValueError):
            EventBus.emit("test.stage1", {}, origin="somewhere")
    finally:
        EventBus.handlers.pop("test.stage1", None)
    assert seen == [{"x": 1, "origin": "user"}, {"x": 2, "origin": "migration"}]


def test_every_client_notification_has_a_text_per_channel_and_no_field_words():
    for ev in notifications.EVENTS.values():
        for ch in notifications.event_channels(ev):
            assert ev.texts.get(ch), (ev.key, ch)
            assert not any(w in ev.texts[ch] for w in ("קעקוע", "אמן", "סטודיו")), (ev.key, ch)
    assert len(notifications.EVENTS) == 17          # + class_swapped, freeze_request_declined (classes extras 2, 3)


def test_every_placeholder_has_a_label_and_labels_speak_the_fields_words(client, db_session):
    for ev in notifications.EVENTS.values():
        assert set(notifications.placeholders(ev)) <= set(notifications.PLACEHOLDERS), ev.key
    h = register_and_login(client, slug="cls-gym", email="owner@clsgym.com")
    s = db_session.scalar(select(Studio).where(Studio.slug == "cls-gym"))
    s.business_type = "gym"
    db_session.add(StudioModule(studio_id=s.id, module_id="classes", is_enabled=True))
    db_session.commit()
    staff = client.get("/api/studio/upload/terms", headers=h).json()["terms"]["staff"]      # the gym's word
    events = {e["event"]: e for e in client.get("/api/classes/notifications", headers=h).json()}
    ph = {p["key"]: p for p in events["class_booked"]["placeholders"]}
    assert ph["studio_name"]["sample"] == s.name and ph["staff_title"]["sample"] == staff
    assert "{staff}" in events["class_changed"]["label"]            # the page fills it with the business's word

    c = _client(db_session, s)
    notifications.notify(db_session, s.id, "class_changed", origin="user", about="s5", clients=[c],
                         context={"class_name": "HIIT", "class_date": "4/10", "class_time": "07:00", "change_note": "חדר 2"})
    db_session.commit()
    mail = next(j for j in _jobs(db_session, s) if j.channel == "email")
    assert "{staff}" not in mail.subject and staff in mail.subject
