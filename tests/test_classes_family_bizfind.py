"""Classes extras 6 (part 3) — a family membership on BizFind: a person on it sees it and books on it; when the
owner chose "only the holder books", the holder books for them (e.g. a parent for a child), sees their classes
and cancels them — and nobody else can. Frozen clock; local test database; nothing is sent."""
from tests import test_classes_bizfind as bf
from tests.test_classes_bizfind import clock  # noqa: F401

BASE = "/api/marketplace/classes/pilates"


def _setup(client, db, booking_by="each"):
    h, s, t, _ = bf._business(client, db)
    kind = client.post("/api/classes/membership-types", headers=h, json={
        "name": "משפחתי", "kind": "punch", "entries": 10, "duration_days": 90, "max_members": 3, "booking_by": booking_by}).json()
    mom, kid = bf._client(db, s, "0501111111", name="מיכל לוי"), bf._client(db, s, "0502222222", name="נועם לוי")
    client.post("/api/classes/memberships", headers=h, json={"client_id": str(mom.id), "type_id": kind["id"], "members": [str(kid.id)]})
    first = bf._sessions(db, t["id"])[0]
    return s, kid, first, bf._customer(db, "0501111111"), bf._customer(db, "0502222222")


def test_a_family_member_sees_the_membership_and_books_on_it(client, db_session, clock):
    s, kid, first, mom_in, kid_in = _setup(client, db_session)
    card = client.get(f"{BASE}/mine", headers=kid_in).json()["memberships"][0]
    assert card["family"] == {"holder": False, "holder_name": "מיכל לוי", "others": ["מיכל לוי"], "booking_by": "each"}
    assert client.post(f"{BASE}/sessions/{first.id}/book", headers=kid_in).status_code == 200


def test_the_holder_books_for_the_family_when_the_owner_says_so(client, db_session, clock):
    s, kid, first, mom_in, kid_in = _setup(client, db_session, booking_by="holder")
    kid_view = next(x for x in client.get(f"{BASE}/schedule?week=2026-10-04", headers=kid_in).json()["sessions"] if x["id"] == str(first.id))
    assert kid_view["can_book"] is False and kid_view["why_not"] == "ההרשמה דרך בעל/ת המנוי המשפחתי"
    mom_view = next(x for x in client.get(f"{BASE}/schedule?week=2026-10-04", headers=mom_in).json()["sessions"] if x["id"] == str(first.id))
    assert mom_view["can_book"] is True
    assert mom_view["book_for"] == [{"client_id": str(kid.id), "name": "נועם לוי", "booked": False, "can_book": True}]

    r = client.post(f"{BASE}/sessions/{first.id}/book", headers=mom_in, json={"for_client_id": str(kid.id)})
    assert r.status_code == 200 and r.json()["message"].startswith("נועם לוי נרשם/ה")
    kids = [u for u in client.get(f"{BASE}/mine", headers=mom_in).json()["upcoming"] if u["for_name"] == "נועם לוי"]
    assert len(kids) == 1
    assert client.post(f"{BASE}/bookings/{kids[0]['id']}/cancel", headers=mom_in).status_code == 200   # the holder cancels it

    bf._client(db_session, s, "0503333333", name="שכנה")                    # another client of the business
    r = client.post(f"{BASE}/sessions/{first.id}/book", headers=bf._customer(db_session, "0503333333"), json={"for_client_id": str(kid.id)})
    assert r.status_code == 403 and r.json()["detail"] == "אפשר לרשום רק את מי שבמנוי המשפחתי שלך"
