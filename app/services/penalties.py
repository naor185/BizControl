"""
The owner's late-cancel and no-show rules — nothing is fixed in code.

A rule: for an event (late_cancel / no_show), from the Nth time within X days (empty = ever), do an
action: nothing, warn (a message), consume the entry, or record a fee — fixed, a percent of the class
price or the full price (the price of the class's service). Rules live at a level: a class template,
a membership type, the business; the most specific level that has rules for the event wins (a costly
workshop keeps its rules whatever the client's membership — the owner's decision, 2026-09-24). With no
rules at any level: the entry is consumed and nothing is charged (the plan's default).

The Nth time is counted per client: earlier events of the same kind in the rule's window, not
counting justified ones or classes the business cancelled, plus this one. Of the rules that apply,
the one with the highest "from" wins (e.g. 1st = warn, 2nd within 30 days = 50%).

What an action does to the entry: consume → consumed; anything else → returned (a fee or a warning
is the penalty). A fee is a debt on the client (class_fees) until paid or waived; the client gets a
message (late_fee) for a warning or a fee.
"""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.classes import ClassBooking, ClassSession, ClassTemplate
from app.models.memberships import ClassFee, Membership, PenaltyRule
from app.services import classes as svc
from app.services import memberships as ms
from app.services import notifications, policies

EVENTS = {"late_cancel": "ביטול מאוחר", "no_show": "אי-הגעה"}
ACTIONS = ("nothing", "warn", "consume", "fixed", "percent", "full")
DEFAULT_ACTION = "consume"
AUTO_WAIVE = "הנוכחות שונתה"          # a fee waived because attendance changed — restored if it changes back


def level_rules(db: Session, studio_id, event: str, template_id, membership_type_id) -> list[PenaltyRule]:
    wanted = {policies.TEMPLATE: template_id, policies.MEMBERSHIP: membership_type_id, policies.STUDIO: None}
    for scope in policies.PRECEDENCE:
        if scope != policies.STUDIO and wanted[scope] is None:
            continue
        q = select(PenaltyRule).where(PenaltyRule.studio_id == studio_id, PenaltyRule.event == event,
                                      PenaltyRule.scope_type == scope)
        q = q.where(PenaltyRule.scope_id.is_(None)) if scope == policies.STUDIO else q.where(PenaltyRule.scope_id == wanted[scope])
        rows = db.scalars(q).all()
        if rows:
            return list(rows)
    return []


def earlier(db: Session, booking: ClassBooking, event: str, within_days: int | None) -> int:
    """This client's earlier events of the kind (not justified, the class not cancelled by the business)."""
    status = "late_canceled" if event == "late_cancel" else "no_show"
    when = ClassBooking.canceled_at if event == "late_cancel" else ClassBooking.marked_at
    q = (select(func.count()).select_from(ClassBooking).join(ClassSession, ClassSession.id == ClassBooking.session_id)
         .where(ClassBooking.client_id == booking.client_id, ClassBooking.id != booking.id, ClassBooking.status == status,
                ClassBooking.justified.is_(False), ClassSession.status.in_(("scheduled", "done"))))
    if within_days:
        q = q.where(or_(when.is_(None), when >= svc.now_utc() - timedelta(days=within_days)))
    return db.scalar(q) or 0


def decide(db: Session, booking: ClassBooking, event: str) -> tuple[str, PenaltyRule | None]:
    s = db.get(ClassSession, booking.session_id)
    m = db.get(Membership, booking.membership_id) if booking.membership_id else None
    rules = level_rules(db, s.studio_id, event, s.template_id, m.type_id if m else None)
    if not rules:
        return DEFAULT_ACTION, None
    apply = [r for r in rules if earlier(db, booking, event, r.within_days) + 1 >= r.from_count]
    if not apply:
        return "nothing", None
    rule = max(apply, key=lambda r: r.from_count)
    return rule.action, rule


def class_price(db: Session, session: ClassSession) -> int:
    from app.models.service import Service
    t = db.get(ClassTemplate, session.template_id) if session.template_id else None
    service = db.get(Service, t.service_id) if t and t.service_id else None
    return service.price_cents if service else 0


