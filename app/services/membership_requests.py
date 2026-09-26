"""
A client's freeze request from BizFind (classes extras 3).

The client asks to freeze their membership from a date to a return date, and may say why. The request is
checked at once against the same rules as a freeze the staff make (membership_changes.freeze_problem — the
membership type's rules: allowed at all, shortest freeze, days and freezes left), so the client hears
right away when it cannot be. Then the owner's choice (freeze_requests):
- manual (the default): the owner's bell rings; the owner approves — the freeze is made as if the staff
  made it, and the client gets the usual "frozen" message — or rejects with a reason, and the client is told;
- auto: approved by itself (it is already inside the rules);
- off: no requests — a freeze only through the business.
One pending request per membership; the client may withdraw it while it waits.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.memberships import Membership, MembershipRequest
from app.services import classes as svc
from app.services import membership_changes as changes
from app.services import memberships as ms
from app.services import notifications, policies


def _d(day) -> str:
    return f"{day.day}/{day.month}"


def pending(db: Session, membership_id) -> MembershipRequest | None:
    return db.scalar(select(MembershipRequest).where(MembershipRequest.membership_id == membership_id,
                                                     MembershipRequest.status == "pending"))


def hidden(db: Session, m: Membership) -> bool:
    """No asking at all — the owner allows no requests, or the membership's type allows no freeze."""
    return policies.get_policy(db, m.studio_id, "freeze_requests") == "off" or m.rules.get("freeze_allowed") is False


def why_not_ask(db: Session, m: Membership) -> str | None:
    """Why this client cannot ask for a freeze of this membership now (None: they can)."""
    if policies.get_policy(db, m.studio_id, "freeze_requests") == "off":
        return "הקפאה אפשרית רק דרך העסק"
    if changes._status(db, m) != "active":
        return "אפשר לבקש הקפאה למנוי פעיל"
    r = m.rules
    if r.get("freeze_allowed") is False:
        return "סוג המנוי הזה לא מאפשר הקפאה"
    used, count = changes.freeze_usage(db, m)
    if r.get("freeze_max_count") and count >= r["freeze_max_count"]:
        return "נוצלו כל ההקפאות במנוי הזה"
    if r.get("freeze_max_days") and used >= r["freeze_max_days"]:
        return "נוצלו כל ימי ההקפאה במנוי הזה"
    return None


def ask_freeze(db: Session, m: Membership, from_on, until_on, note: str | None = None) -> MembershipRequest:
    """The client's request. Refused at once when the rules say no; approved by itself when the owner chose so."""
    why = why_not_ask(db, m)
    if why:
        raise ms.MembershipError(why)
    if pending(db, m.id):
        raise ms.MembershipError("כבר יש בקשת הקפאה שמחכה לתשובה")
    problem = changes.freeze_problem(db, m, from_on, until_on)
    if problem:
        raise ms.MembershipError(problem)
    req = MembershipRequest(studio_id=m.studio_id, membership_id=m.id, client_id=m.client_id, kind="freeze",
                            from_on=from_on, until_on=until_on, note=(note or "").strip()[:300] or None)
    db.add(req)
    db.flush()
    if policies.get_policy(db, m.studio_id, "freeze_requests") == "auto":
        approve(db, req, auto=True)
    else:
        from app.models.client import Client
        notifications.notify(db, m.studio_id, "freeze_requested", origin="user", about=f"membership_request:{req.id}",
                             context={"client_name": db.get(Client, m.client_id).full_name or "", "request_word": "הקפאה"})
    return req


def approve(db: Session, req: MembershipRequest, *, user_id=None, role: str | None = None, auto: bool = False) -> dict:
    """The freeze is made as if the staff made it (its rules checked again now), and the client is told."""
    if req.status != "pending":
        raise ms.MembershipError("הבקשה כבר טופלה")
    m = db.get(Membership, req.membership_id)
    reason = ("בקשת הלקוח/ה" + (f": {req.note}" if req.note else ""))[:300]
    result = changes.freeze(db, m, req.from_on, req.until_on, reason=reason, user_id=user_id, role=role)
    req.status, req.decided_at, req.decided_by = "approved", svc.now_utc(), user_id
    req.decision_note = "אושר אוטומטית — בתוך כללי המנוי" if auto else None
    db.flush()
    return result


def reject(db: Session, req: MembershipRequest, reason: str | None = None, *, user_id=None) -> None:
    if req.status != "pending":
        raise ms.MembershipError("הבקשה כבר טופלה")
    from app.models.client import Client
    req.status, req.decided_at, req.decided_by = "rejected", svc.now_utc(), user_id
    req.decision_note = (reason or "").strip()[:300] or None
    note = f"בקשת ההקפאה שלך ({_d(req.from_on)}–{_d(req.until_on)}) לא אושרה" + (f": {req.decision_note}" if req.decision_note else ".")
    notifications.notify(db, req.studio_id, "freeze_request_declined", origin="user", about=f"membership_request:{req.id}:rejected",
                         context={"request_note": note}, clients=[db.get(Client, req.client_id)])
    db.flush()


def withdraw(db: Session, req: MembershipRequest) -> None:
    """The client takes back a request that still waits."""
    if req.status != "pending":
        raise ms.MembershipError("הבקשה כבר טופלה")
    req.status, req.decided_at = "withdrawn", svc.now_utc()
    db.flush()


def waiting(db: Session, studio_id) -> list[dict]:
    """The business's requests that wait for an answer — each checked against the rules as of now."""
    from app.models.client import Client
    out = []
    for req, m, c in db.execute(select(MembershipRequest, Membership, Client)
                                .join(Membership, Membership.id == MembershipRequest.membership_id)
                                .join(Client, Client.id == MembershipRequest.client_id)
                                .where(MembershipRequest.studio_id == studio_id, MembershipRequest.status == "pending")
                                .order_by(MembershipRequest.created_at)).all():
        out.append({"id": str(req.id), "membership_id": str(m.id), "client_name": c.full_name, "client_phone": c.phone,
                    "membership_name": m.rules.get("name"), "from_on": req.from_on.isoformat(), "until_on": req.until_on.isoformat(),
                    "days": (req.until_on - req.from_on).days, "note": req.note, "created_at": req.created_at.isoformat(),
                    "fee_cents": m.rules.get("freeze_fee_cents") or 0,
                    "problem": changes.freeze_problem(db, m, req.from_on, req.until_on)})
    return out
