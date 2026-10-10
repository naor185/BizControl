"""
The businesses' payments to BizControl — the superadmin's CRM, part ג (owner, 2026-10-10). Until card clearing (Grow)
is connected, the superadmin records a payment by hand (bank transfer, Bit, cash, card on the phone) and it extends the
business's period: monthly = one calendar month, annual = twelve, counted from the later of today and the current end
(a business paying during its free month keeps the free month). The billing terms (customers/src/app/billing-terms):
monthly has no commitment, annual is one charge for 12 months, renewing until cancelled.

The collection list: a paying business whose period ends within 7 days (due soon) or ended in the last 30 days
(overdue), and a free month that ended without a plan chosen — not a business that cancelled at the end of its period.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from dateutil.relativedelta import relativedelta
from sqlalchemy import select, text
from sqlalchemy.orm import Session

CYCLES = {"monthly": 1, "annual": 12}           # months a payment buys
METHODS = {"bank": "העברה בנקאית", "bit": "ביט", "cash": "מזומן", "card": "כרטיס אשראי", "check": "צ'ק", "other": "אחר"}
DUE_SOON_DAYS = 7
OVERDUE_WINDOW_DAYS = 30                          # ended longer ago = left, not owing


def price_cents(plan, cycle: str) -> int:
    """What a plan costs for a cycle — the annual price when there is one, else 12 months."""
    if plan is None:
        return 0
    monthly = plan.price_monthly_cents or plan.price_cents or 0
    return (plan.price_annual_cents or monthly * 12) if cycle == "annual" else monthly


def last_cycle(db: Session, studio_id) -> str:
    """How the business last paid (monthly when it never did)."""
    return db.scalar(text("SELECT cycle FROM platform_payments WHERE studio_id = :s ORDER BY paid_at DESC, created_at DESC LIMIT 1"),
                     {"s": str(studio_id)}) or "monthly"


def record_payment(db: Session, studio_id: str, *, plan_id: str, cycle: str, amount_cents: int, method: str,
                   paid_at: datetime, note: str, recorded_by) -> dict:
    """Record a payment and extend the business's period by it. {id, period_end}."""
    from app.core.billing import apply_subscription_event
    from app.models.module import Plan
    from app.models.studio import Studio
    from app.models.subscription import Subscription

    studio = db.get(Studio, uuid.UUID(str(studio_id)))
    if studio is None:
        raise LookupError("העסק לא נמצא")
    plan = db.get(Plan, plan_id)
    if plan is None or not plan.is_purchasable:
        raise ValueError("אפשר לרשום תשלום רק על מסלול שנמכר")
    if cycle not in CYCLES or method not in METHODS:
        raise ValueError("סוג תשלום לא מוכר")

    now = datetime.now(timezone.utc)
    sub = db.scalar(select(Subscription).where(Subscription.studio_id == studio.id))
    current = [d for d in (studio.plan_expires_at, sub.trial_ends_at if sub and sub.status == "trial" else None) if d]
    start = max([now, *current])
    end = start + relativedelta(months=CYCLES[cycle])

    payment_id = uuid.uuid4()
    db.execute(text("""
        INSERT INTO platform_payments (id, studio_id, plan_id, cycle, amount_cents, method, paid_at, period_start, period_end,
                                       note, recorded_by)
        VALUES (:id, :s, :p, :c, :a, :m, :paid, :start, :end, :note, :by)
    """), {"id": payment_id, "s": studio.id, "p": plan_id, "c": cycle, "a": amount_cents, "m": method, "paid": paid_at,
           "start": start, "end": end, "note": note or None, "by": recorded_by})
    studio.plan_expires_at = end                    # the date access is locked on (auth_deps)
    studio.subscription_plan = plan_id
    apply_subscription_event(                         # commits the payment with it
        db, studio.id, "activated" if sub is None or sub.status == "trial" else "renewed", source="admin",
        plan_id=plan_id, current_period_start=start, current_period_end=end, cancel_at_period_end=False,
        metadata={"payment_id": str(payment_id), "cycle": cycle, "amount_cents": amount_cents, "method": method},
    )
    return {"id": str(payment_id), "period_end": end.isoformat()}


