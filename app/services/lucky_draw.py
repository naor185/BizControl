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
deleted clients never take part. Everything is the business's own (studio_id).

The prizes (the owner, 2026-11-04): a gift (its words — the owner marks it given), points (into the club card the
moment the draw runs), or a percent off (a personal code, once, in the till's and the payment's code field —
services/coupons). Each may have days to use it in: the last day is kept on the winner; past it a gift or a code
expires, and prize points not spent by then are taken back (sweep, daily). The winners hear it on WhatsApp when the
owner sends it (notify) — not at the draw, so their phones don't give the wheel away; ויקי reminds the owner of a
prize not used a week before its end (services/viki)."""
from __future__ import annotations

import secrets
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.lucky_draw import LuckyDraw, LuckyDrawParticipant, LuckyDrawPrize, LuckyDrawWinner
from app.models.user import User

MAX_WINNERS = 3                       # the owner's first version: one to three winners (the database allows up to 10)
AUDIENCES = ("club", "regular", "all", "manual")
KINDS = ("gift", "points", "percent")
POINTS_GIVEN = "Lucky Club — פרס בהגרלה"               # the ledger's line for prize points (and its taking back)
POINTS_TAKEN = "Lucky Club — פג תוקף נקודות הפרס"
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"        # no 0/O, 1/I — a code read out loud at the till


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

def _get(db: Session, studio_id, draw_id, *, lock: bool = False, hidden: bool = False) -> LuckyDraw:
    """A draw of the business — not one deleted from the history (hidden), unless asked for (its winners' prizes)."""
    q = select(LuckyDraw).where(LuckyDraw.id == draw_id, LuckyDraw.studio_id == studio_id)
    if not hidden:
        q = q.where(LuckyDraw.hidden_at.is_(None))
    draw = db.scalar(q.with_for_update() if lock else q)
    if draw is None:
        raise DrawError("ההגרלה לא נמצאה", 404)
    return draw


def default_title(kind: str, value: int | None) -> str:
    """What a points or a percent prize is called when the owner wrote no words of their own."""
    if kind == "points" and value:
        return f"{value} נקודות"
    if kind == "percent" and value:
        return f"{value}% הנחה"
    return ""


def _prize(p: dict) -> dict:
    """A prize from the screen, checked: its place, words, kind, value and days to use it."""
    place, title = int(p.get("place") or 0), (p.get("title") or "").strip()
    kind = p.get("kind") or "gift"
    if kind not in KINDS:
        raise DrawError("סוג פרס לא מוכר")
    raw = p.get("value")
    value = int(raw) if raw not in (None, "") else None
    if kind == "points" and not (value and 1 <= value <= 100_000):
        raise DrawError(f"כמה נקודות בפרס למקום {place}? בין 1 ל-100,000")
    if kind == "percent" and not (value and 1 <= value <= 100):
        raise DrawError(f"אחוז ההנחה בפרס למקום {place}: בין 1 ל-100")
    if kind == "gift":
        value = None
    raw = p.get("valid_days")
    days = int(raw) if raw not in (None, "") else None
    if days is not None and not 1 <= days <= 3650:
        raise DrawError("זמן למימוש הפרס: בין יום אחד ל-3,650 ימים")
    return {"place": place, "title": (title or default_title(kind, value))[:160], "kind": kind, "value": value,
            "valid_days": days, "description": (p.get("description") or "").strip() or None}


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
        for raw in data["prizes"] or []:
            p = _prize(raw)
            if not 1 <= p["place"] <= MAX_WINNERS or p["place"] in seen:
                raise DrawError("מקום לא תקין לפרס")
            seen.add(p["place"])
            if p["title"]:
                db.add(LuckyDrawPrize(studio_id=studio_id, draw_id=draw.id, **p))
    db.flush()
    return draw


def remove(db: Session, studio_id, draw_id) -> tuple[str, str]:
    """A draft, a canceled draw or one already drawn — the managers clear the history (the owner, 2026-11-04). Not a
    locked one: it may be on the screen right now — it is canceled first. A draft or a canceled draw is gone; a drawn
    one only leaves the history — its winners keep their prizes (a code, points, a gift) until they end. The business's
    activity log keeps the line of the draw and of its deleting. Returns its name and status."""
    draw = _get(db, studio_id, draw_id, lock=True)
    if draw.status == "locked":
        raise DrawError("הגרלה נעולה לא מוחקים — קודם מבטלים אותה", 409)
    name, status = draw.name, draw.status
    if status == "done":
        draw.hidden_at = _now()
    else:
        db.delete(draw)
    db.flush()
    return name, status


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
    today = _today()
    for place, p in enumerate(chosen, start=1):
        prize = prizes.get(place)
        kind = prize.kind if prize else "gift"
        w = LuckyDrawWinner(studio_id=studio_id, draw_id=draw.id, place=place, participant_id=p.id,
                            client_id=p.client_id, prize_id=prize.id if prize else None,
                            prize_title=prize.title if prize else "", prize_kind=kind,
                            prize_value=prize.value if prize else None,
                            expires_on=today + timedelta(days=prize.valid_days) if prize and prize.valid_days else None)
        if kind == "percent":
            w.code = _new_code(db, studio_id)
        if kind == "points" and w.prize_value and p.client_id:
            _give_points(db, studio_id, p.client_id, w.prize_value, draw.name)
            if w.expires_on is None:                     # points for good — given, nothing left to use
                w.status, w.redeemed_at = "redeemed", _now()
        db.add(w)
    draw.status, draw.drawn_at, draw.drawn_by = "done", _now(), user_id
    db.flush()
    return draw, False


def _today() -> date:
    from app.services.classes import today_il
    return today_il()


def _new_code(db: Session, studio_id) -> str:
    """A percent prize's personal code — "WIN" and five letters, not any code of the business's already."""
    from app.services.coupons import code_taken
    rnd = secrets.SystemRandom()
    for _ in range(50):
        code = "WIN" + "".join(rnd.choice(CODE_CHARS) for _ in range(5))
        if not code_taken(db, studio_id, code):
            return code
    raise DrawError("לא הצלחנו ליצור קוד הנחה — נסו שוב", 500)


def _give_points(db: Session, studio_id, client_id, points: int, draw_name: str) -> None:
    from app.models.client_points_ledger import ClientPointsLedger
    client = db.scalar(select(Client).where(Client.id == client_id, Client.studio_id == studio_id).with_for_update())
    if client is None:
        return
    client.loyalty_points = int(client.loyalty_points or 0) + points
    db.add(ClientPointsLedger(studio_id=studio_id, client_id=client_id, delta_points=points,
                              reason=f"{POINTS_GIVEN} „{draw_name}”"))


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
        w.status = "expired" if w.expires_on and w.expires_on < _today() else "pending"
        w.redeemed_at, w.redeemed_by = None, None
    db.flush()
    return w


# ── telling the winners ────────────────────────────────────────────────────────

def winner_message(draw_name: str, studio_name: str, w: LuckyDrawWinner, full_name: str) -> str:
    """The WhatsApp to a winner — in Hebrew; one in English goes out in English (services/client_language)."""
    lines = [f"מזל טוב {full_name}! 🎉", f"זכית במקום {w.place} בהגרלה „{draw_name}” של {studio_name}."]
    if w.prize_kind == "points":
        lines.append(f"הפרס שלך: {w.prize_value} נקודות — כבר נכנסו לכרטיס המועדון שלך.")
    elif w.prize_kind == "percent":
        lines += [f"הפרס שלך: {w.prize_value}% הנחה", f"קוד ההנחה שלך: *{w.code}* — מציגים אותו בתשלום."]
    else:
        lines.append(f"הפרס שלך: {w.prize_title}")
    if w.expires_on:
        lines.append(f"אפשר לממש עד {w.expires_on:%d.%m.%Y}.")
    lines.append("נשמח לראות אותך! 💫")
    return "\n".join(lines)


def notify(db: Session, studio_id, draw_id, winner_id=None) -> dict:
    """WhatsApp to the winners — every one not told yet, or one again (winner_id). {sent, no_phone: [names]}."""
    from app.models.message_job import MessageJob
    from app.models.studio import Studio
    draw = _get(db, studio_id, draw_id, hidden=True)
    if draw.status != "done":
        raise DrawError("קודם מגרילים — אחר כך מודיעים לזוכים", 409)
    q = (select(LuckyDrawWinner, LuckyDrawParticipant)
         .join(LuckyDrawParticipant, LuckyDrawParticipant.id == LuckyDrawWinner.participant_id)
         .where(LuckyDrawWinner.draw_id == draw.id).order_by(LuckyDrawWinner.place))
    if winner_id is not None:
        q = q.where(LuckyDrawWinner.id == winner_id)
    else:
        q = q.where(LuckyDrawWinner.notified_at.is_(None))
    rows = db.execute(q).all()
    if winner_id is not None and not rows:
        raise DrawError("הזוכה לא נמצא", 404)
    studio = db.get(Studio, studio_id)
    now = _now()
    sent, no_phone = 0, []
    for w, p in rows:
        client = db.get(Client, w.client_id) if w.client_id else None
        phone = (client.phone if client else None) or p.phone
        if not phone:
            no_phone.append(p.full_name)
            continue
        db.add(MessageJob(studio_id=studio_id, client_id=w.client_id, channel="whatsapp", to_phone=phone,
                          body=winner_message(draw.name, studio.name if studio else "", w,
                                              (client.full_name if client else None) or p.full_name),
                          scheduled_at=now, status="pending", reminder_type="lucky_win"))
        w.notified_at = now
        sent += 1
    db.flush()
    return {"sent": sent, "no_phone": no_phone}


# ── the prizes' end ────────────────────────────────────────────────────────────

def _spent_since(db: Session, studio_id, client_id, since: datetime) -> int:
    """Points the client spent since then — at the till or on a payment (less what a credit gave back); not points
    taken back on a credit, nor prize points that ran out."""
    from app.models.client_points_ledger import ClientPointsLedger as L
    rows = db.execute(select(L.delta_points, L.reason).where(L.studio_id == studio_id, L.client_id == client_id,
                                                             L.created_at >= since)).all()
    spent = sum(-d for d, r in rows if d < 0 and not (r or "").startswith(("זיכוי", POINTS_TAKEN)))
    back = sum(d for d, r in rows if d > 0 and (r or "").startswith("זיכוי — הוחזרו"))
    return max(0, spent - back)


def sweep(db: Session, today: date | None = None) -> int:
    """Daily: prize points spent → the prize is used; a prize past its last day → expired, and prize points not spent
    by then taken back from the card (no more than the card has). Points are counted as spent from the oldest prize on.
    Returns how many prizes changed."""
    from app.models.client_points_ledger import ClientPointsLedger
    today = today or _today()
    changed = 0
    points = db.scalars(select(LuckyDrawWinner).where(LuckyDrawWinner.status == "pending",
                                                      LuckyDrawWinner.prize_kind == "points",
                                                      LuckyDrawWinner.client_id.is_not(None))
                        .order_by(LuckyDrawWinner.created_at)).all()
    by_client: dict = {}
    for w in points:
        by_client.setdefault((w.studio_id, w.client_id), []).append(w)
    for (studio_id, client_id), wins in by_client.items():
        spent = _spent_since(db, studio_id, client_id, wins[0].created_at)
        for w in wins:
            use = min(int(w.prize_value or 0), spent)
            spent -= use
            left = int(w.prize_value or 0) - use
            if left <= 0:
                w.status, w.redeemed_at = "redeemed", _now()
                changed += 1
            elif w.expires_on and w.expires_on < today:
                client = db.scalar(select(Client).where(Client.id == client_id).with_for_update())
                take = min(left, int(client.loyalty_points or 0)) if client else 0
                if take:
                    client.loyalty_points = int(client.loyalty_points or 0) - take
                    draw = db.get(LuckyDraw, w.draw_id)
                    db.add(ClientPointsLedger(studio_id=studio_id, client_id=client_id, delta_points=-take,
                                              reason=f"{POINTS_TAKEN} „{draw.name if draw else ''}”"))
                w.status, w.points_expired = "expired", take
                changed += 1
    for w in db.scalars(select(LuckyDrawWinner).where(LuckyDrawWinner.status == "pending",
                                                      or_(LuckyDrawWinner.prize_kind != "points",
                                                          LuckyDrawWinner.client_id.is_(None)),
                                                      LuckyDrawWinner.expires_on < today)).all():
        w.status = "expired"
        changed += 1
    db.flush()
    return changed


# ── what the screens get ───────────────────────────────────────────────────────

def _name(db: Session, user_id) -> str | None:
    u = db.get(User, user_id) if user_id else None
    return (u.display_name or u.email) if u else None


def _prize_out(w: LuckyDrawWinner) -> dict:
    """A winner's prize as given — its status "expired" from the day after its last day, before the night's sweep."""
    status = "expired" if w.status == "pending" and w.expires_on and w.expires_on < _today() else w.status
    return {"id": str(w.id), "place": w.place, "prize_title": w.prize_title, "prize_kind": w.prize_kind,
            "prize_value": w.prize_value, "code": w.code, "status": status,
            "expires_on": w.expires_on.isoformat() if w.expires_on else None,
            "redeemed_at": w.redeemed_at.isoformat() if w.redeemed_at else None,
            "points_expired": w.points_expired, "notified_at": w.notified_at.isoformat() if w.notified_at else None}


def client_prizes(db: Session, studio_id, client_id) -> list[dict]:
    """What the client won, newest first — for their card in the CRM (a draw deleted from the history too)."""
    rows = db.execute(select(LuckyDrawWinner, LuckyDraw)
                      .join(LuckyDraw, LuckyDraw.id == LuckyDrawWinner.draw_id)
                      .where(LuckyDrawWinner.studio_id == studio_id, LuckyDrawWinner.client_id == client_id)
                      .order_by(LuckyDrawWinner.created_at.desc())).all()
    return [{**_prize_out(w), "draw_id": str(d.id), "draw_name": d.name, "in_history": d.hidden_at is None,
             "drawn_at": d.drawn_at.isoformat() if d.drawn_at else None} for w, d in rows]


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
        "prizes": [{"place": p.place, "title": p.title, "description": p.description, "kind": p.kind,
                    "value": p.value, "valid_days": p.valid_days} for p in prizes],
        "winners": [{**_prize_out(w), "client_id": str(w.client_id) if w.client_id else None,
                     "participant_id": str(p.id), "full_name": p.full_name, "phone": p.phone,
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
    draws = db.scalars(select(LuckyDraw).where(LuckyDraw.studio_id == studio_id, LuckyDraw.hidden_at.is_(None))
                       .order_by(LuckyDraw.created_at.desc())).all()
    return [out(db, d) for d in draws]
