"""BizFind reviews. A review sent from a business's BizFind page must be saved and wait for the
owner's approval. It returned 422 for every submission (the body was read as a query parameter —
the rate limiter's wrapper with postponed annotations; found 2026-09-25) and the form still said
"sent". Since 2026-09-28 a review is written signed in, after agreeing to the review rules
(test_review_moderation.py)."""
import uuid

from sqlalchemy import select, text

from app.api.marketplace_customer_routes import _make_token
from app.models.studio_review import StudioReview
from app.models.studio import Studio
from tests.conftest import register_and_login


def test_a_review_from_bizfind_is_saved_for_the_owner_to_approve(client, db_session):
    register_and_login(client, slug="reviewed", email="owner@reviewed.com")
    cid = str(uuid.uuid4())
    db_session.execute(text("INSERT INTO marketplace_customers (id, email, first_name) VALUES (:id, 'dana@x.com', 'דנה')"), {"id": cid})
    db_session.commit()
    me = {"Authorization": f"Bearer {_make_token(cid)}"}
    r = client.post("/api/marketplace/reviewed/reviews", headers=me,
                    json={"client_name": "דנה", "rating": 5, "comment": "מעולה", "accept_rules": True})
    assert r.status_code == 201, r.text
    s = db_session.scalar(select(Studio).where(Studio.slug == "reviewed"))
    saved = db_session.scalars(select(StudioReview).where(StudioReview.studio_id == s.id)).all()
    assert [(x.client_name, x.rating, x.is_approved, str(x.customer_id)) for x in saved] == [("דנה", 5, False, cid)]
    bad = client.post("/api/marketplace/reviewed/reviews", headers=me, json={"client_name": "דנה", "rating": 9})
    assert bad.status_code == 422                                   # a rating outside 1–5 is refused
