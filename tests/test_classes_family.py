"""Classes extras 6 (part 1) — a family / shared membership, every choice the owner's: how many people, how
entries count (one shared balance / each their own / shared with a cap per person — for a card and for a weekly
limit), the price for the number of people (fixed / per person / first + extra / first + % off each more), and
adding or removing people after the sale (free / priced / locked). A personal membership stays as it was.
Frozen clock; local test database; nothing is sent."""
from sqlalchemy import select

from app.models.classes import ClassBooking
from tests.test_classes_stage4 import _balance, _book, _booking, _business, _client, _sell, _sessions, _type, clock  # noqa: F401


def _family(client, h, **rules):
    return _type(client, h, **{"name": "משפחתי", "max_members": 3, **rules})


def _people(db, s, n=3):
    return [_client(db, s, i) for i in range(1, n + 1)]


def _sell_family(client, h, holder, t, others):
    return _sell(client, h, holder, t, members=[str(c.id) for c in others])


def test_the_price_is_the_owners_pricing_for_the_number_of_people(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    mom, kid, dad = _people(db_session, s)
    cases = {"fixed": ({}, 60000), "per_member": ({}, 180000),
             "first_plus_extra": ({"extra_member_cents": 20000}, 100000),
             "first_plus_discount": ({"extra_member_percent": 50}, 120000)}
    for pricing, (extra, expected) in cases.items():
        t = _family(client, h, name=f"משפחתי {pricing}", pricing=pricing, **extra)
        m = _sell_family(client, h, mom, t, [kid, dad])
        assert m["price_cents"] == expected, pricing
        assert m["is_family"] and [p["full_name"] for p in m["members"]] == [mom.full_name, kid.full_name, dad.full_name]
        assert m["members"][0]["holder"] is True
    shown = {t["pricing"]: t["family_prices"] for t in client.get("/api/classes/membership-types", headers=h).json()}
    assert shown["first_plus_extra"] == [60000, 80000, 100000]           # the sale screen's table: 1, 2, 3 people


def test_a_shared_card_is_one_balance_for_everyone(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first, second, third = _sessions(db_session, t["id"])[:3]
    mom, kid, _ = _people(db_session, s)
    m = _sell_family(client, h, mom, _family(client, h, entries=2), [kid])
    assert _book(client, h, first, mom).status_code == 200
    assert _book(client, h, second, kid).status_code == 200                    # from the same card
    r = _book(client, h, third, mom)
    assert r.status_code == 400 and "נגמרו הכניסות בכרטיסייה" in r.json()["detail"]
    assert _balance(client, h, m["id"])["total"] == 2


def test_each_person_their_own_entries(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first, second = _sessions(db_session, t["id"])[:2]
    mom, kid, _ = _people(db_session, s)
    m = _sell_family(client, h, mom, _family(client, h, entries=1, entries_mode="each"), [kid])
    assert _balance(client, h, m["id"])["total"] == 2                          # 1 each, on the card's log
    assert _book(client, h, first, mom).status_code == 200
    r = _book(client, h, second, mom)
    assert r.status_code == 400 and "נוצלו 1 הכניסות שלך במנוי המשפחתי" in r.json()["detail"]
    assert _book(client, h, second, kid).status_code == 200


def test_a_shared_card_with_a_cap_per_person(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first, second, third = _sessions(db_session, t["id"])[:3]
    mom, kid, _ = _people(db_session, s)
    _sell_family(client, h, mom, _family(client, h, entries=3, entries_mode="shared_capped", member_cap=2), [kid])
    assert _book(client, h, first, mom).status_code == 200
    assert _book(client, h, second, mom).status_code == 200
    assert _book(client, h, third, mom).status_code == 400                    # her 2 of the 3
    assert _book(client, h, third, kid).status_code == 200


def test_a_weekly_limit_for_the_family_together_or_for_each(client, db_session, clock):
    h, s, t = _business(client, db_session)
    sunday, tuesday = _sessions(db_session, t["id"])[:2]                      # the same week
    mom, kid, dad = _people(db_session, s)
    together = _family(client, h, name="שבועי משפחתי", kind="weekly", entries=1, duration_days=30)
    _sell_family(client, h, mom, together, [kid])
    assert _book(client, h, sunday, mom).status_code == 200
    assert _book(client, h, tuesday, kid).status_code == 400                  # once a week for the family
    each = _family(client, h, name="שבועי לכל אחד", kind="weekly", entries=1, duration_days=30, entries_mode="each")
    other_kid = _client(db_session, s, 4)
    _sell_family(client, h, dad, each, [other_kid])
    assert _book(client, h, sunday, dad).status_code == 200
    assert _book(client, h, tuesday, other_kid).status_code == 200            # once a week each


def test_adding_people_after_the_sale_by_the_owners_rule(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    mom, kid, dad = _people(db_session, s)
    fourth = _client(db_session, s, 4)
    free = _sell(client, h, mom, _family(client, h, name="חינם"))
    after = client.post(f"/api/classes/memberships/{free['id']}/members", headers=h, json={"client_id": str(kid.id)}).json()
    assert after["price_cents"] == 60000 and len(after["members"]) == 2
    priced = _sell(client, h, dad, _family(client, h, name="בתשלום", pricing="per_member", members_change="priced"))
    after = client.post(f"/api/classes/memberships/{priced['id']}/members", headers=h, json={"client_id": str(fourth.id)}).json()
    assert after["price_cents"] == 120000                                     # one more person's price
    assert client.post(f"/api/classes/memberships/{free['id']}/members", headers=h, json={"client_id": str(dad.id)}).status_code == 200
    full = client.post(f"/api/classes/memberships/{free['id']}/members", headers=h, json={"client_id": str(fourth.id)})
    assert full.status_code == 400 and full.json()["detail"] == "המנוי הזה לעד 3 אנשים"
    locked = _sell(client, h, fourth, _family(client, h, name="נעול", members_change="locked"))
    r = client.post(f"/api/classes/memberships/{locked['id']}/members", headers=h, json={"client_id": str(kid.id)})
    assert r.status_code == 400 and "אי אפשר להוסיף" in r.json()["detail"]
    personal = _sell(client, h, kid, _type(client, h, name="אישי"))
    assert client.post(f"/api/classes/memberships/{personal['id']}/members", headers=h, json={"client_id": str(mom.id)}).status_code == 400


def test_removing_a_person_cancels_their_coming_classes_and_takes_their_entries(client, db_session, clock):
    h, s, t = _business(client, db_session)
    first = _sessions(db_session, t["id"])[0]
    mom, kid, _ = _people(db_session, s)
    m = _sell_family(client, h, mom, _family(client, h, entries=2, entries_mode="each"), [kid])
    _book(client, h, first, kid)
    r = client.post(f"/api/classes/memberships/{m['id']}/members/{kid.id}/remove", headers=h)
    assert r.status_code == 200 and [p["full_name"] for p in r.json()["members"]] == [mom.full_name]
    db_session.expire_all()
    assert db_session.scalar(select(ClassBooking.status).where(ClassBooking.client_id == kid.id)) == "canceled"
    assert _balance(client, h, m["id"])["available"] == 2                     # the kid's 2 left with the kid
    assert client.post(f"/api/classes/memberships/{m['id']}/members/{mom.id}/remove", headers=h).status_code == 400


def test_a_family_member_finds_the_membership_and_the_owners_choices_are_checked(client, db_session, clock):
    h, s, t = _business(client, db_session)
    mom, kid, _ = _people(db_session, s)
    m = _sell_family(client, h, mom, _family(client, h), [kid])
    mine = client.get(f"/api/classes/memberships?client_id={kid.id}", headers=h).json()
    assert [x["id"] for x in mine] == [m["id"]]
    bad = client.post("/api/classes/membership-types", headers=h, json={"name": "שגוי", "kind": "punch", "entries": 10, "duration_days": 90,
                                                                         "max_members": 3, "entries_mode": "shared_capped"})
    assert bad.status_code == 400 and bad.json()["detail"] == "כמה כניסות לכל היותר לכל אחד?"
    too_much = client.post("/api/classes/membership-types", headers=h, json={"name": "שגוי", "kind": "punch", "entries": 10, "duration_days": 90,
                                                                              "max_members": 3, "entries_mode": "shared_capped", "member_cap": 12})
    assert too_much.status_code == 400
    assert _booking(_book(client, h, _sessions(db_session, t["id"])[0], kid), kid)["membership"]   # the kid books on mom's membership
