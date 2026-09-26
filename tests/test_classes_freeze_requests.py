"""Classes extras 3 — a client asks on BizFind to freeze their membership. Checked at once against the same
rules as a freeze the staff make; then the owner's choice (freeze_requests): approve or reject by hand (the
default — the owner's bell rings, and it opens the memberships screen), approve by itself, or no requests.
Frozen clock; local test database; nothing is sent."""
from sqlalchemy import select

from app.models.memberships import Membership, MembershipEvent, MembershipRequest
from app.models.message_job import MessageJob
from app.models.notification import Notification
from tests import test_classes_bizfind as bf
from tests.test_classes_bizfind import clock  # noqa: F401

BASE = "/api/marketplace/classes/pilates"


def _setup(client, db, **rules):
    """A pilates business, a client with a 90-day membership whose type has the given freeze rules, and
    the client's BizFind login."""
    h, s, t, _ = bf._business(client, db)
    kind = client.post("/api/classes/membership-types", headers=h, json={
        "name": "חודשי", "kind": "unlimited", "duration_days": 90, **rules}).json()
    c = bf._client(db, s, "0501111111")
    m = client.post("/api/classes/memberships", headers=h, json={"client_id": str(c.id), "type_id": kind["id"]}).json()
    return h, s, c, m, bf._customer(db, "0501111111")


def _mine(client, me):
    return client.get(f"{BASE}/mine", headers=me).json()["memberships"][0]


def _ask(client, me, m, from_on, until_on, note=None):
    return client.post(f"{BASE}/memberships/{m['id']}/freeze-request", headers=me,
                       json={"from_on": from_on, "until_on": until_on, "note": note})


def _jobs(db, kind):
    db.expire_all()
    return db.scalars(select(MessageJob).where(MessageJob.reminder_type == f"notify-{kind}", MessageJob.channel == "whatsapp")).all()


def test_a_request_waits_for_the_owner_and_an_approval_freezes(client, db_session, clock):
    h, s, c, m, me = _setup(client, db_session, freeze_min_days=7, freeze_fee_cents=5000)
    shown = _mine(client, me)["freeze"]
    assert shown["can_ask"] and shown["min_days"] == 7 and shown["fee_cents"] == 5000 and shown["request"] is None

    r = _ask(client, me, m, "2026-10-10", "2026-10-20", "טיסה לחו״ל")
    assert r.status_code == 200 and r.json()["approved"] is False
    bell = db_session.scalar(select(Notification).where(Notification.type == "notify-freeze_requested"))
    assert bell is not None and bell.action_url == "/classes?tab=memberships"
    assert _ask(client, me, m, "2026-11-01", "2026-11-10").json()["detail"] == "כבר יש בקשת הקפאה שמחכה לתשובה"
    shown = _mine(client, me)["freeze"]
    assert shown["can_ask"] is False and shown["request"]["from_on"] == "2026-10-10"

    waiting = client.get("/api/classes/freeze-requests", headers=h).json()
    assert len(waiting) == 1 and waiting[0]["days"] == 10 and waiting[0]["note"] == "טיסה לחו״ל" and waiting[0]["problem"] is None
    assert client.post(f"/api/classes/freeze-requests/{waiting[0]['id']}/approve", headers=h).json() == []
    db_session.expire_all()
    frozen = db_session.get(Membership, m["id"])
    assert str(frozen.freeze_from) == "2026-10-10" and str(frozen.freeze_until) == "2026-10-20"
    event = db_session.scalar(select(MembershipEvent).where(MembershipEvent.membership_id == frozen.id, MembershipEvent.action == "freeze"))
    assert "טיסה" in event.reason and event.fee_cents == 5000                  # the type's fee, recorded as on any freeze
    assert len(_jobs(db_session, "membership_frozen")) == 1                  # the client's usual "frozen" message


def test_a_request_outside_the_rules_is_refused_at_once(client, db_session, clock):
    h, s, c, m, me = _setup(client, db_session, freeze_min_days=7)
    r = _ask(client, me, m, "2026-10-10", "2026-10-13")
    assert r.status_code == 400 and r.json()["detail"] == "הקפאה קצרה מדי — לפחות 7 ימים"
    assert _ask(client, me, m, "2026-09-20", "2026-10-13").json()["detail"] == "תחילת ההקפאה כבר עברה"
    assert db_session.scalar(select(MembershipRequest)) is None


def test_a_rejection_tells_the_client_why(client, db_session, clock):
    h, s, c, m, me = _setup(client, db_session)
    _ask(client, me, m, "2026-10-10", "2026-10-20")
    rid = client.get("/api/classes/freeze-requests", headers=h).json()[0]["id"]
    assert client.post(f"/api/classes/freeze-requests/{rid}/reject", headers=h, json={"reason": "בחודש הראשון אין הקפאות"}).json() == []
    body = _jobs(db_session, "freeze_request_declined")[0].body
    assert "10/10–20/10" in body and "בחודש הראשון אין הקפאות" in body
    db_session.expire_all()
    assert db_session.get(Membership, m["id"]).freeze_from is None
    assert _mine(client, me)["freeze"]["can_ask"] is True                    # may ask again


def test_the_owner_may_let_requests_inside_the_rules_approve_themselves(client, db_session, clock):
    h, s, c, m, me = _setup(client, db_session)
    client.patch("/api/classes/settings", headers=h, json={"values": {"freeze_requests": "auto"}})
    r = _ask(client, me, m, "2026-10-10", "2026-10-20")
    assert r.json()["approved"] is True
    db_session.expire_all()
    assert str(db_session.get(Membership, m["id"]).freeze_from) == "2026-10-10"
    assert db_session.scalar(select(Notification).where(Notification.type == "notify-freeze_requested")) is None
    assert client.get("/api/classes/freeze-requests", headers=h).json() == []


def test_no_requests_when_the_owner_or_the_membership_type_says_so(client, db_session, clock):
    h, s, c, m, me = _setup(client, db_session)
    client.patch("/api/classes/settings", headers=h, json={"values": {"freeze_requests": "off"}})
    assert _mine(client, me)["freeze"] is None
    assert _ask(client, me, m, "2026-10-10", "2026-10-20").json()["detail"] == "הקפאה אפשרית רק דרך העסק"
    client.patch("/api/classes/settings", headers=h, json={"values": {"freeze_requests": "manual"}})
    kind = db_session.get(Membership, m["id"])
    kind.rules = {**kind.rules, "freeze_allowed": False}
    db_session.commit()
    assert _mine(client, me)["freeze"] is None


def test_the_client_withdraws_and_cannot_touch_someone_elses(client, db_session, clock):
    h, s, c, m, me = _setup(client, db_session)
    _ask(client, me, m, "2026-10-10", "2026-10-20")
    rid = _mine(client, me)["freeze"]["request"]["id"]
    stranger = bf._customer(db_session, "0509999999")
    assert client.post(f"{BASE}/freeze-requests/{rid}/withdraw", headers=stranger).status_code == 404
    assert client.post(f"{BASE}/memberships/{m['id']}/freeze-request", headers=stranger,
                       json={"from_on": "2026-10-10", "until_on": "2026-10-20"}).status_code == 404
    assert client.post(f"{BASE}/freeze-requests/{rid}/withdraw", headers=me).status_code == 200
    assert client.get("/api/classes/freeze-requests", headers=h).json() == []
    assert client.post(f"/api/classes/freeze-requests/{rid}/approve", headers=h).json()["detail"] == "הבקשה כבר טופלה"
