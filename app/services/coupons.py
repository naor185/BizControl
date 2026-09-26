"""
Coupons — one code field for both kinds: the business's own coupons (models/coupon.Coupon: a code the owner writes,
a percent, a category, a source, how many uses, until when) and the birthday coupons the system makes per client
(models/birthday_coupon.BirthdayCoupon). find() says whether a code works now (and why not, in plain Hebrew),
redeem() records the use on a payment or a till sale, release() gives it back when that sale is voided, report()
adds up the uses for the owner: per coupon, per category, per source — uses, what is left, money in, discount given.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.birthday_coupon import BirthdayCoupon
from app.models.coupon import Coupon, CouponUse
from app.services.classes import today_il

BIRTHDAY_CATEGORY = "יום הולדת"
DISCOUNT_NOTE = "[מערכת] קופון"          # the discount's row in payments starts with this
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,31}$")


def clean_code(code: str) -> str:
    return (code or "").strip().upper()


@dataclass
class Hit:
    """A code that works right now."""
    code: str
    percent: int
    coupon: Coupon | None = None
    birthday: BirthdayCoupon | None = None

    @property
    def label(self) -> str:
        kind = "קופון יום הולדת" if self.birthday else "קופון"
        return f"{kind} {self.code} — {self.percent}% הנחה"


def uses_of(db: Session, coupon: Coupon) -> int:
    return db.scalar(select(func.count(CouponUse.id)).where(CouponUse.coupon_id == coupon.id)) or 0


def state(db: Session, c: Coupon, used: int | None = None) -> str:
    """active | stopped | expired | used_up"""
    if not c.is_active:
        return "stopped"
    if c.expires_on and c.expires_on < today_il():
        return "expired"
    if c.max_uses is not None and (used if used is not None else uses_of(db, c)) >= c.max_uses:
        return "used_up"
    return "active"


def find(db: Session, studio_id, code: str, client_id=None, *, lock: bool = False) -> Hit:
    """The coupon behind a code, if it can be used now — ValueError (Hebrew, for the screen) when not."""
    code = clean_code(code)
    if not code:
        raise ValueError("לא הוקלד קוד קופון")
    q = select(Coupon).where(Coupon.studio_id == studio_id, Coupon.code == code)
    c = db.scalar(q.with_for_update() if lock else q)
    if c:
        st = state(db, c)
        if st == "stopped":
            raise ValueError(f"הקופון {code} הופסק")
        if st == "expired":
            raise ValueError(f"תוקף הקופון {code} פג")
        if st == "used_up":
            raise ValueError(f"הקופון {code} כבר נוצל עד הסוף")
        if c.once_per_client:
            if not client_id:
                raise ValueError(f"הקופון {code} הוא פעם אחת ללקוח — צריך לבחור לקוח")
            if db.scalar(select(CouponUse.id).where(CouponUse.coupon_id == c.id, CouponUse.client_id == client_id).limit(1)):
                raise ValueError(f"הלקוח כבר השתמש בקופון {code}")
        return Hit(code=code, percent=c.discount_percent, coupon=c)

    b = db.scalar(select(BirthdayCoupon).where(BirthdayCoupon.studio_id == studio_id, BirthdayCoupon.code == code))
    if b:
        if b.status != "active":
            raise ValueError(f"קופון יום ההולדת {code} כבר נוצל" if b.status == "redeemed" else f"קופון יום ההולדת {code} לא בתוקף")
        if b.expires_at < datetime.now(timezone.utc):
            raise ValueError(f"תוקף קופון יום ההולדת {code} פג")
        if client_id and b.client_id != client_id:
            raise ValueError(f"קופון יום ההולדת {code} שייך ללקוח אחר")
        return Hit(code=code, percent=b.discount_percent, birthday=b)
    raise ValueError(f"אין קופון בקוד {code}")


def discount_of(hit: Hit, before_cents: int) -> int:
    return max(0, round(before_cents * hit.percent / 100))


def redeem(db: Session, studio_id, hit: Hit, *, before_cents: int, client_id=None, user_id=None,
           payment=None, pos_transaction_id=None) -> CouponUse:
    """Records the use (the caller commits). Checks the limits again under a lock, so two sales at the same moment
    cannot both take the last use. On a payment (an appointment, a membership, a class, a course, a room rental)
    the discount gets its own row in payments — "[מערכת] קופון …", for the same thing — so what the client owes
    is closed, while the money reports leave it out (it is not money, like paying with club points)."""
    from app.models.payment import Payment
    if hit.coupon is not None:
        hit = find(db, studio_id, hit.code, client_id, lock=True)
    discount = discount_of(hit, before_cents)
    use = CouponUse(studio_id=studio_id, coupon_id=hit.coupon.id if hit.coupon else None,
                    birthday_coupon_id=hit.birthday.id if hit.birthday else None, code=hit.code, client_id=client_id,
                    payment_id=payment.id if payment is not None else None, pos_transaction_id=pos_transaction_id,
                    before_cents=before_cents, discount_cents=discount, used_by=user_id)
    if payment is not None and discount > 0:
        row = Payment(studio_id=studio_id, client_id=payment.client_id, appointment_id=payment.appointment_id,
                      membership_id=payment.membership_id, class_booking_id=payment.class_booking_id,
                      course_enrollment_id=payment.course_enrollment_id, room_rental_id=payment.room_rental_id,
                      rental_package_id=payment.rental_package_id, amount_cents=discount, currency=payment.currency or "ILS",
                      type="payment", status="paid", method="other",
                      notes=f"{DISCOUNT_NOTE} {hit.code} — {hit.percent}% הנחה")
        db.add(row)
        db.flush()
        use.discount_payment_id = row.id
    db.add(use)
    if hit.birthday is not None:
        from app.crud.birthday_coupon import apply_coupon
        if payment is not None:
            apply_coupon(db, hit.birthday, payment_id=payment.id, appointment_id=payment.appointment_id)
        else:
            hit.birthday.status = "redeemed"
            hit.birthday.redeemed_at = datetime.now(timezone.utc)
    return use


def forget_payment(db: Session, payment_id) -> None:
    """A payment is being deleted — its coupon's discount row goes with it (the use itself cascades)."""
    from app.models.payment import Payment
    for u in db.scalars(select(CouponUse).where(CouponUse.payment_id == payment_id)).all():
        if u.discount_payment_id:
            row = db.get(Payment, u.discount_payment_id)
            if row is not None:
                db.delete(row)


