"""
Memberships (stage 4): membership types, selling a membership to a client, its entry log, a manual
correction and renewal — behind the "memberships" module. The owner's late-cancel / no-show rules and
the fees they record are behind "classes" only (a business without memberships can charge a no-show
too). app/services/memberships.py and app/services/penalties.py do the work.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.core.features import require_module
from app.core.permissions import require_action
from app.models.classes import ClassBooking, ClassSession, ClassTemplate
from app.models.client import Client
from app.models.memberships import KINDS, ClassFee, Membership, MembershipEntry, MembershipType, PenaltyRule
from app.services import class_payments as payments
from app.services import classes as svc
from app.services import memberships as ms
from app.services import penalties, policies

router = APIRouter(prefix="/classes", tags=["Memberships"],
                   dependencies=[Depends(require_module("classes")), Depends(require_module("memberships"))])
rules_router = APIRouter(prefix="/classes", tags=["Memberships"], dependencies=[Depends(require_module("classes"))])


def _get(db: Session, model, studio_id, obj_id, missing: str):
    obj = db.get(model, obj_id)
    if not obj or obj.studio_id != studio_id:
        raise HTTPException(404, missing)
    return obj


def _fail(db: Session, e: ValueError):
    db.rollback()
    raise HTTPException(400, str(e))


# ── membership types ─────────────────────────────────────────────────────────

class TypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str
    price_cents: int = Field(0, ge=0, le=10_000_000)
    duration_days: Optional[int] = Field(None, ge=1, le=3650)
    entries: Optional[int] = Field(None, ge=1, le=500)
    covers_all: bool = True
    covered_templates: list[uuid.UUID] = []
    is_active: bool = True
    freeze_allowed: bool = True
    freeze_max_days: Optional[int] = Field(None, ge=1, le=365)
    freeze_min_days: Optional[int] = Field(None, ge=1, le=365)
    freeze_max_count: Optional[int] = Field(None, ge=1, le=20)
    freeze_fee_cents: int = Field(0, ge=0, le=1_000_000)
    # a family / shared membership — the owner's choices (app/services/membership_family.py)
    max_members: Optional[int] = Field(1, ge=1, le=100)          # 1 = personal; empty = no limit
    entries_mode: str = "shared"
    member_cap: Optional[int] = Field(None, ge=1, le=500)
    pricing: str = "fixed"
    extra_member_cents: int = Field(0, ge=0, le=10_000_000)
    extra_member_percent: int = Field(0, ge=0, le=100)
    booking_by: str = "each"
    members_change: str = "free"


def _check_type(db: Session, studio_id, v: dict) -> dict:
    kind = v.get("kind")
    if kind not in KINDS:
        raise HTTPException(400, "סוג מנוי לא מוכר")
    if kind in ("unlimited", "weekly") and not v.get("duration_days"):
        raise HTTPException(400, "לכמה ימים המנוי?")
    if kind == "weekly" and not (v.get("entries") and v["entries"] <= 14):
        raise HTTPException(400, "כמה כניסות בשבוע? (עד 14)")
    if kind == "punch" and not v.get("entries"):
        raise HTTPException(400, "כמה כניסות בכרטיסייה?")
    if kind == "unlimited":
        v["entries"] = None
    from app.services import membership_family as family
    for field, allowed in (("entries_mode", family.ENTRIES_MODES), ("pricing", family.PRICINGS),
                           ("booking_by", family.BOOKING_BY), ("members_change", family.MEMBERS_CHANGE)):
        if v.get(field) not in allowed:
            raise HTTPException(400, "בחירה לא מוכרת במנוי המשפחתי")
    if kind == "unlimited":
        v["entries_mode"], v["member_cap"] = "shared", None            # no entries to share
    if v["entries_mode"] == "shared_capped":
        if not v.get("member_cap"):
            raise HTTPException(400, "כמה כניסות לכל היותר לכל אחד?")
        if v.get("entries") and v["member_cap"] > v["entries"]:
            raise HTTPException(400, "המקסימום לאדם גדול מהיתרה המשותפת")
    else:
        v["member_cap"] = None
    if not v.get("covers_all"):
        ids = list(dict.fromkeys(v.get("covered_templates") or []))
        if not ids:
            raise HTTPException(400, "בחר אילו שיעורים המנוי כולל")
        found = set(db.scalars(select(ClassTemplate.id).where(ClassTemplate.studio_id == studio_id, ClassTemplate.id.in_(ids))).all())
        if found != set(ids):
            raise HTTPException(400, "שיעור לא נמצא")
        v["covered_templates"] = ids
    else:
        v["covered_templates"] = []
    v["name"] = v["name"].strip()
    return v


def _type_out(t: MembershipType) -> dict:
    return {"id": str(t.id), "name": t.name, "kind": t.kind, "kind_label": ms.KIND_LABELS[t.kind],
            "price_cents": t.price_cents, "duration_days": t.duration_days, "entries": t.entries,
            "covers_all": t.covers_all, "covered_templates": [str(x) for x in t.covered_templates or []],
            "is_active": t.is_active, "freeze_allowed": t.freeze_allowed, "freeze_max_days": t.freeze_max_days,
            "freeze_min_days": t.freeze_min_days, "freeze_max_count": t.freeze_max_count, "freeze_fee_cents": t.freeze_fee_cents,
            "max_members": t.max_members, "entries_mode": t.entries_mode, "member_cap": t.member_cap, "pricing": t.pricing,
            "extra_member_cents": t.extra_member_cents, "extra_member_percent": t.extra_member_percent,
            "booking_by": t.booking_by, "members_change": t.members_change,
            # the price for 1, 2, 3… people — worked out once, here, by the owner's pricing (for the sale screen)
            "family_prices": _family_prices(t)}


def _family_prices(t: MembershipType) -> list[int]:
    from app.services import membership_family as family
    rules = {**family.rules_of(t), "price_cents": t.price_cents}
    return [family.price_for(rules, n) for n in range(1, min(t.max_members or 8, 8) + 1)]


@router.get("/membership-types")
def list_types(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    rows = db.scalars(select(MembershipType).where(MembershipType.studio_id == ctx.studio_id)
                      .order_by(MembershipType.is_active.desc(), MembershipType.name)).all()
    return [_type_out(t) for t in rows]


@router.post("/membership-types")
def create_type(body: TypeIn, ctx: AuthContext = Depends(require_action("classes.configure")), db: Session = Depends(get_db)):
    t = MembershipType(studio_id=ctx.studio_id, **_check_type(db, ctx.studio_id, body.model_dump()))
    db.add(t)
    db.commit()
    return _type_out(t)


@router.patch("/membership-types/{type_id}")
def update_type(type_id: uuid.UUID, body: TypeIn, ctx: AuthContext = Depends(require_action("classes.configure")),
                db: Session = Depends(get_db)):
    """Memberships already sold keep the rules they were sold with."""
    t = _get(db, MembershipType, ctx.studio_id, type_id, "סוג המנוי לא נמצא")
    for k, v in _check_type(db, ctx.studio_id, body.model_dump()).items():
        setattr(t, k, v)
    db.commit()
    return _type_out(t)


# ── memberships ──────────────────────────────────────────────────────────────

def _memberships_out(db: Session, rows: list[Membership]) -> list[dict]:
    from app.services import membership_family as family
    everyone = {m.id: family.people(db, m) for m in rows}
    ids = {c for people in everyone.values() for c in people}
    clients = {c.id: c for c in db.scalars(select(Client).where(Client.id.in_(ids))).all()} if rows else {}
    bals = ms.balance(db, [m.id for m in rows if m.rules.get("kind") == "punch"])
    paid = payments.paid_for_membership(db, [m.id for m in rows])
    today = svc.today_il()
    out = []
    for m in rows:
        c, bal = clients.get(m.client_id), bals.get(m.id)
        out.append({"id": str(m.id), "client_id": str(m.client_id), "client_name": c.full_name if c else "",
                    "client_phone": c.phone if c else None, "type_id": str(m.type_id) if m.type_id else None,
                    "name": m.rules.get("name"), "kind": m.rules.get("kind"),
                    "kind_label": ms.KIND_LABELS.get(m.rules.get("kind"), ""), "weekly_limit": m.rules.get("entries") if m.rules.get("kind") == "weekly" else None,
                    "status": ms.status_now(m, bal, today), "starts_on": m.starts_on.isoformat(),
                    "ends_on": m.ends_on.isoformat() if m.ends_on else None, "price_cents": m.price_cents,
                    "balance": bal, "notes": m.notes, "paid_cents": paid.get(m.id, 0),
                    "freeze_from": m.freeze_from.isoformat() if m.freeze_from else None,
                    "freeze_until": m.freeze_until.isoformat() if m.freeze_until else None,
                    # a family / shared membership: who is on it, and each one's use when each has a limit
                    "is_family": family.is_family(m.rules), "max_members": m.rules.get("max_members", 1),
                    "entries_mode": m.rules.get("entries_mode") or "shared", "booking_by": m.rules.get("booking_by") or "each",
                    "members_change": m.rules.get("members_change") or "free",
                    "members": [{"client_id": str(cid), "full_name": clients[cid].full_name if cid in clients else "",
                                 "phone": clients[cid].phone if cid in clients else None, "holder": cid == m.client_id,
                                 "used": family.person_used(db, m, cid) if m.rules.get("kind") == "punch" and family.is_family(m.rules) else None}
                                for cid in everyone[m.id]]})
    return out


ORDER = {"active": 0, "ending": 1, "pending": 2, "frozen": 3, "expired": 4, "canceled": 5}


@router.get("/memberships")
def list_memberships(client_id: Optional[uuid.UUID] = None, current_only: bool = True,
                     ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if client_id:                        # their own, and the family memberships they are on
        from app.services import membership_family as family
        rows = sorted(family.memberships_of(db, client_id, ctx.studio_id), key=lambda m: m.created_at, reverse=True)
    else:
        rows = list(db.scalars(select(Membership).where(Membership.studio_id == ctx.studio_id)
                               .order_by(Membership.created_at.desc()).limit(500)).all())
    out = _memberships_out(db, rows)
    if current_only and not client_id:
        out = [m for m in out if m["status"] in ("active", "ending", "pending", "frozen")]
    return sorted(out, key=lambda m: (ORDER.get(m["status"], 9), m["ends_on"] or "9999"))


class SellIn(BaseModel):
    client_id: uuid.UUID
    type_id: uuid.UUID
    starts_on: Optional[date] = None
    price_cents: Optional[int] = Field(None, ge=0, le=10_000_000)
    notes: Optional[str] = Field(None, max_length=500)
    members: list[uuid.UUID] = []            # the other people on a family membership


@router.post("/memberships")
def sell_membership(body: SellIn, ctx: AuthContext = Depends(require_action("memberships.sell")), db: Session = Depends(get_db)):
    client = _get(db, Client, ctx.studio_id, body.client_id, "הלקוח לא נמצא")
    t = _get(db, MembershipType, ctx.studio_id, body.type_id, "סוג המנוי לא נמצא")
    if not t.is_active:
        raise HTTPException(400, "סוג המנוי הזה לא נמכר כרגע")
    if body.starts_on and body.starts_on < svc.today_il():
        raise HTTPException(400, "תאריך ההתחלה כבר עבר")
    others = [_get(db, Client, ctx.studio_id, cid, "הלקוח לא נמצא") for cid in dict.fromkeys(body.members) if cid != client.id]
    try:
        m = ms.sell(db, client, t, starts_on=body.starts_on, price_cents=body.price_cents, notes=body.notes, user_id=ctx.user_id,
                    members=others)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return _memberships_out(db, [m])[0]


@router.get("/memberships/{membership_id}")
def get_membership(membership_id: uuid.UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    m = _get(db, Membership, ctx.studio_id, membership_id, "המנוי לא נמצא")
    out = _memberships_out(db, [m])[0]
    lines = db.execute(select(MembershipEntry, ClassSession, ClassTemplate.name)
                       .outerjoin(ClassBooking, ClassBooking.id == MembershipEntry.booking_id)
                       .outerjoin(ClassSession, ClassSession.id == ClassBooking.session_id)
                       .outerjoin(ClassTemplate, ClassTemplate.id == ClassSession.template_id)
                       .where(MembershipEntry.membership_id == m.id).order_by(MembershipEntry.created_at)).all()
    out["entries"] = [{"at": e.created_at.isoformat(), "stage": e.stage, "outcome": e.outcome, "amount": e.amount,
                       "reason": e.reason, "class_name": name,
                       "class_at": s.starts_at.isoformat() if s else None} for e, s, name in lines]
    booked = db.execute(select(ClassBooking, ClassSession, ClassTemplate.name)
                        .join(ClassSession, ClassSession.id == ClassBooking.session_id)
                        .outerjoin(ClassTemplate, ClassTemplate.id == ClassSession.template_id)
                        .where(ClassBooking.membership_id == m.id).order_by(ClassSession.starts_at.desc()).limit(50)).all()
    out["bookings"] = [{"id": str(b.id), "class_name": name or "שיעור", "starts_at": s.starts_at.isoformat(),
                        "status": b.status, "entry_state": b.entry_state} for b, s, name in booked]
    from app.models.memberships import MembershipEvent
    from app.models.user import User
    from app.services import membership_changes as changes
    users = {u.id: (u.display_name or u.email) for u in db.scalars(select(User).where(User.studio_id == ctx.studio_id)).all()}
    out["events"] = [{"at": e.created_at.isoformat(), "action": e.action, "from_status": e.from_status, "to_status": e.to_status,
                      "effective_on": e.effective_on.isoformat() if e.effective_on else None, "days": e.days,
                      "fee_cents": e.fee_cents, "reason": e.reason, "by": users.get(e.by_user) if e.by_user else None}
                     for e in db.scalars(select(MembershipEvent).where(MembershipEvent.membership_id == m.id)
                                         .order_by(MembershipEvent.created_at)).all()]
    used, count = changes.freeze_usage(db, m)
    out["freeze"] = {"allowed": m.rules.get("freeze_allowed", True), "max_days": m.rules.get("freeze_max_days"),
                     "min_days": m.rules.get("freeze_min_days"), "max_count": m.rules.get("freeze_max_count"),
                     "fee_cents": m.rules.get("freeze_fee_cents") or 0, "used_days": used, "count": count}
    out["coming_bookings"] = sum(1 for b in out["bookings"] if b["status"] == "booked" and b["starts_at"] > svc.now_utc().isoformat())
    from app.models.payment import Payment
    out["payments"] = [{"id": str(p.id), "amount_cents": p.amount_cents, "method": p.method, "type": p.type,
                        "created_at": p.created_at.isoformat()}
                       for p in db.scalars(select(Payment).where(Payment.membership_id == m.id, Payment.status == "paid")
                                           .order_by(Payment.created_at)).all()]
    return out


class FreezeIn(BaseModel):
    from_on: date
    until_on: date                     # the return date — required (no "until further notice")
    reason: Optional[str] = Field(None, max_length=300)
    fee_cents: Optional[int] = Field(None, ge=0, le=1_000_000)   # default: the type's freeze fee


class ChangeIn(BaseModel):
    reason: Optional[str] = Field(None, max_length=300)


def _change(db: Session, ctx: AuthContext, membership_id, fn, **kw):
    from app.services import membership_changes as changes
    m = _get(db, Membership, ctx.studio_id, membership_id, "המנוי לא נמצא")
    try:
        getattr(changes, fn)(db, m, user_id=ctx.user_id, role=ctx.role, **kw)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return get_membership(membership_id, ctx, db)


@router.post("/memberships/{membership_id}/freeze")
def freeze_membership(membership_id: uuid.UUID, body: FreezeIn, ctx: AuthContext = Depends(require_action("memberships.change")),
                      db: Session = Depends(get_db)):
    return _change(db, ctx, membership_id, "freeze", from_on=body.from_on, until_on=body.until_on, reason=body.reason,
                   fee_cents=body.fee_cents)


# ── a client's freeze requests from BizFind (app/services/membership_requests.py) ─────────────────

@router.get("/freeze-requests")
def freeze_requests(ctx: AuthContext = Depends(require_action("memberships.change")), db: Session = Depends(get_db)):
    """The requests that wait for an answer — each checked against the membership's rules as of now."""
    from app.services import membership_requests as requests
    return requests.waiting(db, ctx.studio_id)


