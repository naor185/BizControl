"""
The platform handles reported BizFind reviews (Apple 1.2 — act on a report within 24 hours):
GET  /api/admin/review-reports                     — every shown review with an open report, oldest report first
POST /api/admin/review-reports/{review_id}/keep    — the review stays, its reports are closed
POST /api/admin/review-reports/{review_id}/remove  — the review goes; bar_writer also stops its writer writing reviews
The rules themselves are in app/services/review_moderation.py.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.superadmin_routes import _audit, require_superadmin
from app.core.database import get_db
from app.models.studio import Studio
from app.models.studio_review import StudioReview
from app.models.user import User
from app.services import review_moderation

router = APIRouter(prefix="/admin/review-reports", tags=["SuperAdmin"])


def _review(db: Session, review_id: uuid.UUID) -> StudioReview:
    review = db.get(StudioReview, review_id)
    if not review:
        raise HTTPException(404, "הביקורת לא נמצאה")
    return review


@router.get("")
def list_reported(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return review_moderation.open_reports(db)


@router.post("/{review_id}/keep")
def keep(review_id: uuid.UUID, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    review = _review(db, review_id)
    _audit(db, admin, "review_report_kept", db.get(Studio, review.studio_id), {"review_id": str(review.id)})
    review_moderation.keep(db, review)
    return {"kept": True}


class RemoveIn(BaseModel):
    bar_writer: bool = False


@router.post("/{review_id}/remove")
def remove(review_id: uuid.UUID, payload: RemoveIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    review = _review(db, review_id)
    _audit(db, admin, "review_removed", db.get(Studio, review.studio_id),
           {"review_id": str(review.id), "client_name": review.client_name, "bar_writer": payload.bar_writer})
    review_moderation.remove(db, review, payload.bar_writer)
    return {"removed": True}
