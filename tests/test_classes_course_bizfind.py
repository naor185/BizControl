"""Classes extras 4 (part 3) — a course on BizFind: the week's schedule shows a course session as part of a
course (register for the whole course, not the session), the client registers themselves (payment at the
business) when the owner allows it, and "my classes" shows the course and its sessions (no swap, no late fee).
Frozen clock; local test database; nothing is sent."""
from tests import test_classes_bizfind as bf
from tests.test_classes_bizfind import clock  # noqa: F401

BASE = "/api/marketplace/classes/pilates"


def _setup(client, db):
    h, s, _, _ = bf._business(client, db)
    t = client.post("/api/classes/templates", headers=h, json={
        "name": "קורס פילאטיס למתחילים", "weekdays": [1], "start_time": "19:00", "duration_minutes": 60,
        "starts_on": "2026-10-01", "sessions_count": 4, "capacity": 6, "course_price_cents": 40000}).json()
    bf._client(db, s, "0501111111")
    return h, s, t, bf._customer(db, "0501111111")


def test_a_client_registers_for_a_whole_course_on_bizfind(client, db_session, clock):
    h, s, t, me = _setup(client, db_session)
    week = client.get(f"{BASE}/schedule?week=2026-10-04", headers=me).json()["sessions"]
    item = next(x for x in week if x["course"])
    assert item["can_book"] is False and item["why_not"] == "ההרשמה היא לקורס כולו"
    course = item["course"]
    assert (course["can_enroll"], course["sessions_total"], course["price_cents"]) == (True, 4, 40000)

    r = client.post(f"{BASE}/courses/{t['id']}/enroll", headers=me)
    assert r.status_code == 200 and "4 מפגשים" in r.json()["message"] and "₪400" in r.json()["message"]
    mine = client.get(f"{BASE}/mine", headers=me).json()
    assert [(c["name"], c["sessions_left"], c["price_cents"], c["paid_cents"]) for c in mine["courses"]] == [("קורס פילאטיס למתחילים", 4, 40000, 0)]
    sessions = [u for u in mine["upcoming"] if u["enrollment_id"] == mine["courses"][0]["id"]]
    assert len(sessions) == 4 and not any(u["can_swap"] or u["late_if_cancel_now"] for u in sessions)
    again = client.get(f"{BASE}/schedule?week=2026-10-04", headers=me).json()["sessions"]
    assert next(x for x in again if x["course"])["course"]["enrollment"]["status"] == "active"


def test_the_owner_may_keep_course_registration_at_the_business(client, db_session, clock):
    h, s, t, me = _setup(client, db_session)
    client.patch("/api/classes/settings", headers=h, json={"values": {"course_self_enroll": False}})
    week = client.get(f"{BASE}/schedule?week=2026-10-04", headers=me).json()["sessions"]
    assert next(x for x in week if x["course"])["course"]["why_not"] == "ההרשמה לקורס דרך העסק"
    r = client.post(f"{BASE}/courses/{t['id']}/enroll", headers=me)
    assert r.status_code == 400 and r.json()["detail"] == "ההרשמה לקורס דרך העסק"
    stranger = bf._customer(db_session, "0509999999")
    assert client.post(f"{BASE}/courses/{t['id']}/enroll", headers=stranger).status_code == 403    # not a client of the business
