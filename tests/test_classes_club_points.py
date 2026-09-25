"""Club points on membership and class payments — the owner's choice (2026-09-25): a percentage for a
membership and one for a single entry, set in the class settings with ready-made values, 0 = none (the
default, so nothing changes until the owner chooses). Only for a club member, only when the business's plan
has the club; a fee earns nothing; deleting the payment takes the points back. Local test database; nothing is sent."""
from sqlalchemy import select

from app.models.client_points_ledger import ClientPointsLedger
from app.models.module import StudioModule
from app.models.payment import Payment
from app.models.user import User
from tests.test_classes_stage4 import SUNDAY_18, _book, _booking, _business, _client, _sell, _sessions, _type, clock  # noqa: F401

KEYS = ("club_points_membership_percent", "club_points_entry_percent")


def _club(db, studio, on=True):
    db.add(StudioModule(studio_id=studio.id, module_id="customer_club", is_enabled=on))
    db.commit()


def _member(db, studio, n, member=True):
    c = _client(db, studio, n)
    c.is_club_member = member
    db.commit()
    return c


def _set(client, h, **values):
    r = client.patch("/api/classes/settings", headers=h, json={"values": values})
    assert r.status_code == 200, r.text
    return r.json()


def _pay_membership(client, h, card, cents):
    r = client.post(f"/api/classes/memberships/{card['id']}/payments", headers=h,
                    json={"amount_cents": cents, "method": "cash", "send_receipt": False})
    assert r.status_code == 200, r.text


def _points(db, c):
    db.expire_all()
    return db.get(type(c), c.id).loyalty_points or 0


def test_until_the_owner_chooses_a_membership_payment_gives_no_points(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    _club(db_session, s)
    c = _member(db_session, s, 1)
    _pay_membership(client, h, _sell(client, h, c, _type(client, h)), 60000)
    assert _points(db_session, c) == 0


def test_the_owners_percentage_gives_points_to_a_club_member_only(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    _club(db_session, s)
    _set(client, h, club_points_membership_percent=5)
    member, other = _member(db_session, s, 1), _member(db_session, s, 2, member=False)
    kind = _type(client, h)
    _pay_membership(client, h, _sell(client, h, member, kind), 60000)
    _pay_membership(client, h, _sell(client, h, other, kind), 60000)
    assert _points(db_session, member) == 30                  # 5% of ₪600, a point is worth ₪1
    assert _points(db_session, other) == 0
    payment = db_session.scalar(select(Payment).where(Payment.client_id == member.id))
    entry = db_session.scalar(select(ClientPointsLedger).where(ClientPointsLedger.client_id == member.id))
    assert entry.delta_points == 30 and str(payment.id) in entry.reason


def test_a_single_entry_earns_by_its_own_percentage_and_a_fee_earns_nothing(client, db_session, clock):
    h, s, t = _business(client, db_session)
    _club(db_session, s)
    _set(client, h, club_points_entry_percent=10)
    first = _sessions(db_session, t["id"])[0]
    walk_in, late = _member(db_session, s, 1), _member(db_session, s, 2)
    _sell(client, h, late, _type(client, h))
    client.put("/api/classes/penalty-rules", headers=h, json={"rules": [{"event": "no_show", "action": "fixed", "amount_cents": 5000}]})
    single = _booking(_book(client, h, first, walk_in, drop_in=True), walk_in)["id"]
    booked = _booking(_book(client, h, first, late), late)["id"]
    assert client.post(f"/api/classes/bookings/{single}/payments", headers=h,
                       json={"amount_cents": 8000, "method": "cash", "send_receipt": False}).status_code == 200
    assert _points(db_session, walk_in) == 8                  # 10% of ₪80
    clock["now"] = SUNDAY_18
    client.post(f"/api/classes/bookings/{booked}/attendance", headers=h, json={"status": "no_show"})
    fee = client.get("/api/classes/fees", headers=h).json()[0]
    client.post(f"/api/classes/fees/{fee['id']}/pay", headers=h, json={"method": "cash", "send_receipt": False})
    assert _points(db_session, late) == 0                     # a fee is not a purchase


def test_without_the_club_in_the_plan_there_is_no_setting_and_no_points(client, db_session, clock):
    from app.services import policies
    h, s, _ = _business(client, db_session)
    _club(db_session, s, on=False)
    assert not {x["key"] for x in client.get("/api/classes/settings", headers=h).json()} & set(KEYS)
    policies.set_policy(db_session, s.id, "club_points_membership_percent", 10)     # a value left from before
    db_session.commit()
    c = _member(db_session, s, 1)
    _pay_membership(client, h, _sell(client, h, c, _type(client, h)), 60000)
    assert _points(db_session, c) == 0


def test_the_settings_offer_ready_made_values_including_the_regular_percentage(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    _club(db_session, s)
    rules = {x["key"]: x for x in client.get("/api/classes/settings", headers=h).json()}
    assert set(KEYS) <= set(rules)
    presets = rules["club_points_membership_percent"]["presets"]
    assert presets[0] == {"value": 0, "label": "בלי נקודות"}
    assert {"value": 5, "label": "כמו בתשלום רגיל (5%)"} in presets             # the business's regular 5%
    assert len({p["value"] for p in presets}) == len(presets)
    assert rules["club_points_membership_percent"]["value"] == 0


def test_deleting_the_payment_takes_the_points_back(client, db_session, clock):
    h, s, _ = _business(client, db_session)
    _club(db_session, s)
    _set(client, h, club_points_membership_percent=10)
    c = _member(db_session, s, 1)
    _pay_membership(client, h, _sell(client, h, c, _type(client, h)), 60000)
    assert _points(db_session, c) == 60
    payment = db_session.scalar(select(Payment).where(Payment.client_id == c.id))
    db_session.scalar(select(User).where(User.studio_id == s.id)).role = "superadmin"
    db_session.commit()
    assert client.delete(f"/api/payments/{payment.id}", headers=h).status_code == 204
    assert _points(db_session, c) == 0