def fee_amount(db: Session, rule: PenaltyRule, session: ClassSession) -> int:
    if rule.action == "fixed":
        return rule.amount_cents or 0
    if rule.action == "percent":
        return round(class_price(db, session) * (rule.percent or 0) / 100)
    if rule.action == "full":
        return class_price(db, session)
    return 0


def apply(db: Session, booking: ClassBooking, event: str, *, user_id=None, origin: str = "user") -> str:
    """Applies the owner's rule to a late cancellation or a no-show. Returns the action taken."""
    from app.models.client import Client
    s = db.get(ClassSession, booking.session_id)
    action, rule = decide(db, booking, event)
    booking.policy_action = action
    ms.settle(db, booking, "consume" if action == "consume" else "return", reason=f"{EVENTS[event]} — לפי מדיניות הביטולים",
              user_id=user_id)
    ctx = svc._context(db, s)
    note = None
    if action in ("fixed", "percent", "full") and rule is not None:
        amount = fee_amount(db, rule, s)
        fee = db.scalar(select(ClassFee).where(ClassFee.booking_id == booking.id))
        if fee and fee.status == "waived" and fee.waive_reason == AUTO_WAIVE:
            fee.status, fee.waived_at, fee.waived_by, fee.waive_reason = "pending", None, None, None
        elif not fee and amount > 0:
            db.add(ClassFee(studio_id=s.studio_id, client_id=booking.client_id, booking_id=booking.id, rule_id=rule.id,
                            event=event, amount_cents=amount,
                            reason=f"{EVENTS[event]}: {ctx['class_name']} {ctx['class_date']} {ctx['class_time']}"[:200]))
        if amount > 0:
            note = f"נרשם חיוב של ₪{amount / 100:g} על {EVENTS[event]} ב{ctx['class_name']} ({ctx['class_date']})."
    elif action == "warn":
        note = f"{EVENTS[event]} ב{ctx['class_name']} ({ctx['class_date']}). בפעם הבאה ייתכן חיוב."
    db.flush()
    if note:
        notifications.notify(db, s.studio_id, "late_fee", origin=origin, about=f"booking:{booking.id}:{event}",
                             context={**ctx, "fee_note": note}, clients=[db.get(Client, booking.client_id)])
    return action


def waive_fee(db: Session, booking_id, reason: str, *, user_id=None) -> None:
    fee = db.scalar(select(ClassFee).where(ClassFee.booking_id == booking_id, ClassFee.status == "pending"))
    if fee:
        fee.status, fee.waived_at, fee.waived_by, fee.waive_reason = "waived", svc.now_utc(), user_id, reason[:200]
        db.flush()


def fee_of(db: Session, booking_ids) -> dict:
    ids = list(booking_ids)
    if not ids:
        return {}
    return {f.booking_id: f for f in db.scalars(select(ClassFee).where(ClassFee.booking_id.in_(ids))).all()}


def validate_rule(r: dict) -> dict:
    """A rule from the owner's screen, checked. Raises ValueError with a message for the owner."""
    if r.get("event") not in EVENTS:
        raise ValueError("אירוע לא מוכר")
    if r.get("action") not in ACTIONS:
        raise ValueError("פעולה לא מוכרת")
    n = r.get("from_count") or 1
    if not isinstance(n, int) or not 1 <= n <= 50:
        raise ValueError("מהפעם ה-: בין 1 ל-50")
    days = r.get("within_days")
    if days is not None and (not isinstance(days, int) or not 1 <= days <= 365):
        raise ValueError("בתוך כמה ימים: בין 1 ל-365")
    out = {"event": r["event"], "action": r["action"], "from_count": n, "within_days": days, "amount_cents": None, "percent": None}
    if r["action"] == "fixed":
        amount = r.get("amount_cents")
        if not isinstance(amount, int) or not 0 < amount <= 1_000_000:
            raise ValueError("סכום החיוב חסר")
        out["amount_cents"] = amount
    if r["action"] == "percent":
        pct = r.get("percent")
        if not isinstance(pct, int) or not 1 <= pct <= 100:
            raise ValueError("אחוז: בין 1 ל-100")
        out["percent"] = pct
    return out
