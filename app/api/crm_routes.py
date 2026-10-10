"""
The superadmin's CRM — the businesses using BizControl (app/services/platform_crm.py) and messages from the company
to their owners (app/services/platform_outreach.py):
GET  /api/admin/crm/customers        — every business: owner, plan and where it stands, activity, retention signal
GET  /api/admin/crm/templates        — the message templates
PUT  /api/admin/crm/templates/{key}  — edit one
POST /api/admin/crm/send             — WhatsApp / e-mail / both to the chosen businesses' owners (queued)
GET  /api/admin/crm/sent             — what was sent (?studio_id= for one business)
GET  /api/admin/crm/billing          — the money picture: monthly income, due soon, overdue, received this month
GET  /api/admin/crm/payment-options  — the plans for sale with their prices, and the ways to pay
GET  /api/admin/crm/payments         — recorded payments (?studio_id= for one business)
POST /api/admin/crm/payments         — record a payment by hand; it extends the business's period
POST /api/admin/crm/payments/{id}/undo — undo one recorded by mistake (the business's last); the period goes back
"""
from datetime import date, datetime, time, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.superadmin_routes import _audit, require_superadmin
from app.core.database import get_db
from app.models.user import User
from app.services import platform_billing, platform_crm, platform_outreach

router = APIRouter(prefix="/admin/crm", tags=["SuperAdmin"])


@router.get("/customers")
def list_customers(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return platform_crm.customers(db)


@router.get("/templates")
def list_templates(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return platform_outreach.templates(db)


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email_subject: str = Field(default="", max_length=160)
    body: str = Field(min_length=1, max_length=2000)


@router.put("/templates/{key}")
def save_template(key: str, payload: TemplateIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    platform_outreach.save_template(db, key, payload.name.strip(), payload.email_subject.strip(), payload.body.strip())
    return {"saved": key}


class SendIn(BaseModel):
    studio_ids: list[str] = Field(min_length=1, max_length=2000)
    channel: Literal["whatsapp", "email", "both"]
    body: str = Field(min_length=1, max_length=2000)
    subject: Optional[str] = Field(default=None, max_length=160)


@router.post("/send")
def send(payload: SendIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    try:
        result = platform_outreach.send(db, payload.studio_ids, payload.channel, payload.body, payload.subject)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _audit(db, admin, "crm_message_sent", None, {"channel": payload.channel, "businesses": len(payload.studio_ids),
                                                  "queued": result["queued"]})
    db.commit()
    return result


@router.get("/sent")
def list_sent(studio_id: Optional[str] = None, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return platform_outreach.sent(db, studio_id)


@router.get("/billing")
def billing_overview(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return platform_billing.overview(db)


@router.get("/payment-options")
def payment_options(admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return platform_billing.options(db)


@router.get("/payments")
def list_payments(studio_id: Optional[str] = None, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return platform_billing.payments(db, studio_id)


class PaymentIn(BaseModel):
    studio_id: str
    plan_id: str
    cycle: Literal["monthly", "annual"]
    amount_ils: float = Field(ge=0, le=100_000)
    method: str
    paid_on: date
    note: str = Field(default="", max_length=500)


@router.post("/payments")
def record_payment(payload: PaymentIn, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    try:
        result = platform_billing.record_payment(
            db, payload.studio_id, plan_id=payload.plan_id, cycle=payload.cycle,
            amount_cents=round(payload.amount_ils * 100), method=payload.method,
            paid_at=datetime.combine(payload.paid_on, time(12), tzinfo=timezone.utc), note=payload.note.strip(),
            recorded_by=admin.id,
        )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    _audit(db, admin, "crm_payment_recorded", None, {"studio_id": payload.studio_id, "plan": payload.plan_id,
                                                     "cycle": payload.cycle, "amount_ils": payload.amount_ils})
    db.commit()
    return result


@router.post("/payments/{payment_id}/undo")
def undo_payment(payment_id: str, admin: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    try:
        result = platform_billing.undo_payment(db, payment_id, admin.id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    _audit(db, admin, "crm_payment_undone", None, {"payment_id": payment_id, **result})
    db.commit()
    return result
