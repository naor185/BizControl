"""Lucky Club prizes (the owner, 2026-11-04): points into the club card at the draw, a percent off as a personal code in
the coupon field, a gift — each with days to use it; past them a code or a gift expires and prize points not spent are
taken back; the winners told on WhatsApp when the owner presses it; ויקי reminding of a prize about to end; a drawn
draw deleted from the history keeps its winners' prizes. Local test database; nothing is sent."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.client import Client
from app.models.client_points_ledger import ClientPointsLedger
from app.models.lucky_draw import LuckyDrawWinner
from app.models.message_job import MessageJob
from app.services import coupons
from app.services import lucky_draw as ld
from app.services import viki
from app.services.classes import today_il
from tests.test_lucky_club import _business


def _one(db, s, name="נועה", phone="0501234567", points=0):
    c = Client(studio_id=s.id, full_name=name, phone=phone, is_club_member=True, loyalty_points=points)
    db.add(c)
    db.commit()
    return c


def _won(client, h, prize: dict):
    r = client.post("/api/lucky-club/draws", headers=h,
                    json={"name": "הגרלת חנוכה", "winners_count": 1, "prizes": [{"place": 1, **prize}]})
    assert r.status_code == 201, r.text
    d = r.json()
    assert client.post(f"/api/lucky-club/draws/{d['id']}/lock", headers=h).status_code == 200
    r = client.post(f"/api/lucky-club/draws/{d['id']}/run", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_points_go_into_the_card_and_what_isnt_spent_ends(client, db_session):
    h, s = _business(client, db_session, "lp-points")
    c = _one(db_session, s, points=40)
    d = _won(client, h, {"kind": "points", "value": 500, "valid_days": 30})
    [w] = d["winners"]
    assert w["prize_title"] == "500 נקודות" and w["prize_kind"] == "points" and w["status"] == "pending"
    assert w["expires_on"] == (today_il() + timedelta(days=30)).isoformat()
    db_session.refresh(c)
    assert c.loyalty_points == 540

    # 200 spent at the till, then the time ends — the 300 left go, the rest of the card stays
    c.loyalty_points -= 200
    db_session.add(ClientPointsLedger(studio_id=s.id, client_id=c.id, delta_points=-200, reason="מימוש נקודות בקופה"))
    db_session.commit()
    assert ld.sweep(db_session, today=today_il() + timedelta(days=10)) == 0           # not yet
    assert ld.sweep(db_session, today=today_il() + timedelta(days=31)) == 1
    db_session.commit()
    db_session.refresh(c)
    winner = db_session.get(LuckyDrawWinner, w["id"])
    assert c.loyalty_points == 40 and winner.status == "expired" and winner.points_expired == 300


def test_prize_points_all_spent_are_a_prize_used(client, db_session):
    h, s = _business(client, db_session, "lp-spent")
    c = _one(db_session, s)
    [w] = _won(client, h, {"kind": "points", "value": 100, "valid_days": 30})["winners"]
    db_session.refresh(c)
    c.loyalty_points -= 100
    db_session.add(ClientPointsLedger(studio_id=s.id, client_id=c.id, delta_points=-100, reason="מימוש נקודות בקופה"))
    db_session.commit()
    ld.sweep(db_session)
    db_session.commit()
    assert db_session.get(LuckyDrawWinner, w["id"]).status == "redeemed"


def test_a_percent_prize_is_a_personal_code_used_once(client, db_session):
    h, s = _business(client, db_session, "lp-code")
    a = _one(db_session, s)
    b = _one(db_session, s, name="רון", phone="0507654321")
    [w] = _won(client, h, {"kind": "percent", "value": 20, "valid_days": 14})["winners"]
    assert w["prize_title"] == "20% הנחה" and w["code"] and w["code"].startswith("WIN")
    c, other = (a, b) if w["client_id"] == str(a.id) else (b, a)          # one of the two won

    with pytest.raises(ValueError, match="שייך ללקוח אחר"):
        coupons.find(db_session, s.id, w["code"], other.id)
    hit = coupons.find(db_session, s.id, w["code"].lower(), c.id)
    assert hit.percent == 20 and hit.lucky is not None
    use = coupons.redeem(db_session, s.id, hit, before_cents=50_000, client_id=c.id)
    db_session.commit()
    assert use.discount_cents == 10_000 and use.lucky_winner_id is not None
    assert db_session.get(LuckyDrawWinner, w["id"]).status == "redeemed"
    with pytest.raises(ValueError, match="כבר נוצל"):
        coupons.find(db_session, s.id, w["code"], c.id)
    assert coupons.code_taken(db_session, s.id, w["code"])                 # the owner can't make a coupon with it


def test_a_gift_or_a_code_past_its_last_day_expires(client, db_session):
    h, s = _business(client, db_session, "lp-expire")
    c = _one(db_session, s)
    [w] = _won(client, h, {"kind": "percent", "value": 10, "valid_days": 1})["winners"]
    ld.sweep(db_session, today=today_il() + timedelta(days=2))
    db_session.commit()
    assert db_session.get(LuckyDrawWinner, w["id"]).status == "expired"
    with pytest.raises(ValueError, match="נוצל|פג"):
        coupons.find(db_session, s.id, w["code"], c.id)


def test_the_winners_are_told_when_the_owner_sends_it(client, db_session):
    h, s = _business(client, db_session, "lp-tell")
    c = _one(db_session, s)
    d = _won(client, h, {"kind": "percent", "value": 15, "valid_days": 30})
    assert db_session.scalar(select(MessageJob).where(MessageJob.client_id == c.id)) is None   # nothing at the draw

    r = client.post(f"/api/lucky-club/draws/{d['id']}/notify", headers=h, json={})
    assert r.status_code == 200 and r.json() == {"sent": 1, "no_phone": []}
    job = db_session.scalar(select(MessageJob).where(MessageJob.client_id == c.id))
    assert job.reminder_type == "lucky_win" and d["winners"][0]["code"] in job.body and "15% הנחה" in job.body
    assert client.post(f"/api/lucky-club/draws/{d['id']}/notify", headers=h, json={}).json()["sent"] == 0  # once
    again = client.post(f"/api/lucky-club/draws/{d['id']}/notify", headers=h, json={"winner_id": d["winners"][0]["id"]})
    assert again.json()["sent"] == 1                                       # one again, on purpose


def test_viki_reminds_of_a_prize_about_to_end(client, db_session):
    h, s = _business(client, db_session, "lp-viki")
    c = _one(db_session, s)
    _won(client, h, {"title": "טיפול מתנה", "valid_days": 5})
    keys = [x["key"] for x in viki.suggestions(db_session, s.id)]
    hit = next(x for x in viki.suggestions(db_session, s.id) if x["key"].startswith("lucky_soon:"))
    assert "נועה" in hit["text"] and "טיפול מתנה" in hit["text"] and hit["action"]["href"] == f"/clients/{c.id}"
    assert any(k.startswith("lucky_soon:") for k in keys)


def test_a_drawn_draw_deleted_keeps_its_prizes(client, db_session):
    h, s = _business(client, db_session, "lp-hide")
    c = _one(db_session, s)
    d = _won(client, h, {"kind": "percent", "value": 25, "valid_days": 30})
    assert client.delete(f"/api/lucky-club/draws/{d['id']}", headers=h).status_code == 204
    assert all(x["id"] != d["id"] for x in client.get("/api/lucky-club/draws", headers=h).json())
    [p] = client.get(f"/api/lucky-club/clients/{c.id}/prizes", headers=h).json()
    assert p["code"] == d["winners"][0]["code"] and p["in_history"] is False and p["status"] == "pending"
    assert coupons.find(db_session, s.id, p["code"], c.id).percent == 25        # the code still works


def test_a_prize_is_checked(client, db_session):
    h, s = _business(client, db_session, "lp-check")
    for prize in ({"kind": "percent", "value": 0}, {"kind": "percent", "value": 120}, {"kind": "points"},
                  {"kind": "cash", "value": 5}, {"title": "מתנה", "valid_days": 0}):
        r = client.post("/api/lucky-club/draws", headers=h, json={"name": "x", "prizes": [{"place": 1, **prize}]})
        assert r.status_code == 400, prize
