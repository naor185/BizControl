"""Lucky Club — raffles among the business's own clients (the owner, 2026-11-04; module lucky_club, under the club).

A draw goes draft → locked → done (or canceled):
- draft: the owner writes it — name, picture, when, its rules text, who takes part (club members / clients who aren't /
  everyone / chosen by hand), how many win (1–MAX_WINNERS) and a prize for each place. How many take part is counted
  live, from the clients as they are now.
- locked: who takes part is written down (lucky_draw_participants — the client, and their name, phone and club
  membership as they were then). A client who leaves the club afterwards is still in; one who joins isn't.
- done: the server picks the winners once — secrets.SystemRandom (the OS's CSPRNG), each participant once, no one
  twice — under a lock on the draw's row; a second run gets the same winners back, never new ones. The database's
  unique keys forbid two winners in a place and one client winning twice. Winners never change afterwards; only a
  prize's "redeemed" mark (with its date and who marked it).
The wheel on the screen only reveals what the server already picked. The walk-in placeholder ("לקוח מזדמן") and
deleted clients never take part. Everything is the business's own (studio_id)."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.lucky_draw import LuckyDraw, LuckyDrawParticipant, LuckyDrawPrize, LuckyDrawWinner
from app.models.user import User

MAX_WINNERS = 3                       # the owner's first version: one to three winners (the database allows up to 10)
AUDIENCES = ("club", "regular", "all", "manual")


class DrawError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message, self.status = message, status


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── who takes part ─────────────────────────────────────────────────────────────

def _eligible(studio_id, audience: str, manual_ids: list[str] | None):
    """The business's clients who take part in this audience — never the walk-in placeholder or a deleted client."""
    q = select(Client).where(Client.studio_id == studio_id, Client.is_active.is_(True), Client.is_walk_in.is_(False))
    if audience == "club":
        q = q.where(Client.is_club_member.is_(True))
    elif audience == "regular":
        q = q.where(Client.is_club_member.is_(False))
    elif audience == "manual":
        q = q.where(Client.id.in_(_uuids(manual_ids)))
    return q


def _uuids(ids) -> list[uuid.UUID]:
    out = []
    for i in ids or []:
        try:
            out.append(uuid.UUID(str(i)))
        except ValueError:
            raise DrawError("לקוח לא נמצא")
    return out


def count_eligible(db: Session, studio_id, audience: str, manual_ids: list[str] | None = None) -> int:
    if audience not in AUDIENCES:
        raise DrawError("קהל לא מוכר")
    return int(db.scalar(select(func.count()).select_from(_eligible(studio_id, audience, manual_ids).subquery())) or 0)


# ── a draft ────────────────────────────────────────────────────────────────────

def _get(db: Session, studio_id, draw_id, *, lock: bool = False) -> LuckyDraw:
    q = select(LuckyDraw).where(LuckyDraw.id == draw_id, LuckyDraw.studio_id == studio_id)
    draw = db.scalar(q.with_for_update() if lock else q)
    if draw is None:
        raise DrawError("ההגרלה לא נמצאה", 404)
    return draw


def save(db: Session, studio_id, user_id, data: dict, draw_id=None) -> LuckyDraw:
    """A new draft, or a draft's changes (only the fields given). A locked or done draw doesn't change."""
    if draw_id is None:
        draw = LuckyDraw(studio_id=studio_id, created_by=user_id, name="", audience="club", winners_count=1,
                         manual_client_ids=[])
        db.add(draw)
    else:
        draw = _get(db, studio_id, draw_id, lock=True)
        if draw.status != "draft":
            raise DrawError("אפשר לשנות רק הגרלה שעוד לא ננעלה", 409)

    for field in ("name", "description", "image_url", "terms"):
        if field in data:
            value = (data[field] or "").strip() or None
            setattr(draw, field, value if field != "name" else (value or ""))
    if "scheduled_at" in data:
        draw.scheduled_at = data["scheduled_at"]
    if "audience" in data:
        if data["audience"] not in AUDIENCES:
            raise DrawError("קהל לא מוכר")
        draw.audience = data["audience"]
    if "winners_count" in data:
        n = int(data["winners_count"])
        if not 1 <= n <= MAX_WINNERS:
            raise DrawError(f"מספר הזוכים: בין 1 ל-{MAX_WINNERS}")
        draw.winners_count = n
    if "manual_client_ids" in data:
        ids = list(dict.fromkeys(str(i) for i in _uuids(data["manual_client_ids"])))
        found = set(str(c) for c in db.scalars(select(Client.id).where(
            Client.studio_id == studio_id, Client.id.in_(_uuids(ids)))).all())
        if len(found) != len(ids):
            raise DrawError("לקוח לא נמצא")                     # never another business's client
        draw.manual_client_ids = ids
    if not draw.name:
        raise DrawError("שם ההגרלה חובה")

    db.flush()
    if "prizes" in data:
        db.execute(delete(LuckyDrawPrize).where(LuckyDrawPrize.draw_id == draw.id))
        seen = set()
        for p in data["prizes"] or []:
            place, title = int(p.get("place") or 0), (p.get("title") or "").strip()
            if not 1 <= place <= MAX_WINNERS or place in seen:
                raise DrawError("מקום לא תקין לפרס")
            seen.add(place)
            if title:
                db.add(LuckyDrawPrize(studio_id=studio_id, draw_id=draw.id, place=place, title=title[:160],
                                      description=(p.get("description") or "").strip() or None))
    db.flush()
    return draw


