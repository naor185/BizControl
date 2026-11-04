"""Lucky Club — raffles among the business's own clients (the owner's spec, 2026-11-04, its 14 required checks):
audiences (club / not club / everyone / by hand), one and three winners, no one winning twice, each winner their
place's prize, the history kept, businesses apart, two runs at once, results that never change, who may use it, and a
client who changed after the draw was locked. Local test database; nothing is sent."""
import threading

import psycopg2
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.client import Client
from app.models.lucky_draw import LuckyDraw, LuckyDrawParticipant, LuckyDrawWinner
from app.models.module import StudioModule
from app.models.studio import Studio
from app.services import lucky_draw as ld
from tests.conftest import TEST_DATABASE_URL, register_and_login

PRIZES = [{"place": 1, "title": "טיפול מתנה"}, {"place": 2, "title": "30% הנחה"}, {"place": 3, "title": "מוצר מתנה"}]


def _business(client, db, slug, *, modules=("customer_club", "lucky_club")):
    h = register_and_login(client, slug, f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    for m in modules:                                     # the superadmin turns them on (a locked override)
        db.add(StudioModule(studio_id=s.id, module_id=m, is_enabled=True, is_locked=True))
    db.commit()
    return h, s


def _clients(db, s, members=3, regulars=2):
    made = []
    for i in range(members):
        made.append(Client(studio_id=s.id, full_name=f"חבר {i}", phone=f"05000001{i:02d}", is_club_member=True))
    for i in range(regulars):
        made.append(Client(studio_id=s.id, full_name=f"רגיל {i}", phone=f"05000002{i:02d}", is_club_member=False))
    made.append(Client(studio_id=s.id, full_name="לקוח מזדמן", is_walk_in=True))          # never takes part
    made.append(Client(studio_id=s.id, full_name="נמחק", is_active=False, is_club_member=True))   # never takes part
    db.add_all(made)
    db.commit()
    return made


def _draw(client, h, **body):
    r = client.post("/api/lucky-club/draws", headers=h, json={"name": "הגרלת חנוכה", "prizes": PRIZES, **body})
    assert r.status_code == 201, r.text
    return r.json()


def _lock_and_run(client, h, draw_id):
    r = client.post(f"/api/lucky-club/draws/{draw_id}/lock", headers=h)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/lucky-club/draws/{draw_id}/run", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_audiences_take_their_clients_from_the_club(client, db_session):        # checks 1–4
    h, s = _business(client, db_session, "lucky-aud")
    made = _clients(db_session, s)
    count = lambda aud, ids=None: client.post("/api/lucky-club/audience-count", headers=h,
                                              json={"audience": aud, "client_ids": ids}).json()["count"]
    assert (count("club"), count("regular"), count("all")) == (3, 2, 5)        # no walk-in, no deleted client

    for audience, names in (("club", {"חבר 0", "חבר 1", "חבר 2"}), ("regular", {"רגיל 0", "רגיל 1"}),
                            ("all", {"חבר 0", "חבר 1", "חבר 2", "רגיל 0", "רגיל 1"})):
        d = _draw(client, h, audience=audience)
        assert d["participants_count"] == len(names)                        # shown before it's locked
        done = _lock_and_run(client, h, d["id"])
        assert {p["full_name"] for p in done["participants"]} == names
        assert done["participants_count"] == len(names)

    chosen = [str(made[0].id), str(made[3].id)]                                  # one member, one not
    d = _draw(client, h, audience="manual", manual_client_ids=chosen, winners_count=2)
    assert d["participants_count"] == 2 and {c["full_name"] for c in d["manual_clients"]} == {"חבר 0", "רגיל 0"}
    done = _lock_and_run(client, h, d["id"])
    assert {p["full_name"] for p in done["participants"]} == {"חבר 0", "רגיל 0"}
    assert {w["full_name"] for w in done["winners"]} == {"חבר 0", "רגיל 0"}


def test_one_winner_and_three_winners_each_with_their_prize(client, db_session):    # checks 5, 6, 7, 8
    h, s = _business(client, db_session, "lucky-win")
    _clients(db_session, s, members=6, regulars=0)
    one = _lock_and_run(client, h, _draw(client, h, winners_count=1, prizes=PRIZES[:1])["id"])
    assert [(w["place"], w["prize_title"]) for w in one["winners"]] == [(1, "טיפול מתנה")]

    three = _lock_and_run(client, h, _draw(client, h, winners_count=3)["id"])
    assert [(w["place"], w["prize_title"]) for w in three["winners"]] == [(1, "טיפול מתנה"), (2, "30% הנחה"), (3, "מוצר מתנה")]
    assert len({w["participant_id"] for w in three["winners"]}) == 3              # no one twice
    assert all(w["status"] == "pending" for w in three["winners"])

    # never more winners than the owner's version allows, and a prize for every place before locking
    assert client.post("/api/lucky-club/draws", headers=h, json={"name": "x", "winners_count": 4}).status_code in (400, 422)
    no_prize = _draw(client, h, winners_count=2, prizes=PRIZES[:1])
    r = client.post(f"/api/lucky-club/draws/{no_prize['id']}/lock", headers=h)
    assert r.status_code == 400 and "2" in r.json()["detail"]

    # the database itself refuses one client winning twice in a draw
    w = db_session.scalar(select(LuckyDrawWinner).where(LuckyDrawWinner.draw_id == three["id"], LuckyDrawWinner.place == 1))
    db_session.add(LuckyDrawWinner(studio_id=s.id, draw_id=w.draw_id, place=9, participant_id=w.participant_id,
                                   client_id=w.client_id, prize_title="x"))
    try:
        db_session.commit()
        raise AssertionError("a second win was saved")
    except IntegrityError:
        db_session.rollback()


def test_not_enough_participants_is_refused(client, db_session):
    h, s = _business(client, db_session, "lucky-few")
    _clients(db_session, s, members=2, regulars=0)
    d = _draw(client, h, winners_count=3)
    r = client.post(f"/api/lucky-club/draws/{d['id']}/lock", headers=h)
    assert r.status_code == 400 and "2" in r.json()["detail"]


def test_the_history_stays_and_the_results_never_change(client, db_session):        # checks 9, 12
    h, s = _business(client, db_session, "lucky-hist")
    _clients(db_session, s, members=5, regulars=0)
    d = _draw(client, h, winners_count=2)
    first = _lock_and_run(client, h, d["id"])

    again = client.post(f"/api/lucky-club/draws/{d['id']}/run", headers=h).json()   # a second run: the same winners
    assert again["already"] is True and again["winners"] == first["winners"]
    db_session.expire_all()
    assert db_session.scalar(select(LuckyDrawWinner.id).where(LuckyDrawWinner.draw_id == d["id"]).limit(1))
    assert len(db_session.scalars(select(LuckyDrawWinner).where(LuckyDrawWinner.draw_id == d["id"])).all()) == 2

    assert client.patch(f"/api/lucky-club/draws/{d['id']}", headers=h, json={"winners_count": 1}).status_code == 409
    assert client.post(f"/api/lucky-club/draws/{d['id']}/cancel", headers=h).status_code == 409

    # a prize given — its date and who marked it; the winner stays who it is
    wid = first["winners"][0]["id"]
    r = client.post(f"/api/lucky-club/winners/{wid}/redeem", headers=h, json={"redeemed": True}).json()
    assert r["status"] == "redeemed" and r["redeemed_at"] and r["full_name"] == first["winners"][0]["full_name"]
    r = client.post(f"/api/lucky-club/winners/{wid}/redeem", headers=h, json={"redeemed": False}).json()
    assert r["status"] == "pending" and r["redeemed_at"] is None

    # after a "refresh": the history, read fresh
    history = client.get("/api/lucky-club/draws", headers=h).json()
    [row] = [x for x in history if x["id"] == d["id"]]
    assert row["status"] == "done" and row["participants_count"] == 5 and row["drawn_by_name"]
    assert [w["full_name"] for w in row["winners"]] == [w["full_name"] for w in first["winners"]]

    # the manager clears it from the history (the owner, 2026-11-04) — gone from the list, the activity log keeps it
    assert client.delete(f"/api/lucky-club/draws/{d['id']}", headers=h).status_code == 204
    assert all(x["id"] != d["id"] for x in client.get("/api/lucky-club/draws", headers=h).json())
    assert client.get(f"/api/lucky-club/draws/{d['id']}", headers=h).status_code == 404


def test_a_draft_changes_until_it_is_locked_and_a_locked_one_can_be_canceled(client, db_session):
    h, s = _business(client, db_session, "lucky-draft")
    _clients(db_session, s)
    d = _draw(client, h, winners_count=1, prizes=PRIZES[:1])
    r = client.patch(f"/api/lucky-club/draws/{d['id']}", headers=h, json={"audience": "all", "name": "הגרלת פורים",
                                                                           "terms": "תקנון קצר"})
    assert r.status_code == 200 and r.json()["participants_count"] == 5 and r.json()["terms"] == "תקנון קצר"
    assert client.post(f"/api/lucky-club/draws/{d['id']}/run", headers=h).status_code == 409   # lock first
    client.post(f"/api/lucky-club/draws/{d['id']}/lock", headers=h)
    assert client.delete(f"/api/lucky-club/draws/{d['id']}", headers=h).status_code == 409    # locked: cancel first
    canceled = client.post(f"/api/lucky-club/draws/{d['id']}/cancel", headers=h).json()
    assert canceled["status"] == "canceled"
    assert client.post(f"/api/lucky-club/draws/{d['id']}/run", headers=h).status_code == 409
    assert client.delete(f"/api/lucky-club/draws/{d['id']}", headers=h).status_code == 204   # a canceled one goes
    draft = _draw(client, h)
    assert client.delete(f"/api/lucky-club/draws/{draft['id']}", headers=h).status_code == 204


def test_businesses_never_see_each_other(client, db_session):                       # check 10
    h, s = _business(client, db_session, "lucky-a")
    other_h, other = _business(client, db_session, "lucky-b")
    _clients(db_session, s)
    theirs = _clients(db_session, other)
    d = _lock_and_run(client, h, _draw(client, h, audience="all", winners_count=1, prizes=PRIZES[:1])["id"])

    assert all(x["id"] != d["id"] for x in client.get("/api/lucky-club/draws", headers=other_h).json())
    for method, url in (("get", f"/api/lucky-club/draws/{d['id']}"), ("post", f"/api/lucky-club/draws/{d['id']}/run"),
                        ("post", f"/api/lucky-club/draws/{d['id']}/cancel"), ("delete", f"/api/lucky-club/draws/{d['id']}")):
        assert getattr(client, method)(url, headers=other_h).status_code == 404
    r = client.post(f"/api/lucky-club/winners/{d['winners'][0]['id']}/redeem", headers=other_h, json={"redeemed": True})
    assert r.status_code == 404
    # another business's client can't be chosen by hand, and never takes part
    r = client.post("/api/lucky-club/draws", headers=h, json={"name": "x", "audience": "manual",
                                                              "manual_client_ids": [str(theirs[0].id)]})
    assert r.status_code == 400
    names = {p.full_name for p in db_session.scalars(select(LuckyDrawParticipant).where(LuckyDrawParticipant.studio_id == s.id))}
    assert names and all(p.studio_id == s.id for p in db_session.scalars(select(LuckyDrawParticipant).where(
        LuckyDrawParticipant.draw_id == d["id"])))


def test_two_runs_at_the_same_moment_pick_once(client, db_session):                  # check 11
    h, s = _business(client, db_session, "lucky-race")
    _clients(db_session, s, members=8, regulars=0)
    d = _draw(client, h, winners_count=3)
    client.post(f"/api/lucky-club/draws/{d['id']}/lock", headers=h)
    db_session.commit()
    schema = db_session.execute(text("SELECT current_schema()")).scalar()

    gate, results, errors = threading.Barrier(2), [], []

    def one_run():
        con = psycopg2.connect(TEST_DATABASE_URL, options=f"-c search_path={schema}")
        eng = create_engine("postgresql+psycopg2://", creator=lambda: con, poolclass=StaticPool)
        db = sessionmaker(bind=eng)()
        try:
            gate.wait()
            draw, already = ld.run(db, s.id, d["id"], None)
            db.commit()
            results.append(already)
        except Exception as e:                       # pragma: no cover — reported below
            errors.append(e)
        finally:
            db.close()
            con.close()

    threads = [threading.Thread(target=one_run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert errors == [] and sorted(results) == [False, True]          # one picked, the other got the same back
    db_session.expire_all()
    assert len(db_session.scalars(select(LuckyDrawWinner).where(LuckyDrawWinner.draw_id == d["id"])).all()) == 3


def test_only_the_management_and_only_with_the_module(client, db_session):            # check 13
    h, s = _business(client, db_session, "lucky-perm")
    _clients(db_session, s)
    assert client.get("/api/lucky-club/draws", headers=h).status_code == 200
    for role, code in (("admin", 200), ("staff", 403), ("artist", 403)):
        email = f"{role}@lucky-perm.com"
        assert client.post("/api/users/artists", headers=h, json={"email": email, "password": "secret123",
                                                                    "display_name": role, "role": role}).status_code == 201
        t = client.post("/api/auth/login-by-email", json={"email": email, "password": "secret123"}).json()["access_token"]
        assert client.get("/api/lucky-club/draws", headers={"Authorization": f"Bearer {t}"}).status_code == code, role

    no_addon, _ = _business(client, db_session, "lucky-none", modules=("customer_club",))
    assert client.get("/api/lucky-club/draws", headers=no_addon).status_code == 403
    no_club, _ = _business(client, db_session, "lucky-noclub", modules=("lucky_club",))    # the club off → it's off
    assert client.get("/api/lucky-club/draws", headers=no_club).status_code == 403


def test_a_client_who_changed_after_the_lock_stays_as_they_were(client, db_session):  # check 14
    h, s = _business(client, db_session, "lucky-change")
    made = _clients(db_session, s, members=3, regulars=1)
    d = _draw(client, h, audience="club", winners_count=3)
    client.post(f"/api/lucky-club/draws/{d['id']}/lock", headers=h)

    left, joined = made[0], made[3]                     # a member leaves the club, a regular joins it, one renamed
    left.is_club_member, joined.is_club_member, made[1].full_name = False, True, "שם חדש"
    db_session.commit()

    done = client.post(f"/api/lucky-club/draws/{d['id']}/run", headers=h).json()
    names = {p["full_name"] for p in done["participants"]}
    assert names == {"חבר 0", "חבר 1", "חבר 2"}                                  # as they were when it was locked
    assert all(p["was_club_member"] for p in done["participants"])
    assert done["participants_count"] == 3
    assert client.post("/api/lucky-club/audience-count", headers=h, json={"audience": "club"}).json()["count"] == 3
    draw = db_session.get(LuckyDraw, d["id"])
    assert draw.locked_at and draw.drawn_at and draw.drawn_by
