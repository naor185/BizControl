"""BizFind reviews — what customers write that everyone sees (Apple 1.2): a signed-in customer writes after agreeing to
the rules once; anyone signed in reports a review (hidden for them at once, the business and the platform see it, the
platform gets an e-mail) or blocks its writer; the business keeps or deletes a reported review; the platform removes it
and can bar the writer; deleting a customer's account deletes what they wrote. Local test database; nothing is sent."""
import uuid

from sqlalchemy import select, text

from app.api.marketplace_customer_routes import _make_token
from app.models.studio import Studio
from app.models.studio_review import StudioReview
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services.integration_alerts import PLATFORM_ADMIN_EMAIL
from tests.conftest import SENT, register_and_login


def _business(client, db, slug="reviewed"):
    h = register_and_login(client, slug=slug, email=f"owner@{slug}.com")
    s = db.scalar(select(Studio).where(Studio.slug == slug))
    db.get(StudioSettings, s.id).marketplace_visible = True
    db.commit()
    return h, s


def _customer(db, first, last="כהן"):
    cid = str(uuid.uuid4())
    db.execute(text("INSERT INTO marketplace_customers (id, email, first_name, last_name) VALUES (:id, :e, :f, :l)"),
               {"id": cid, "e": f"{cid[:8]}@x.com", "f": first, "l": last})
    db.commit()
    return {"Authorization": f"Bearer {_make_token(cid)}"}, cid


def _review(db, studio, writer_id=None, name="כותב", comment="טקסט"):
    r = StudioReview(studio_id=studio.id, customer_id=uuid.UUID(writer_id) if writer_id else None, client_name=name,
                     rating=1, comment=comment, is_approved=True)
    db.add(r)
    db.commit()
    return str(r.id)


def _seen(client, slug, headers=None):
    return [r["id"] for r in client.get(f"/api/marketplace/{slug}", headers=headers or {}).json()["reviews"]]


def test_a_signed_in_customer_writes_after_agreeing_to_the_rules(client, db_session):
    h, s = _business(client, db_session)
    a, a_id = _customer(db_session, "יעל")
    b, _ = _customer(db_session, "רון")
    assert client.post("/api/marketplace/reviewed/reviews", json={"rating": 5}).status_code == 401
    first = client.post("/api/marketplace/reviewed/reviews", headers=a, json={"rating": 5, "comment": "מעולה"})
    assert first.status_code == 400 and first.json()["detail"] == "כדי לכתוב ביקורת צריך לאשר את כללי הביקורות"
    assert client.post("/api/marketplace/reviewed/reviews", headers=a,
                       json={"rating": 5, "comment": "מעולה", "accept_rules": True}).status_code == 201

    pending = client.get("/api/marketplace/my/reviews/pending", headers=h).json()
    assert [(r["client_name"], r["is_approved"], r["reports"]) for r in pending] == [("יעל כהן", False, 0)]
    assert _seen(client, "reviewed") == []                                   # shows only once the business approves
    client.post(f"/api/marketplace/my/reviews/{pending[0]['id']}/approve", headers=h)

    mine = client.get("/api/marketplace/reviewed", headers=a).json()
    assert [r["mine"] for r in mine["reviews"]] == [True] and mine["viewer"] == {"terms_accepted": True, "barred": False}
    other = client.get("/api/marketplace/reviewed", headers=b).json()
    assert [r["mine"] for r in other["reviews"]] == [False] and other["viewer"]["terms_accepted"] is False
    assert client.get("/api/marketplace/reviewed").json()["viewer"] is None
    assert client.get("/api/marketplace/reviewed", headers={"Authorization": "Bearer broken"}).status_code == 200