def payments(db: Session, studio_id: str | None = None, limit: int = 200) -> list[dict]:
    """Recorded payments, newest first — all of them, or one business's."""
    rows = db.execute(text(f"""
        SELECT p.id, p.studio_id, s.name, p.plan_id, pl.display_name, p.cycle, p.amount_cents, p.method, p.paid_at,
               p.period_end, p.note
        FROM platform_payments p
        JOIN studios s ON s.id = p.studio_id
        LEFT JOIN plans pl ON pl.id = p.plan_id
        {"WHERE p.studio_id = :s" if studio_id else ""}
        ORDER BY p.paid_at DESC, p.created_at DESC LIMIT :n
    """), {"s": studio_id, "n": limit}).fetchall()
    return [{"id": str(r[0]), "studio_id": str(r[1]), "studio_name": r[2], "plan_id": r[3], "plan_label": r[4] or r[3],
             "cycle": r[5], "amount_ils": r[6] / 100, "method": METHODS.get(r[7], r[7]),
             "paid_at": r[8].isoformat() if r[8] else None, "period_end": r[9].isoformat() if r[9] else None,
             "note": r[10]} for r in rows]


def overview(db: Session) -> dict:
    """The money picture: what comes in a month, what's due, who's late, and what was received this month."""
    from app.models.module import Plan
    from app.services.platform_crm import ENDED, customers
    import pytz

    plans = {p.id: p for p in db.scalars(select(Plan)).all()}
    cycles = dict(db.execute(text("""
        SELECT DISTINCT ON (studio_id) studio_id::text, cycle FROM platform_payments ORDER BY studio_id, paid_at DESC, created_at DESC
    """)).all())
    il = pytz.timezone("Asia/Jerusalem")
    month_start = datetime.now(il).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    received = db.scalar(text("SELECT COALESCE(SUM(amount_cents), 0) FROM platform_payments WHERE paid_at >= :m"),
                         {"m": month_start}) or 0

    monthly_cents, collect = 0, []
    for c in customers(db):
        plan = plans.get(c["plan_id"])
        cycle = cycles.get(c["id"], "monthly")
        trial, left = c["status"] == "trial", c["days_left"]
        gone = left is not None and left < -OVERDUE_WINDOW_DAYS
        if not trial and not gone and c["status"] not in ENDED and c["plan_id"] != "trial" and not c["cancel_at_period_end"]:
            monthly_cents += price_cents(plan, "monthly") if cycle == "monthly" else price_cents(plan, "annual") // 12
        if left is None or gone or left > DUE_SOON_DAYS or c["cancel_at_period_end"] or c["status"] == "canceled":
            continue
        state = ("trial_ended" if left < 0 else "trial_ending") if trial else ("overdue" if left < 0 else "due_soon")
        collect.append({
            "id": c["id"], "name": c["name"], "owner_name": c["owner_name"], "owner_phone": c["owner_phone"],
            "owner_email": c["owner_email"], "plan_id": c["plan_id"], "plan_label": c["plan_label"], "days_left": left,
            "ends_at": c["ends_at"], "state": state, "cycle": cycle,
            "amount_ils": 0 if trial else price_cents(plan, cycle) / 100,
        })
    collect.sort(key=lambda r: r["days_left"])
    return {
        "monthly_ils": monthly_cents / 100,
        "received_this_month_ils": received / 100,
        "due_soon_ils": sum(r["amount_ils"] for r in collect if r["state"] == "due_soon"),
        "overdue_ils": sum(r["amount_ils"] for r in collect if r["state"] == "overdue"),
        "collect": collect,
    }


def options(db: Session) -> dict:
    """What the payment window offers: the plans for sale with their prices, and the ways to pay."""
    from app.models.module import Plan
    plans = db.scalars(select(Plan).where(Plan.is_purchasable.is_(True), Plan.is_active.is_(True)).order_by(Plan.sort_order)).all()
    return {"plans": [{"id": p.id, "label": p.display_name, "monthly_ils": price_cents(p, "monthly") / 100,
                       "annual_ils": price_cents(p, "annual") / 100} for p in plans],
            "methods": METHODS}