def delete_draft(db: Session, studio_id, draw_id) -> str:
    draw = _get(db, studio_id, draw_id, lock=True)
    if draw.status != "draft":
        raise DrawError("אפשר למחוק רק טיוטה — הגרלה נעולה מבטלים", 409)
    name = draw.name
    db.delete(draw)
    db.flush()
    return name


# ── lock, run, cancel ──────────────────────────────────────────────────────────

def lock(db: Session, studio_id, draw_id, user_id) -> LuckyDraw:
    """Write down who takes part, as they are now. From here the list doesn't change."""
    draw = _get(db, studio_id, draw_id, lock=True)
    if draw.status != "draft":
        raise DrawError("ההגרלה כבר נעולה", 409)
    prizes = {p.place for p in db.scalars(select(LuckyDrawPrize).where(LuckyDrawPrize.draw_id == draw.id)).all()}
    for place in range(1, draw.winners_count + 1):
        if place not in prizes:
            raise DrawError(f"חסר פרס למקום {place}")
    clients = db.scalars(_eligible(studio_id, draw.audience, draw.manual_client_ids).order_by(Client.created_at, Client.id)).all()
    if len(clients) < draw.winners_count:
        raise DrawError(f"אין מספיק משתתפים: {len(clients)} משתתפים ל-{draw.winners_count} זוכים")
    for c in clients:
        db.add(LuckyDrawParticipant(studio_id=studio_id, draw_id=draw.id, client_id=c.id,
                                    full_name=(c.full_name or "").strip() or "—", phone=c.phone,
                                    was_club_member=bool(c.is_club_member)))
    draw.status, draw.participants_count = "locked", len(clients)
    draw.locked_at, draw.locked_by = _now(), user_id
    db.flush()
    return draw


def run(db: Session, studio_id, draw_id, user_id) -> tuple[LuckyDraw, bool]:
    """Pick the winners — once. (draw, True) when it was already drawn: the same winners, nothing new picked."""
    draw = _get(db, studio_id, draw_id, lock=True)       # a second run at the same moment waits here, then sees "done"
    if draw.status == "done":
        return draw, True
    if draw.status == "draft":
        raise DrawError("קודם נועלים את ההגרלה", 409)
    if draw.status != "locked":
        raise DrawError("ההגרלה בוטלה", 409)
    participants = db.scalars(select(LuckyDrawParticipant).where(LuckyDrawParticipant.draw_id == draw.id)
                              .order_by(LuckyDrawParticipant.created_at, LuckyDrawParticipant.id)).all()
    prizes = {p.place: p for p in db.scalars(select(LuckyDrawPrize).where(LuckyDrawPrize.draw_id == draw.id)).all()}
    if len(participants) < draw.winners_count:
        raise DrawError("אין מספיק משתתפים", 409)
    chosen = secrets.SystemRandom().sample(participants, draw.winners_count)     # each once, no one twice
    for place, p in enumerate(chosen, start=1):
        prize = prizes.get(place)
        db.add(LuckyDrawWinner(studio_id=studio_id, draw_id=draw.id, place=place, participant_id=p.id,
                               client_id=p.client_id, prize_id=prize.id if prize else None,
                               prize_title=prize.title if prize else ""))
    draw.status, draw.drawn_at, draw.drawn_by = "done", _now(), user_id
    db.flush()
    return draw, False


