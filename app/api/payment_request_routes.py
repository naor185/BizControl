"""A link to pay sent to a client on WhatsApp — services/payment_requests.

POST /api/payment-requests                     — send one (from the till: items; from an appointment: the amount)
GET  /api/payment-requests                     — the ones still waiting (sent, or reported paid)
POST /api/payment-requests/{id}/approve        — the money came in: record the sale and its receipt
POST /api/payment-requests/{id}/cancel
GET  /api/public/payment-request/{id}          — the client's page (this request only)
POST /api/public/payment-request/{id}/proof    — a picture of the payment
POST /api/public/payment-request/{id}/confirm  — "שילמתי"
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import AuthContext, require_studio_ctx
from app.core.permissions import WORKERS, no_workers, worker_may
from app.core.database import get_db
from app.services import payment_requests as svc

router = APIRouter(prefix="/payment-requests", tags=["PaymentRequests"])
public_router = APIRouter(prefix="/public/payment-request", tags=["PaymentRequestsPublic"])


class ItemIn(BaseModel):
    product_id: Optional[str] = None
    description: str
    quantity: int = 1
    unit_price_cents: int


class RequestIn(BaseModel):
    client_id: UUID
    appointment_id: Optional[UUID] = None
    items: list[ItemIn] = []
    discount_cents: int = 0
    amount_cents: Optional[int] = None
    performer_id: Optional[UUID] = None


class ApproveIn(BaseModel):
    method: str = "bit"
    send_receipt: bool = True


class ConfirmIn(BaseModel):
    notes: Optional[str] = None


def _mine(db: Session, ctx: AuthContext, request_id: UUID):
    req = db.get(svc.PaymentRequest, request_id)
    if not req or req.studio_id != ctx.studio_id:              # another business's — as if it weren't there
        raise HTTPException(404, "הקישור לא נמצא")
    return req


@router.post("", status_code=201)
def send(body: RequestIn, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    # a worker: with payments (from an appointment) or the till (2026-10-27); on an appointment in their reach
    if ctx.role in WORKERS:
        if not (worker_may(db, ctx.role, ctx.user_id, "payments") or worker_may(db, ctx.role, ctx.user_id, "pos")):
            raise HTTPException(403, "גבייה — בעל העסק לא אפשר את זה לך")
        if body.appointment_id and not worker_may(db, ctx.role, ctx.user_id, "all_calendars"):
            from app.models.appointment import Appointment
            appt = db.get(Appointment, body.appointment_id)
            if appt is not None and str(appt.artist_id) != str(ctx.user_id):
                raise HTTPException(403, "אפשר רק תורים ביומן שלך")
    req = svc.create(db, ctx.studio_id, ctx.user_id, client_id=body.client_id, appointment_id=body.appointment_id,
                     items=[i.model_dump() for i in body.items], discount_cents=body.discount_cents,
                     amount_cents=body.amount_cents, performer_id=body.performer_id)
    return {"id": str(req.id), "amount_cents": req.amount_cents, "link": svc.link(req)}


@router.get("")
def waiting(ctx: AuthContext = Depends(no_workers()), db: Session = Depends(get_db)):
    return svc.open_list(db, ctx.studio_id)


@router.post("/{request_id}/approve")
def approve(request_id: UUID, body: ApproveIn, ctx: AuthContext = Depends(no_workers()), db: Session = Depends(get_db)):
    return svc.approve(db, ctx, _mine(db, ctx, request_id), body.method, body.send_receipt)


@router.post("/{request_id}/cancel")
def cancel(request_id: UUID, ctx: AuthContext = Depends(no_workers()), db: Session = Depends(get_db)):
    svc.cancel(db, _mine(db, ctx, request_id))
    return {"status": "canceled"}


@public_router.get("/{request_id}")
def public_view(request_id: UUID, db: Session = Depends(get_db)):
    return svc.public_view(db, svc.get_public(db, request_id))


@public_router.post("/{request_id}/proof", status_code=204)
async def public_proof(request_id: UUID, file: UploadFile = File(...), db: Session = Depends(get_db)):
    req = svc.get_public(db, request_id)
    data = await file.read(svc.MAX_BYTES + 1)
    svc.save_proof(db, req, data)


@public_router.post("/{request_id}/confirm")
def public_confirm(request_id: UUID, body: ConfirmIn, db: Session = Depends(get_db)):
    req = svc.get_public(db, request_id)
    svc.report(db, req, body.notes)
    return {"status": req.status}
