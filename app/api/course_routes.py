"""
Courses (classes extras 4): a course's registrations — enroll a client for the whole course, cancel an
enrollment (with the refund the owner's rule gives), record a payment and a refund for it. The course's price
is on the class template (class_routes) and its rules in the class settings. app/services/courses.py does the work.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.features import require_module
from app.core.permissions import may, require_action
from app.core.deps import AuthContext
from app.models.classes import ClassTemplate, CourseEnrollment
from app.models.client import Client
from app.services import class_payments as payments
from app.services import courses

router = APIRouter(prefix="/classes", tags=["Courses"], dependencies=[Depends(require_module("classes"))])
SHOWN = ("active", "offered", "waiting", "canceled")


def _get(db: Session, model, studio_id, obj_id, missing: str):
    obj = db.get(model, obj_id)
    if not obj or obj.studio_id != studio_id:
        raise HTTPException(404, missing)
    return obj


def _course(db: Session, studio_id, template_id) -> ClassTemplate:
    t = _get(db, ClassTemplate, studio_id, template_id, "הקורס לא נמצא")
    if not courses.is_course(t):
        raise HTTPException(400, "זה לא קורס")
    return t


def _fail(db: Session, e: ValueError):
    from app.services.class_bookings import FullError
    db.rollback()
    raise HTTPException(409 if isinstance(e, FullError) else 400, str(e))


def course_out(db: Session, t: ClassTemplate) -> dict:
    """The course and its registrations: price, sessions, who is registered, paid, refunded, and what the
    owner's rule would refund if one were cancelled now."""
    rows = db.execute(select(CourseEnrollment, Client).join(Client, Client.id == CourseEnrollment.client_id)
                      .where(CourseEnrollment.template_id == t.id, CourseEnrollment.status.in_(SHOWN))
                      .order_by(CourseEnrollment.position.nulls_first(), CourseEnrollment.created_at)).all()
    money = courses.paid(db, [e.id for e, _ in rows])
    every, coming = courses.sessions(db, t), courses.sessions(db, t, coming_only=True)
    from app.services import class_waitlist as wl
    return {
        "template_id": str(t.id), "name": t.name, "capacity": t.capacity, "spots": courses.spots(db, t),
        "waitlist_enabled": wl.enabled(db, t.studio_id) and bool(courses.rule(db, t, "waitlist_max")),
        "price_cents": t.course_price_cents, "price_now_cents": courses.price_now(db, t),
        "covered_by_membership": courses.covered_by_membership(db, t),
        "sessions_total": len(every), "sessions_left": len(coming),
        "first_starts_at": every[0].starts_at.isoformat() if every else None,
        "enrolled": sum(1 for e, _ in rows if e.status == "active"),
        "enrollments": [{
            "id": str(e.id), "client_id": str(c.id), "full_name": c.full_name, "phone": c.phone, "status": e.status,
            "price_cents": e.price_cents, "sessions_total": e.sessions_total,
            "paid_cents": money[e.id]["paid"], "refunded_cents": money[e.id]["refunded"],
            "refund_due_cents": courses.refund_due(db, e) if e.status == "active" else None,
            "position": e.position, "offer_expires_at": e.offer_expires_at.isoformat() if e.offer_expires_at else None,
            "enrolled_at": e.enrolled_at.isoformat() if e.enrolled_at else None,
            "canceled_at": e.canceled_at.isoformat() if e.canceled_at else None, "cancel_reason": e.cancel_reason,
        } for e, c in rows],
    }


@router.get("/courses/{template_id}")
def get_course(template_id: uuid.UUID, ctx: AuthContext = Depends(require_action("bookings.manage")), db: Session = Depends(get_db)):
    return course_out(db, _course(db, ctx.studio_id, template_id))


class EnrollIn(BaseModel):
    client_id: uuid.UUID
    price_cents: Optional[int] = Field(None, ge=0, le=10_000_000)   # another price (a discount…) — owner or manager


@router.post("/courses/{template_id}/enrollments")
def enroll(template_id: uuid.UUID, body: EnrollIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
           db: Session = Depends(get_db)):
    t = _course(db, ctx.studio_id, template_id)
    client = _get(db, Client, ctx.studio_id, body.client_id, "הלקוח לא נמצא")
    if body.price_cents is not None and not may(ctx.role, "limits.override"):
        raise HTTPException(403, "מחיר אחר לקורס — רק לבעלים או למנהל")
    try:
        courses.enroll(db, t, client, price_cents=body.price_cents, user_id=ctx.user_id)
    except ValueError as e:              # CourseError / BookingError / MembershipError — a message for the staff
        _fail(db, e)
    db.commit()
    return course_out(db, t)


