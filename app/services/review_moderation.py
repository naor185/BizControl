"""
BizFind reviews — the one thing customers write that everyone sees (Apple 1.2), and its rules in one place:
- writing: a signed-in customer who agreed to the review rules once, and whom the platform hasn't barred;
  the business still approves every review before it shows;
- report: any signed-in customer — the review disappears for them at once, the business sees it among its reviews
  to handle, and the platform is e-mailed so it can act within 24 hours;
- block: none of the writer's reviews show for the customer who blocked them (an older review with no known writer
  hides just that review, recorded as a report);
- handling: keep the review (its reports are closed) or remove it — the platform can also bar its writer.
"""
from __future__ import annotations

import logging
import uuid
from html import escape

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.sites import BIZCONTROL_URL
from app.models.studio_review import StudioReview

logger = logging.getLogger(__name__)

# why a review was reported — the key is stored, the words are shown
REASONS = {"offensive": "פוגעני או מעליב", "spam": "ספאם או פרסומת", "false": "לא אמיתי", "other": "אחר"}
BLOCK = "block"                           # an older review with no known writer, blocked: hidden as a report
REASON_WORDS = {**REASONS, BLOCK: "חסימת הכותב"}


def viewer(db: Session, customer_id: str | None) -> dict | None:
    """What the business page needs to know about the signed-in customer looking at it."""
    if not customer_id:
        return None
    row = db.execute(text("SELECT review_terms_accepted_at, reviews_barred_at FROM marketplace_customers WHERE id = :c"),
                     {"c": customer_id}).fetchone()
    if not row:
        return None
    return {"terms_accepted": row[0] is not None, "barred": row[1] is not None}


def hidden_for(db: Session, customer_id: str | None) -> set[str]:
    """The reviews this customer doesn't see: the ones they reported, and every review by a writer they blocked."""
    if not customer_id:
        return set()
    rows = db.execute(text("""
        SELECT review_id FROM review_reports WHERE customer_id = :c
        UNION
        SELECT r.id FROM studio_reviews r JOIN customer_blocks b ON b.blocked_customer_id = r.customer_id
        WHERE b.customer_id = :c
    """), {"c": customer_id}).fetchall()
    return {str(r[0]) for r in rows}


def write(db: Session, studio_id, customer_id: str, rating: int, comment: str | None, name: str | None,
          accept_rules: bool) -> StudioReview:
    """A new review, waiting for the business's approval. The first time, the customer must agree to the rules."""
    row = db.execute(text("""
        SELECT first_name, last_name, review_terms_accepted_at, reviews_barred_at FROM marketplace_customers WHERE id = :c
    """), {"c": customer_id}).fetchone()
    if not row:
        raise HTTPException(401, "לא מחובר")
    if row[3] is not None:
        raise HTTPException(403, "החשבון הזה חסום מכתיבת ביקורות")
    if row[2] is None:
        if not accept_rules:
            raise HTTPException(400, "כדי לכתוב ביקורת צריך לאשר את כללי הביקורות")
        db.execute(text("UPDATE marketplace_customers SET review_terms_accepted_at = NOW() WHERE id = :c"), {"c": customer_id})
    shown = (name or "").strip() or f"{row[0] or ''} {row[1] or ''}".strip() or "לקוח/ה"
    review = StudioReview(studio_id=studio_id, customer_id=uuid.UUID(customer_id), client_name=escape(shown)[:120],
                          rating=rating, comment=escape(comment) if comment else None, is_approved=False)
    db.add(review)
    db.commit()
    return review


def _shown_review(db: Session, review_id: uuid.UUID) -> StudioReview:
    review = db.get(StudioReview, review_id)
    if not review or not review.is_approved:
        raise HTTPException(404, "הביקורת לא נמצאה")
    return review


def _add_report(db: Session, review: StudioReview, customer_id: str, reason: str) -> bool:
    """True when this customer hadn't reported it yet."""
    return db.execute(text("""
        INSERT INTO review_reports (review_id, customer_id, reason) VALUES (:r, :c, :why)
        ON CONFLICT (review_id, customer_id) DO NOTHING RETURNING id
    """), {"r": str(review.id), "c": customer_id, "why": reason}).fetchone() is not None


