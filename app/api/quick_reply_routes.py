from __future__ import annotations
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.core.features import require_feature
from app.models.quick_reply import QuickReply

router = APIRouter(prefix="/quick-replies", tags=["QuickReplies"])


class QuickReplyIn(BaseModel):
    title: str
    body: str
    shortcut: str | None = None


class QuickReplyOut(BaseModel):
    id: str
    title: str
    body: str
    shortcut: str | None

    class Config:
        from_attributes = True


@router.get("", response_model=list[QuickReplyOut])
def list_quick_replies(
    _: None = Depends(require_feature("quick_replies")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(QuickReply).where(QuickReply.studio_id == ctx.studio_id).order_by(QuickReply.created_at)
    ).all()
    return [QuickReplyOut(id=str(r.id), title=r.title, body=r.body, shortcut=r.shortcut) for r in rows]


@router.post("", response_model=QuickReplyOut, status_code=status.HTTP_201_CREATED)
def create_quick_reply(
    payload: QuickReplyIn,
    _: None = Depends(require_feature("quick_replies")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if not payload.title.strip() or not payload.body.strip():
        raise HTTPException(status_code=400, detail="title and body required")
    row = QuickReply(
        studio_id=ctx.studio_id,
        title=payload.title.strip(),
        body=payload.body.strip(),
        shortcut=payload.shortcut.strip() if payload.shortcut else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return QuickReplyOut(id=str(row.id), title=row.title, body=row.body, shortcut=row.shortcut)


@router.patch("/{qr_id}", response_model=QuickReplyOut)
def update_quick_reply(
    qr_id: uuid.UUID,
    payload: QuickReplyIn,
    _: None = Depends(require_feature("quick_replies")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(QuickReply).where(QuickReply.id == qr_id, QuickReply.studio_id == ctx.studio_id))
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    row.title = payload.title.strip()
    row.body = payload.body.strip()
    row.shortcut = payload.shortcut.strip() if payload.shortcut else None
    db.commit()
    return QuickReplyOut(id=str(row.id), title=row.title, body=row.body, shortcut=row.shortcut)


@router.delete("/{qr_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_quick_reply(
    qr_id: uuid.UUID,
    _: None = Depends(require_feature("quick_replies")),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    row = db.scalar(select(QuickReply).where(QuickReply.id == qr_id, QuickReply.studio_id == ctx.studio_id))
    if row:
        db.delete(row)
        db.commit()