def _request(db: Session, ctx: AuthContext, request_id, fn, **kw):
    from app.models.memberships import MembershipRequest
    from app.services import membership_requests as requests
    req = _get(db, MembershipRequest, ctx.studio_id, request_id, "הבקשה לא נמצאה")
    try:
        getattr(requests, fn)(db, req, user_id=ctx.user_id, **kw)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return requests.waiting(db, ctx.studio_id)


@router.post("/freeze-requests/{request_id}/approve")
def approve_freeze_request(request_id: uuid.UUID, ctx: AuthContext = Depends(require_action("memberships.change")),
                           db: Session = Depends(get_db)):
    """The freeze is made as if the staff made it; the client gets the usual message."""
    return _request(db, ctx, request_id, "approve", role=ctx.role)


@router.post("/freeze-requests/{request_id}/reject")
def reject_freeze_request(request_id: uuid.UUID, body: ChangeIn, ctx: AuthContext = Depends(require_action("memberships.change")),
                          db: Session = Depends(get_db)):
    """Not approved — the client is told, with the reason when one is given."""
    return _request(db, ctx, request_id, "reject", reason=body.reason)


# ── a family / shared membership's people ─────────────────────────────────────

class MemberIn(BaseModel):
    client_id: uuid.UUID


@router.post("/memberships/{membership_id}/members")
def add_member(membership_id: uuid.UUID, body: MemberIn, ctx: AuthContext = Depends(require_action("memberships.sell")),
               db: Session = Depends(get_db)):
    """Another person on the membership — the price by the owner's rule for adding people."""
    from app.services import membership_family as family
    m = _get(db, Membership, ctx.studio_id, membership_id, "המנוי לא נמצא")
    try:
        family.add(db, m, _get(db, Client, ctx.studio_id, body.client_id, "הלקוח לא נמצא"), user_id=ctx.user_id)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return get_membership(membership_id, ctx, db)


