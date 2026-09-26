"""Classes extras 4 (part 2) — a full course's own waitlist. When a registration is cancelled the first in line
is enrolled at once (the owner's "auto", the default) or offered the spot for the confirm window ("approval");
an offer not taken in time passes to the next; leaving an offered spot frees it. Frozen clock; local test
database; nothing is sent."""
from datetime import timedelta

from sqlalchemy import select

from app.models.classes import ClassBooking, CourseEnrollment
from app.models.module import StudioModule
from app.services import courses
from tests.test_classes_courses import _course, _enroll, _mine, _set
from tests.test_classes_stage4 import _business, _client, _jobs, clock  # noqa: F401


def _full_course(client, db):
    """A course of three spots, full; two more clients to wait."""
    h, s, _ = _business(client, db)
    db.add(StudioModule(studio_id=s.id, module_id="class_waitlist", is_enabled=True))
    db.commit()
    t = _course(client, h)
    people = [_client(db, s, n) for n in range(1, 6)]
    enrolled = [_mine(_enroll(client, h, t, c), c) for c in people[:3]]
    return h, s, t, people, enrolled


def _wait(client, h, t, c):
    return client.post(f"/api/classes/courses/{t['id']}/waitlist", headers=h, json={"client_id": str(c.id)})


def _cancel(client, h, e):
    return client.post(f"/api/classes/enrollments/{e['id']}/cancel", headers=h, json={})


def test_the_first_in_line_is_enrolled_when_a_spot_frees(client, db_session, clock):
    h, s, t, people, enrolled = _full_course(client, db_session)
    assert _wait(client, h, t, people[3]).status_code == 200
    assert _wait(client, h, t, people[4]).status_code == 200
    line = [e for e in client.get(f"/api/classes/courses/{t['id']}", headers=h).json()["enrollments"] if e["status"] == "waiting"]
    assert [e["position"] for e in line] == [1, 2]
    after = _cancel(client, h, enrolled[0])
    moved = _mine(after, people[3])
    assert moved["status"] == "active" and moved["sessions_total"] == 4 and moved["price_cents"] == 40000
    assert len(db_session.scalars(select(ClassBooking).where(ClassBooking.client_id == people[3].id)).all()) == 4
    assert _mine(after, people[4])["status"] == "waiting"
    assert len(_jobs(db_session, s, "course_enrolled")) == 4          # the three, and the one from the line


def test_joining_the_line_only_when_the_course_is_full(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    db_session.add(StudioModule(studio_id=s.id, module_id="class_waitlist", is_enabled=True))
    db_session.commit()
    t = _course(client, h)
    c = _client(db_session, s, 1)
    assert _wait(client, h, t, c).json()["detail"] == "יש מקום בקורס, אפשר להירשם"
    _set(client, h, waitlist_max=0)
    for n in range(2, 5):
        _enroll(client, h, t, _client(db_session, s, n))
    assert _wait(client, h, t, c).json()["detail"] == "אין רשימת המתנה לקורס הזה"


def test_an_offer_waits_for_its_window_then_passes_to_the_next(client, db_session, clock):
    h, s, t, people, enrolled = _full_course(client, db_session)
    _set(client, h, waitlist_mode="approval", waitlist_confirm_minutes=60)
    _wait(client, h, t, people[3])
    _wait(client, h, t, people[4])
    after = _cancel(client, h, enrolled[0])
    offered = _mine(after, people[3])
    assert offered["status"] == "offered" and offered["offer_expires_at"]
    assert len(_jobs(db_session, s, "waitlist_promoted")) == 1
    assert _enroll(client, h, t, people[4]).json()["detail"] == "הקורס מלא"           # the spot is held for the first

    clock["now"] = clock["now"] + timedelta(minutes=61)
    assert courses.sweep_waitlist(db_session) == 1
    db_session.expire_all()
    rows = {e.client_id: e.status for e in db_session.scalars(select(CourseEnrollment)).all()}
    assert rows[people[3].id] == "expired" and rows[people[4].id] == "offered"
    assert len(_jobs(db_session, s, "waitlist_expiring")) == 1

    second = next(e for e in db_session.scalars(select(CourseEnrollment)).all() if e.client_id == people[4].id)
    r = client.post(f"/api/classes/enrollments/{second.id}/take", headers=h)
    assert r.status_code == 200 and _mine(r, people[4])["status"] == "active"


def test_leaving_an_offered_spot_frees_it_for_the_next(client, db_session, clock):
    h, s, t, people, enrolled = _full_course(client, db_session)
    _set(client, h, waitlist_mode="approval")
    _wait(client, h, t, people[3])
    _wait(client, h, t, people[4])
    after = _cancel(client, h, enrolled[0])
    first = _mine(after, people[3])
    r = client.post(f"/api/classes/enrollments/{first['id']}/leave", headers=h)
    assert _mine(r, people[4])["status"] == "offered"