def report(db: Session, review_id: uuid.UUID, customer_id: str, reason: str | None) -> None:
    review = _shown_review(db, review_id)
    reason = reason if reason in REASONS else "other"
    new = _add_report(db, review, customer_id, reason)
    db.commit()
    if new:
        _tell_platform(db, review, REASONS[reason])


def block(db: Session, review_id: uuid.UUID, customer_id: str) -> None:
    review = _shown_review(db, review_id)
    if review.customer_id is None:                    # an older review — hide it and let the platform look at it
        new = _add_report(db, review, customer_id, BLOCK)
        db.commit()
        if new:
            _tell_platform(db, review, REASON_WORDS[BLOCK])
        return
    if str(review.customer_id) == customer_id:
        raise HTTPException(400, "זו הביקורת שלך")
    db.execute(text("""
        INSERT INTO customer_blocks (customer_id, blocked_customer_id) VALUES (:c, :w) ON CONFLICT DO NOTHING
    """), {"c": customer_id, "w": str(review.customer_id)})
    db.commit()


def open_reports(db: Session, studio_id=None) -> list[dict]:
    """Shown reviews with reports nobody handled yet — one business's, or all of them (the platform)."""
    rows = db.execute(text(f"""
        SELECT r.id, r.studio_id, s.name, s.slug, r.client_name, r.rating, r.comment, r.created_at, mc.email,
               count(rr.id), array_agg(DISTINCT rr.reason), min(rr.created_at)
        FROM studio_reviews r
        JOIN review_reports rr ON rr.review_id = r.id AND rr.handled_at IS NULL
        JOIN studios s ON s.id = r.studio_id
        LEFT JOIN marketplace_customers mc ON mc.id = r.customer_id
        WHERE r.is_approved {"AND r.studio_id = :s" if studio_id else ""}
        GROUP BY r.id, s.name, s.slug, mc.email
        ORDER BY min(rr.created_at)
    """), {"s": str(studio_id)} if studio_id else {}).fetchall()
    return [{
        "id": str(r[0]), "studio_id": str(r[1]), "studio_name": r[2], "studio_slug": r[3],
        "client_name": r[4], "rating": r[5], "comment": r[6], "created_at": r[7].isoformat(),
        "writer_email": r[8], "reports": r[9], "reasons": [REASON_WORDS.get(x, x) for x in r[10] if x],
        "first_reported_at": r[11].isoformat(),
    } for r in rows]


def keep(db: Session, review: StudioReview) -> None:
    """The review stays — its open reports are closed (whoever reported it still doesn't see it)."""
    db.execute(text("UPDATE review_reports SET handled_at = NOW() WHERE review_id = :r AND handled_at IS NULL"),
               {"r": str(review.id)})
    db.commit()


def remove(db: Session, review: StudioReview, bar_writer: bool = False) -> None:
    """The review goes (its reports with it); with bar_writer its writer can't write reviews any more."""
    if bar_writer and review.customer_id:
        db.execute(text("UPDATE marketplace_customers SET reviews_barred_at = NOW() WHERE id = :c"),
                   {"c": str(review.customer_id)})
    db.delete(review)
    db.commit()


def _tell_platform(db: Session, review: StudioReview, why: str) -> None:
    """E-mail the platform so it can act within 24 hours. Best effort — a failed e-mail never fails the report."""
    try:
        from app.models.studio import Studio
        from app.services.email_center import send_email
        from app.services.integration_alerts import PLATFORM_ADMIN_EMAIL
        studio = db.get(Studio, review.studio_id)
        html = f"""
        <div dir="rtl" style="font-family:Arial,sans-serif;padding:20px">
            <h2>דיווח על ביקורת ב-BizFind</h2>
            <p><b>העסק:</b> {escape(studio.name if studio else "")}<br><b>הסיבה:</b> {escape(why)}</p>
            <p><b>{review.client_name}</b> — {"★" * review.rating}<br>{review.comment or ""}</p>
            <p>הביקורת הוסתרה אצל מי שדיווח. יש לטפל תוך 24 שעות:
               <a href="{BIZCONTROL_URL}/admin/review-reports">ביקורות שדווחו</a></p>
        </div>
        """
        send_email(db, to_email=PLATFORM_ADMIN_EMAIL, subject=f"BizFind — דיווח על ביקורת ({why})", html_content=html,
                   from_name="BizFind", studio_id=str(review.studio_id), template_key="review_report", email_type="system")
    except Exception as e:
        logger.error("review report e-mail failed for %s: %s", review.id, e)