@router.post("/memberships/{membership_id}/members/{client_id}/remove")
def remove_member(membership_id: uuid.UUID, client_id: uuid.UUID, ctx: AuthContext = Depends(require_action("memberships.change")),
                  db: Session = Depends(get_db)):
    """A person off the membership — their coming classes on it are cancelled, the entries go back."""
    from app.services import membership_family as family
    m = _get(db, Membership, ctx.studio_id, membership_id, "המנוי לא נמצא")
    try:
        family.remove(db, m, client_id, user_id=ctx.user_id)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return get_membership(membership_id, ctx, db)


@router.post("/memberships/{membership_id}/unfreeze")
def unfreeze_membership(membership_id: uuid.UUID, ctx: AuthContext = Depends(require_action("memberships.change")),
                        db: Session = Depends(get_db)):
    return _change(db, ctx, membership_id, "unfreeze")


@router.post("/memberships/{membership_id}/stop")
def stop_membership(membership_id: uuid.UUID, body: ChangeIn, ctx: AuthContext = Depends(require_action("memberships.change")),
                    db: Session = Depends(get_db)):
    return _change(db, ctx, membership_id, "stop", reason=body.reason)


@router.post("/memberships/{membership_id}/unstop")
def unstop_membership(membership_id: uuid.UUID, ctx: AuthContext = Depends(require_action("memberships.change")),
                      db: Session = Depends(get_db)):
    return _change(db, ctx, membership_id, "unstop")