def release(db: Session, *, pos_transaction_id) -> int:
    """A voided till sale gives its coupon back (a deleted payment's use goes with it — the row cascades)."""
    uses = db.scalars(select(CouponUse).where(CouponUse.pos_transaction_id == pos_transaction_id)).all()
    for u in uses:
        if u.birthday_coupon_id:
            b = db.get(BirthdayCoupon, u.birthday_coupon_id)
            if b and b.status == "redeemed":
                b.status = "active" if b.expires_at >= datetime.now(timezone.utc) else "expired"
                b.redeemed_at = None
        db.delete(u)
    return len(uses)


# ── the owner's report ────────────────────────────────────────────────────────

def _totals(rows) -> dict:
    return {"uses": sum(r["uses"] for r in rows), "paid_cents": sum(r["paid_cents"] for r in rows),
            "discount_cents": sum(r["discount_cents"] for r in rows), "clicks": sum(r.get("clicks", 0) for r in rows)}


def report(db: Session, studio_id) -> dict:
    """Every coupon with its numbers, the birthday coupons as one line, and the sums by category and by source."""
    stats = {cid: (int(n), int(before), int(disc)) for cid, n, before, disc in db.execute(
        select(CouponUse.coupon_id, func.count(CouponUse.id), func.coalesce(func.sum(CouponUse.before_cents), 0),
               func.coalesce(func.sum(CouponUse.discount_cents), 0))
        .where(CouponUse.studio_id == studio_id, CouponUse.coupon_id.is_not(None)).group_by(CouponUse.coupon_id)).all()}
    coupons = []
    for c in db.scalars(select(Coupon).where(Coupon.studio_id == studio_id).order_by(Coupon.created_at.desc())).all():
        n, before, disc = stats.get(c.id, (0, 0, 0))
        coupons.append({
            "id": str(c.id), "code": c.code, "discount_percent": c.discount_percent, "category": c.category, "source": c.source,
            "max_uses": c.max_uses, "once_per_client": c.once_per_client,
            "expires_on": c.expires_on.isoformat() if c.expires_on else None, "is_active": c.is_active, "note": c.note,
            "state": state(db, c, n), "uses": n, "left": (max(0, c.max_uses - n) if c.max_uses is not None else None),
            "clicks": c.link_clicks, "paid_cents": before - disc, "discount_cents": disc, "created_at": c.created_at.isoformat(),
        })

    b_issued, b_active = db.execute(
        select(func.count(BirthdayCoupon.id), func.count(BirthdayCoupon.id).filter(BirthdayCoupon.status == "active"))
        .where(BirthdayCoupon.studio_id == studio_id)).one()
    b_n, b_before, b_disc = db.execute(
        select(func.count(CouponUse.id), func.coalesce(func.sum(CouponUse.before_cents), 0), func.coalesce(func.sum(CouponUse.discount_cents), 0))
        .where(CouponUse.studio_id == studio_id, CouponUse.birthday_coupon_id.is_not(None))).one()
    birthday = {"issued": int(b_issued), "active": int(b_active), "uses": int(b_n),
                "paid_cents": int(b_before) - int(b_disc), "discount_cents": int(b_disc)}

    def group(key: str, extra: list[dict]) -> list[dict]:
        out: dict[str, list] = {}
        for c in coupons:
            out.setdefault(c[key] or "ללא", []).append(c)
        rows = [{"name": k, "coupons": len(v), **_totals(v)} for k, v in out.items()] + extra
        return sorted(rows, key=lambda r: (-r["paid_cents"], r["name"]))

    birthday_row = [{"name": BIRTHDAY_CATEGORY, "coupons": birthday["issued"], "uses": birthday["uses"],
                     "paid_cents": birthday["paid_cents"], "discount_cents": birthday["discount_cents"], "clicks": 0}] if birthday["issued"] else []
    return {
        "coupons": coupons,
        "birthday": birthday,
        "by_category": group("category", birthday_row),
        "by_source": group("source", [{**birthday_row[0], "name": "אוטומטי — יום הולדת"}] if birthday_row else []),
        "totals": _totals(coupons + ([{"uses": birthday["uses"], "paid_cents": birthday["paid_cents"],
                                        "discount_cents": birthday["discount_cents"]}] if birthday["uses"] else [])),
    }


def code_taken(db: Session, studio_id, code: str, *, not_id: uuid.UUID | None = None) -> bool:
    q = select(Coupon.id).where(Coupon.studio_id == studio_id, Coupon.code == code)
    if not_id:
        q = q.where(Coupon.id != not_id)
    return bool(db.scalar(q.limit(1)) or db.scalar(
        select(BirthdayCoupon.id).where(BirthdayCoupon.studio_id == studio_id, BirthdayCoupon.code == code).limit(1)))