def test_report_and_block_hide_for_that_customer_and_reach_the_business_and_the_platform(client, db_session):
    h, s = _business(client, db_session)
    a, _ = _customer(db_session, "יעל")
    b, _ = _customer(db_session, "רון")
    w, w_id = _customer(db_session, "גס")
    w1, w2 = _review(db_session, s, w_id, comment="פוגעני"), _review(db_session, s, w_id)
    old = _review(db_session, s, None, name="ישן")                            # written before reviews needed a sign-in

    assert client.post(f"/api/marketplace/reviews/{w1}/report", json={"reason": "offensive"}).status_code == 401
    assert client.post(f"/api/marketplace/reviews/{w1}/report", headers=a, json={"reason": "offensive"}).json() == {"hidden": True}
    assert SENT == [("email", PLATFORM_ADMIN_EMAIL)]                          # the platform is told (to the fake sender)
    SENT.clear()
    client.post(f"/api/marketplace/reviews/{w1}/report", headers=a, json={"reason": "spam"})
    assert SENT == []                                                        # once per customer
    assert set(_seen(client, "reviewed", a)) == {w2, old}
    assert set(_seen(client, "reviewed", b)) == {w1, w2, old}                # only the one who reported stops seeing it

    reported = client.get("/api/marketplace/my/reviews/pending", headers=h).json()
    assert [(r["id"], r["is_approved"], r["reports"], r["reasons"]) for r in reported] == [(w1, True, 1, ["פוגעני או מעליב"])]
    assert client.post(f"/api/marketplace/my/reviews/{w1}/keep", headers=h).json() == {"kept": True}
    assert client.get("/api/marketplace/my/reviews/pending", headers=h).json() == []
    assert w1 not in _seen(client, "reviewed", a)                            # kept — still hidden for whoever reported it

    assert client.post(f"/api/marketplace/reviews/{w2}/block", headers=a).json() == {"hidden": True}
    assert set(_seen(client, "reviewed", a)) == {old}                        # every review by that writer
    assert client.post(f"/api/marketplace/reviews/{w2}/block", headers=w).json()["detail"] == "זו הביקורת שלך"
    assert client.post(f"/api/marketplace/reviews/{old}/block", headers=a).json() == {"hidden": True}
    assert _seen(client, "reviewed", a) == []
    assert SENT == [("email", PLATFORM_ADMIN_EMAIL)]                          # no writer to block — the platform looks
    SENT.clear()
    assert client.get("/api/marketplace/my/reviews/pending", headers=h).json()[0]["reasons"] == ["חסימת הכותב"]

    waiting = StudioReview(studio_id=s.id, client_name="ממתין", rating=3, is_approved=False)
    db_session.add(waiting)
    db_session.commit()
    assert client.post(f"/api/marketplace/reviews/{waiting.id}/report", headers=a).status_code == 404


def test_the_platform_removes_a_review_and_bars_its_writer(client, db_session):
    h, s = _business(client, db_session)
    a, _ = _customer(db_session, "יעל")
    w, w_id = _customer(db_session, "גס")
    bad = _review(db_session, s, w_id)
    client.post(f"/api/marketplace/reviews/{bad}/report", headers=a, json={"reason": "offensive"})
    SENT.clear()

    assert client.get("/api/admin/review-reports", headers=h).status_code == 403
    sa = register_and_login(client, slug="platform-sa", email="sa@platform.com")
    db_session.scalar(select(User).where(User.email == "sa@platform.com")).role = "superadmin"
    db_session.commit()
    [row] = client.get("/api/admin/review-reports", headers=sa).json()
    assert (row["id"], row["studio_slug"], row["writer_email"], row["reasons"]) == (bad, "reviewed", f"{w_id[:8]}@x.com", ["פוגעני או מעליב"])

    assert client.post(f"/api/admin/review-reports/{bad}/remove", headers=sa, json={"bar_writer": True}).json() == {"removed": True}
    assert _seen(client, "reviewed") == [] and client.get("/api/admin/review-reports", headers=sa).json() == []
    barred = client.post("/api/marketplace/reviewed/reviews", headers=w, json={"rating": 5, "accept_rules": True})
    assert barred.status_code == 403 and barred.json()["detail"] == "החשבון הזה חסום מכתיבת ביקורות"
    assert client.get("/api/marketplace/reviewed", headers=w).json()["viewer"]["barred"] is True


def test_deleting_a_customer_deletes_their_reviews_reports_and_blocks(client, db_session):
    h, s = _business(client, db_session)
    a, a_id = _customer(db_session, "יעל")
    w, w_id = _customer(db_session, "גס")
    kept = _review(db_session, s, None)
    theirs = _review(db_session, s, w_id)
    client.post(f"/api/marketplace/reviews/{kept}/report", headers=a)
    client.post(f"/api/marketplace/reviews/{theirs}/block", headers=a)
    SENT.clear()

    assert client.delete("/api/marketplace/auth/me", headers=w).status_code == 204
    assert _seen(client, "reviewed") == [kept]                               # what they wrote goes with the account
    assert db_session.execute(text("SELECT count(*) FROM customer_blocks")).scalar() == 0
    assert client.delete("/api/marketplace/auth/me", headers=a).status_code == 204
    assert db_session.execute(text("SELECT count(*) FROM review_reports")).scalar() == 0