@router.post("/memberships/{membership_id}/cancel")
def cancel_membership(membership_id: uuid.UUID, body: ChangeIn, ctx: AuthContext = Depends(require_action("memberships.change")),
                      db: Session = Depends(get_db)):
    return _change(db, ctx, membership_id, "cancel", reason=body.reason)


class PaymentIn(BaseModel):
    amount_cents: int = Field(gt=0, le=10_000_000)
    method: str = "cash"
    external_ref: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=300)
    send_receipt: bool = True


@router.post("/memberships/{membership_id}/payments")
def pay_membership(membership_id: uuid.UUID, body: PaymentIn, ctx: AuthContext = Depends(require_action("memberships.sell")),
                   db: Session = Depends(get_db)):
    """Records a payment for a membership (recorded, not collected) — with its invoice/receipt."""
    m = _get(db, Membership, ctx.studio_id, membership_id, "המנוי לא נמצא")
    try:
        payments.record(db, ctx.studio_id, db.get(Client, m.client_id), amount_cents=body.amount_cents, method=body.method,
                        membership=m, notes=body.notes, external_ref=body.external_ref, send_receipt=body.send_receipt)
    except ValueError as e:
        _fail(db, e)
    return get_membership(membership_id, ctx, db)


class AdjustIn(BaseModel):
    delta: int = Field(ge=-500, le=500)
    reason: str = Field(min_length=1, max_length=160)


