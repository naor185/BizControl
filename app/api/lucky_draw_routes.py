"""Lucky Club — the business's raffles (services/lucky_draw). The owner and the managers (router.py: no_workers), where
the business has the module (lucky_club, under the club — off when the club is off).

GET    /api/lucky-club/draws                  — every draw, newest first (the history)
POST   /api/lucky-club/draws                  — a new draft
GET    /api/lucky-club/draws/{id}             — one draw, with its participants
PATCH  /api/lucky-club/draws/{id}             — a draft's changes
DELETE /api/lucky-club/draws/{id}             — a draft or a canceled draw deleted; a drawn one leaves the history
POST   /api/lucky-club/draws/{id}/lock        — who takes part is written down
POST   /api/lucky-club/draws/{id}/run         — the winners picked, once; again → the same winners ("already": true)
POST   /api/lucky-club/draws/{id}/cancel      — a locked draw canceled (kept in the history)
POST   /api/lucky-club/draws/{id}/notify      — WhatsApp to the winners not told yet (or one, again)
POST   /api/lucky-club/winners/{id}/redeem    — a prize marked given, or waiting again
GET    /api/lucky-club/clients/{id}/prizes    — what a client won (their card in the CRM)
POST   /api/lucky-club/audience-count         — how many take part in an audience, now
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.features import require_module
from app.services import lucky_draw as ld

router = APIRouter(prefix="/lucky-club", tags=["Lucky Club"], dependencies=[Depends(require_module("lucky_club"))])


class PrizeIn(BaseModel):
    place: int = Field(..., ge=1, le=ld.MAX_WINNERS)
    title: str = Field("", max_length=160)
    description: Optional[str] = Field(None, max_length=1000)
    kind: str = "gift"                               # gift | points | percent
    value: Optional[int] = None                      # the points, or the percent off
    valid_days: Optional[int] = None                 # days to use it, from the draw — none: no end


class DrawIn(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=2000)
    image_url: Optional[str] = Field(None, max_length=500)
    terms: Optional[str] = Field(None, max_length=5000)
    scheduled_at: Optional[datetime] = None
    audience: Optional[str] = None
    winners_count: Optional[int] = None
    manual_client_ids: Optional[list[str]] = Field(None, max_length=5000)
    prizes: Optional[list[PrizeIn]] = Field(None, max_length=ld.MAX_WINNERS)


class CountIn(BaseModel):
    audience: str
    client_ids: Optional[list[str]] = Field(None, max_length=5000)


class RedeemIn(BaseModel):
    redeemed: bool = True


class NotifyIn(BaseModel):
    winner_id: Optional[UUID] = None                 # one winner, again — none: every winner not told yet


def _fail(e: ld.DrawError):
    raise HTTPException(status_code=e.status, detail=e.message)


def _log(db: Session, ctx: AuthContext, text: str) -> None:
    from app.services.activity_log import record
    record(db, ctx, "clients", text)


@router.get("/draws")
def list_draws(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return ld.listing(db, ctx.studio_id)


@router.post("/draws", status_code=201)
def create_draw(body: DrawIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        draw = ld.save(db, ctx.studio_id, ctx.user_id, body.model_dump(exclude_unset=True))
    except ld.DrawError as e:
        db.rollback()
        _fail(e)
    db.commit()
    return ld.out(db, draw, full=True)


@router.get("/draws/{draw_id}")
def get_draw(draw_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        return ld.out(db, ld._get(db, ctx.studio_id, draw_id), full=True)
    except ld.DrawError as e:
        _fail(e)


@router.patch("/draws/{draw_id}")
def update_draw(draw_id: UUID, body: DrawIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        draw = ld.save(db, ctx.studio_id, ctx.user_id, body.model_dump(exclude_unset=True), draw_id=draw_id)
    except ld.DrawError as e:
        db.rollback()
        _fail(e)
    db.commit()
    return ld.out(db, draw, full=True)


@router.delete("/draws/{draw_id}", status_code=204)
def delete_draw(draw_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        name, status = ld.remove(db, ctx.studio_id, draw_id)
    except ld.DrawError as e:
        db.rollback()
        _fail(e)
    db.commit()
    _log(db, ctx, f"מחיקת טיוטת הגרלה „{name}”" if status == "draft" else f"מחיקת הגרלה „{name}” מההיסטוריה"
         + (" — הפרסים נשארים אצל הזוכים" if status == "done" else ""))


@router.post("/draws/{draw_id}/lock")
def lock_draw(draw_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        draw = ld.lock(db, ctx.studio_id, draw_id, ctx.user_id)
    except ld.DrawError as e:
        db.rollback()
        _fail(e)
    db.commit()
    _log(db, ctx, f"הגרלה „{draw.name}” ננעלה · {draw.participants_count} משתתפים")
    return ld.out(db, draw, full=True)


@router.post("/draws/{draw_id}/run")
def run_draw(draw_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        draw, already = ld.run(db, ctx.studio_id, draw_id, ctx.user_id)
    except ld.DrawError as e:
        db.rollback()
        _fail(e)
    db.commit()
    result = ld.out(db, draw, full=True)
    if not already:
        who = " · ".join(f"{w['place']}. {w['full_name']} — {w['prize_title']}" for w in result["winners"])
        _log(db, ctx, f"הגרלה „{draw.name}” בוצעה · {draw.participants_count} משתתפים · {who}")
    return {**result, "already": already}


@router.post("/draws/{draw_id}/cancel")
def cancel_draw(draw_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        draw = ld.cancel(db, ctx.studio_id, draw_id, ctx.user_id)
    except ld.DrawError as e:
        db.rollback()
        _fail(e)
    db.commit()
    _log(db, ctx, f"הגרלה „{draw.name}” בוטלה")
    return ld.out(db, draw, full=True)


@router.post("/winners/{winner_id}/redeem")
def redeem_prize(winner_id: UUID, body: RedeemIn, ctx: AuthContext = Depends(require_studio_ctx),
                 db: Session = Depends(get_db)):
    try:
        w = ld.set_redeemed(db, ctx.studio_id, winner_id, body.redeemed, ctx.user_id)
    except ld.DrawError as e:
        db.rollback()
        _fail(e)
    db.commit()
    draw = ld._get(db, ctx.studio_id, w.draw_id, hidden=True)
    winner = next(x for x in ld.out(db, draw)["winners"] if x["id"] == str(w.id))
    _log(db, ctx, f"הגרלה „{draw.name}” · {winner['full_name']} · {w.prize_title} · "
                  + ("הפרס מומש" if body.redeemed else "הפרס חזר לממתין למימוש"))
    return winner


@router.post("/draws/{draw_id}/notify")
def notify_winners(draw_id: UUID, body: NotifyIn, ctx: AuthContext = Depends(require_studio_ctx),
                   db: Session = Depends(get_db)):
    try:
        result = ld.notify(db, ctx.studio_id, draw_id, body.winner_id)
    except ld.DrawError as e:
        db.rollback()
        _fail(e)
    db.commit()
    if result["sent"]:
        draw = ld._get(db, ctx.studio_id, draw_id, hidden=True)
        _log(db, ctx, f"הגרלה „{draw.name}” · נשלחה הודעת זכייה ל-{result['sent']} זוכים")
    return result


@router.get("/clients/{client_id}/prizes")
def client_prizes(client_id: UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    return ld.client_prizes(db, ctx.studio_id, client_id)


@router.post("/audience-count")
def audience_count(body: CountIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    try:
        return {"count": ld.count_eligible(db, ctx.studio_id, body.audience, body.client_ids)}
    except ld.DrawError as e:
        _fail(e)