def cancel(db: Session, studio_id, draw_id, user_id) -> LuckyDraw:
    draw = _get(db, studio_id, draw_id, lock=True)
    if draw.status == "done":
        raise DrawError("הגרלה שבוצעה כבר לא מבטלים", 409)
    if draw.status == "canceled":
        raise DrawError("ההגרלה כבר בוטלה", 409)
    if draw.status == "draft":
        raise DrawError("טיוטה מוחקים, לא מבטלים", 409)
    draw.status, draw.canceled_at, draw.canceled_by = "canceled", _now(), user_id
    db.flush()
    return draw


def set_redeemed(db: Session, studio_id, winner_id, redeemed: bool, user_id) -> LuckyDrawWinner:
    """A prize given (redeemed, with the date and who marked it) or waiting again — the winner stays who it is."""
    w = db.scalar(select(LuckyDrawWinner).where(LuckyDrawWinner.id == winner_id, LuckyDrawWinner.studio_id == studio_id)
                  .with_for_update())
    if w is None:
        raise DrawError("הזוכה לא נמצא", 404)
    if redeemed:
        w.status, w.redeemed_at, w.redeemed_by = "redeemed", _now(), user_id
    else:
        w.status, w.redeemed_at, w.redeemed_by = "pending", None, None
    db.flush()
    return w


# ── what the screens get ───────────────────────────────────────────────────────

def _name(db: Session, user_id) -> str | None:
    u = db.get(User, user_id) if user_id else None
    return (u.display_name or u.email) if u else None


def out(db: Session, draw: LuckyDraw, *, full: bool = False) -> dict:
    """A draw for the screens. full: also its participants (names only — the wheel may be on a TV) and, for a draft
    chosen by hand, the chosen clients."""
    prizes = db.scalars(select(LuckyDrawPrize).where(LuckyDrawPrize.draw_id == draw.id).order_by(LuckyDrawPrize.place)).all()
    rows = db.execute(select(LuckyDrawWinner, LuckyDrawParticipant)
                      .join(LuckyDrawParticipant, LuckyDrawParticipant.id == LuckyDrawWinner.participant_id)
                      .where(LuckyDrawWinner.draw_id == draw.id).order_by(LuckyDrawWinner.place)).all()
    d = {
        "id": str(draw.id), "name": draw.name, "description": draw.description, "image_url": draw.image_url,
        "terms": draw.terms, "scheduled_at": draw.scheduled_at.isoformat() if draw.scheduled_at else None,
        "audience": draw.audience, "winners_count": draw.winners_count, "status": draw.status,
        "participants_count": draw.participants_count if draw.status != "draft"
        else count_eligible(db, draw.studio_id, draw.audience, draw.manual_client_ids),
        "locked_at": draw.locked_at.isoformat() if draw.locked_at else None, "locked_by_name": _name(db, draw.locked_by),
        "drawn_at": draw.drawn_at.isoformat() if draw.drawn_at else None, "drawn_by_name": _name(db, draw.drawn_by),
        "canceled_at": draw.canceled_at.isoformat() if draw.canceled_at else None,
        "created_at": draw.created_at.isoformat() if draw.created_at else None,
        "prizes": [{"place": p.place, "title": p.title, "description": p.description} for p in prizes],
        "winners": [{"id": str(w.id), "place": w.place, "client_id": str(w.client_id) if w.client_id else None,
                     "participant_id": str(p.id), "full_name": p.full_name, "phone": p.phone,
                     "prize_title": w.prize_title, "status": w.status,
                     "redeemed_at": w.redeemed_at.isoformat() if w.redeemed_at else None,
                     "redeemed_by_name": _name(db, w.redeemed_by)} for w, p in rows],
    }
    if full:
        d["participants"] = [
            {"id": str(p.id), "client_id": str(p.client_id) if p.client_id else None, "full_name": p.full_name,
             "was_club_member": p.was_club_member}
            for p in db.scalars(select(LuckyDrawParticipant).where(LuckyDrawParticipant.draw_id == draw.id)
                                .order_by(LuckyDrawParticipant.full_name)).all()]
        chosen = _uuids(draw.manual_client_ids) if draw.audience == "manual" else []
        d["manual_clients"] = [
            {"id": str(c.id), "full_name": c.full_name, "phone": c.phone, "is_club_member": c.is_club_member}
            for c in db.scalars(select(Client).where(Client.studio_id == draw.studio_id, Client.id.in_(chosen))
                                .order_by(Client.full_name)).all()] if chosen else []
    return d


def listing(db: Session, studio_id) -> list[dict]:
    """The business's draws, newest first — the history."""
    draws = db.scalars(select(LuckyDraw).where(LuckyDraw.studio_id == studio_id)
                       .order_by(LuckyDraw.created_at.desc())).all()
    return [out(db, d) for d in draws]