@router.post("/memberships/{membership_id}/adjust")
def adjust_entries(membership_id: uuid.UUID, body: AdjustIn, ctx: AuthContext = Depends(require_action("memberships.change")),
                   db: Session = Depends(get_db)):
    m = _get(db, Membership, ctx.studio_id, membership_id, "המנוי לא נמצא")
    try:
        ms.adjust(db, m, body.delta, body.reason, user_id=ctx.user_id)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return _memberships_out(db, [m])[0]


class RenewIn(BaseModel):
    starts_on: Optional[date] = None


@router.post("/memberships/{membership_id}/renew")
def renew_membership(membership_id: uuid.UUID, body: RenewIn, ctx: AuthContext = Depends(require_action("memberships.sell")),
                     db: Session = Depends(get_db)):
    m = _get(db, Membership, ctx.studio_id, membership_id, "המנוי לא נמצא")
    try:
        new = ms.renew(db, m, starts_on=body.starts_on, user_id=ctx.user_id)
    except ValueError as e:
        _fail(db, e)
    db.commit()
    return _memberships_out(db, [new])[0]


# ── the owner's late-cancel / no-show rules (behind "classes" only) ──────────

def _scope(db: Session, studio_id, scope_type: str, scope_id) -> None:
    if scope_type == policies.STUDIO:
        if scope_id is not None:
            raise HTTPException(400, "רמה לא תקינה")
        return
    model = {policies.TEMPLATE: ClassTemplate, policies.MEMBERSHIP: MembershipType}.get(scope_type)
    if model is None or scope_id is None:
        raise HTTPException(400, "רמה לא תקינה")
    _get(db, model, studio_id, scope_id, "לא נמצא")


