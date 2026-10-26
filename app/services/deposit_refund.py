"""Giving the deposit back after a cancellation in time (the owner, 2026-10-26: "when an appointment is canceled, the
deposit was approved and it's within the cancellation time — ask me whether to credit the deposit, and take me to the
documents").

In time = at least the business's cancellation_free_days before the appointment — the policy the client got with the
confirmation ("ביטול עד X ימים לפני — החזר מלא"). Right after the cancellation the calendar asks; a yes opens the deposit's
receipt on the documents page with the credit note ready — the credit note and the money given back are recorded there
(invoice_routes.create_credit_note → crud/payment.record_refund). Nothing is given back by itself."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session


def offer(db: Session, studio_id, appointment_id, now: datetime | None = None) -> dict | None:
    """The deposit to give back for a canceled appointment — None when there's none: not canceled, no approved deposit
    paid, already credited, or canceled too late by the policy."""
    from app.models.appointment import Appointment
    from app.models.client import Client
    from app.models.payment import Payment
    from app.models.studio_settings import StudioSettings
    appt = db.get(Appointment, appointment_id)
    if appt is None or appt.studio_id != studio_id or appt.status != "canceled" or appt.payment_verified_at is None:
        return None
    now = now or datetime.now(timezone.utc)
    settings = db.get(StudioSettings, studio_id)
    free_days = settings.cancellation_free_days if settings is not None and settings.cancellation_free_days is not None else 7
    if now > appt.starts_at - timedelta(days=free_days):
        return None                                       # late — by the policy the deposit isn't given back
    deposits = db.scalars(select(Payment).where(Payment.studio_id == studio_id, Payment.appointment_id == appt.id,
                                                Payment.type == "deposit", Payment.status == "paid")
                          .order_by(Payment.created_at)).all()
    for p in deposits:
        receipt = db.execute(text("SELECT id, status FROM invoices WHERE studio_id = :sid AND source = 'payment' "
                                  "AND source_id = :pid AND doc_type != 'credit' LIMIT 1"),
                             {"sid": str(studio_id), "pid": str(p.id)}).first()
        if receipt is not None and receipt.status != "credited":
            client = db.get(Client, appt.client_id) if appt.client_id else None
            return {"invoice_id": str(receipt.id), "amount": p.amount_cents / 100,
                    "client_name": client.full_name if client else "",
                    "days_before": (appt.starts_at - now).days, "free_days": free_days}
    return None