class CancelIn(BaseModel):
    reason: Optional[str] = Field(None, max_length=300)


@router.post("/enrollments/{enrollment_id}/cancel")
def cancel(enrollment_id: uuid.UUID, body: CancelIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
           db: Session = Depends(get_db)):
    e = _get(db, CourseEnrollment, ctx.studio_id, enrollment_id, "ההרשמה לא נמצאה")
    try:
        result = courses.cancel(db, e, user_id=ctx.user_id, reason=body.reason)
    except ValueError as err:
        _fail(db, err)
    db.commit()
    return {**course_out(db, db.get(ClassTemplate, e.template_id)), "result": result}


class PayIn(BaseModel):
    amount_cents: int = Field(gt=0, le=10_000_000)
    method: str
    send_receipt: bool = True
    external_ref: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=500)


@router.post("/enrollments/{enrollment_id}/payments")
def pay(enrollment_id: uuid.UUID, body: PayIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
        db: Session = Depends(get_db)):
    """Records a payment for the course registration (with its receipt), never collected."""
    e = _get(db, CourseEnrollment, ctx.studio_id, enrollment_id, "ההרשמה לא נמצאה")
    try:
        payments.record(db, ctx.studio_id, db.get(Client, e.client_id), amount_cents=body.amount_cents, method=body.method,
                        enrollment=e, notes=body.notes, external_ref=body.external_ref, send_receipt=body.send_receipt)
    except ValueError as err:
        _fail(db, err)
    db.commit()
    return course_out(db, db.get(ClassTemplate, e.template_id))


class RefundIn(BaseModel):
    amount_cents: int = Field(gt=0, le=10_000_000)
    method: str
    notes: Optional[str] = Field(None, max_length=500)


@router.post("/enrollments/{enrollment_id}/refund")
def refund(enrollment_id: uuid.UUID, body: RefundIn, ctx: AuthContext = Depends(require_action("memberships.change")),
           db: Session = Depends(get_db)):
    """Records money given back for the course (owner or manager) — up to what was paid."""
    e = _get(db, CourseEnrollment, ctx.studio_id, enrollment_id, "ההרשמה לא נמצאה")
    try:
        courses.record_refund(db, e, body.amount_cents, body.method, user_id=ctx.user_id, notes=body.notes)
    except ValueError as err:
        _fail(db, err)
    db.commit()
    return course_out(db, db.get(ClassTemplate, e.template_id))


# ── the course's waitlist ────────────────────────────────────────────────────

class WaitIn(BaseModel):
    client_id: uuid.UUID


@router.post("/courses/{template_id}/waitlist")
def join_waitlist(template_id: uuid.UUID, body: WaitIn, ctx: AuthContext = Depends(require_action("bookings.manage")),
                  db: Session = Depends(get_db)):
    t = _course(db, ctx.studio_id, template_id)
    try:
        courses.join_waitlist(db, t, _get(db, Client, ctx.studio_id, body.client_id, "הלקוח לא נמצא"))
    except ValueError as err:
        _fail(db, err)
    db.commit()
    return course_out(db, t)


@router.post("/enrollments/{enrollment_id}/leave")
def leave_waitlist(enrollment_id: uuid.UUID, ctx: AuthContext = Depends(require_action("bookings.manage")),
                   db: Session = Depends(get_db)):
    e = _get(db, CourseEnrollment, ctx.studio_id, enrollment_id, "לא נמצא ברשימת ההמתנה")
    try:
        courses.leave_waitlist(db, e)
    except ValueError as err:
        _fail(db, err)
    db.commit()
    return course_out(db, db.get(ClassTemplate, e.template_id))


@router.post("/enrollments/{enrollment_id}/take")
def take_offer(enrollment_id: uuid.UUID, ctx: AuthContext = Depends(require_action("bookings.manage")),
               db: Session = Depends(get_db)):
    """The staff take an offered spot for the client — the enrollment is made."""
    e = _get(db, CourseEnrollment, ctx.studio_id, enrollment_id, "לא נמצא ברשימת ההמתנה")
    try:
        courses.take_offer(db, e, user_id=ctx.user_id)
    except ValueError as err:
        _fail(db, err)
    db.commit()
    return course_out(db, db.get(ClassTemplate, e.template_id))