def _rule_out(r: PenaltyRule) -> dict:
    return {"id": str(r.id), "event": r.event, "from_count": r.from_count, "within_days": r.within_days,
            "action": r.action, "amount_cents": r.amount_cents, "percent": r.percent}


@rules_router.get("/penalty-rules")
def get_rules(scope_type: str = policies.STUDIO, scope_id: Optional[uuid.UUID] = None,
              ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    _scope(db, ctx.studio_id, scope_type, scope_id)
    q = select(PenaltyRule).where(PenaltyRule.studio_id == ctx.studio_id, PenaltyRule.scope_type == scope_type)
    q = q.where(PenaltyRule.scope_id.is_(None)) if scope_id is None else q.where(PenaltyRule.scope_id == scope_id)
    return [_rule_out(r) for r in db.scalars(q.order_by(PenaltyRule.event, PenaltyRule.from_count)).all()]


class RulesIn(BaseModel):
    scope_type: str = policies.STUDIO
    scope_id: Optional[uuid.UUID] = None
    rules: list[dict]


@rules_router.put("/penalty-rules")
def set_rules(body: RulesIn, ctx: AuthContext = Depends(require_action("classes.configure")), db: Session = Depends(get_db)):
    """Replaces the rules of one level. An empty list = this level follows the level above."""
    _scope(db, ctx.studio_id, body.scope_type, body.scope_id)
    try:
        clean = [penalties.validate_rule(r) for r in body.rules[:20]]
    except ValueError as e:
        _fail(db, e)
    q = select(PenaltyRule).where(PenaltyRule.studio_id == ctx.studio_id, PenaltyRule.scope_type == body.scope_type)
    q = q.where(PenaltyRule.scope_id.is_(None)) if body.scope_id is None else q.where(PenaltyRule.scope_id == body.scope_id)
    for old in db.scalars(q).all():
        db.delete(old)
    db.flush()
    for r in clean:
        db.add(PenaltyRule(studio_id=ctx.studio_id, scope_type=body.scope_type, scope_id=body.scope_id, **r))
    db.commit()
    return get_rules(body.scope_type, body.scope_id, ctx, db)


# ── fees (debts the rules recorded) ──────────────────────────────────────────

@rules_router.get("/fees")
def list_fees(status: str = "pending", client_id: Optional[uuid.UUID] = None,
              ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    q = (select(ClassFee, Client.full_name).join(Client, Client.id == ClassFee.client_id)
         .where(ClassFee.studio_id == ctx.studio_id))
    if status != "all":
        q = q.where(ClassFee.status == status)
    if client_id:
        q = q.where(ClassFee.client_id == client_id)
    return [{"id": str(f.id), "client_id": str(f.client_id), "client_name": name, "booking_id": str(f.booking_id),
             "event": f.event, "amount_cents": f.amount_cents, "reason": f.reason, "status": f.status,
             "waive_reason": f.waive_reason, "created_at": f.created_at.isoformat()}
            for f, name in db.execute(q.order_by(ClassFee.created_at.desc()).limit(300)).all()]


class WaiveIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


class FeePayIn(BaseModel):
    method: str = "cash"
    external_ref: Optional[str] = Field(None, max_length=120)
    send_receipt: bool = True


@rules_router.post("/fees/{fee_id}/pay")
def pay_fee(fee_id: uuid.UUID, body: FeePayIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
            db: Session = Depends(get_db)):
    """Records the payment of a fee (its full amount) — the fee becomes paid."""
    f = _get(db, ClassFee, ctx.studio_id, fee_id, "החיוב לא נמצא")
    try:
        payments.record(db, ctx.studio_id, db.get(Client, f.client_id), amount_cents=f.amount_cents, method=body.method,
                        booking=db.get(ClassBooking, f.booking_id), for_fee=True, external_ref=body.external_ref,
                        send_receipt=body.send_receipt)
    except ValueError as e:
        _fail(db, e)
    return {"id": str(f.id), "status": f.status}


@rules_router.post("/bookings/{booking_id}/payments")
def pay_booking(booking_id: uuid.UUID, body: PaymentIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
                db: Session = Depends(get_db)):
    """Records the payment for a single entry (a booking without a membership)."""
    b = _get(db, ClassBooking, ctx.studio_id, booking_id, "ההרשמה לא נמצאה")
    try:
        payments.record(db, ctx.studio_id, db.get(Client, b.client_id), amount_cents=body.amount_cents, method=body.method,
                        booking=b, notes=body.notes, external_ref=body.external_ref, send_receipt=body.send_receipt)
    except ValueError as e:
        _fail(db, e)
    return {"booking_id": str(b.id), "paid_cents": payments.paid_for_bookings(db, [b.id]).get(b.id, 0)}


@rules_router.post("/fees/{fee_id}/waive")
def waive(fee_id: uuid.UUID, body: WaiveIn, ctx: AuthContext = Depends(require_action("memberships.change")),
          db: Session = Depends(get_db)):
    f = _get(db, ClassFee, ctx.studio_id, fee_id, "החיוב לא נמצא")
    if f.status != "pending":
        raise HTTPException(400, "החיוב כבר לא פתוח")
    penalties.waive_fee(db, f.booking_id, body.reason.strip(), user_id=ctx.user_id)
    db.commit()
    return {"id": str(f.id), "status": f.status}
