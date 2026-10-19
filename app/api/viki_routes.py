"""ויקי — the business's personal assistant (services/viki). The owner's, and a manager's the owner let see the money.

GET  /api/viki                 — {suggestions: the first few not answered, more: how many else, summary: the week's or
                                  the month's (services/viki_summary) | null}
POST /api/viki/answer          — {key, kind: done|not_relevant} — it won't come back to this user
GET  /api/viki/moments?since=  — what just happened, for her to pop in with
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext
from app.core.permissions import require_permission
from app.models.viki_dismissal import VikiDismissal
from app.services import viki

router = APIRouter(prefix="/viki", tags=["Viki"])


class AnswerIn(BaseModel):
    key: str = Field(..., min_length=1, max_length=80)
    kind: Literal["done", "not_relevant"]


def _lang(request: Request) -> str:
    from app.core.i18n import lang_of
    return lang_of(request.headers.get("x-lang"))


@router.get("")
def get_suggestions(request: Request, ctx: AuthContext = Depends(require_permission("money")), db: Session = Depends(get_db)):
    from app.services.viki_summary import latest
    left = viki.for_user(db, ctx.studio_id, ctx.user_id, _lang(request))
    return {"suggestions": left[:viki.SHOWN], "more": max(0, len(left) - viki.SHOWN), "summary": latest(db, ctx.studio_id)}


@router.post("/answer", status_code=204)
def answer(body: AnswerIn, ctx: AuthContext = Depends(require_permission("money")), db: Session = Depends(get_db)):
    row = db.scalar(select(VikiDismissal).where(VikiDismissal.user_id == ctx.user_id, VikiDismissal.key == body.key))
    if row is None:
        db.add(VikiDismissal(studio_id=ctx.studio_id, user_id=ctx.user_id, key=body.key, kind=body.kind))
    else:
        row.kind = body.kind
    db.commit()


@router.get("/moments")
def get_moments(request: Request, since: datetime = Query(...), ctx: AuthContext = Depends(require_permission("money")),
                db: Session = Depends(get_db)):
    since = since if since.tzinfo else since.replace(tzinfo=timezone.utc)
    return {"now": datetime.now(timezone.utc).isoformat(), "moments": viki.moments(db, ctx.studio_id, since, lang=_lang(request))}
