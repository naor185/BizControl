from __future__ import annotations # v1.1
from uuid import UUID
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.user import User
from app.crud.automation import enqueue_aftercare_if_needed, enqueue_confirmation_message, enqueue_reschedule_message, enqueue_cancel_message
from app.events.appointment_events import appointment_completed


def _has_overlap(db: Session, studio_id: UUID, artist_id: UUID, starts_at, ends_at, exclude_id: UUID | None = None) -> bool:
    # overlap rule: starts < existing_ends AND ends > existing_starts
    stmt = select(Appointment.id).where(
        Appointment.studio_id == studio_id,
        Appointment.artist_id == artist_id,
        Appointment.status == "scheduled",
        Appointment.starts_at < ends_at,
        Appointment.ends_at > starts_at,
    )
    if exclude_id:
        stmt = stmt.where(Appointment.id != exclude_id)
    return db.scalar(stmt) is not None

def _appt_to_out_dict(db: Session, appt: Appointment, client: Client, artist: User) -> dict:
    from app.models.payment import Payment
    from sqlalchemy import select, func

    paid_cents = db.scalar(
        select(func.sum(Payment.amount_cents))
        .where(
            Payment.appointment_id == appt.id,
            Payment.status == "paid",
            Payment.type != "refund"
        )
    ) or 0
    
    refund_cents = db.scalar(
        select(func.sum(Payment.amount_cents))
        .where(
            Payment.appointment_id == appt.id,
            Payment.status == "paid",
            Payment.type == "refund"
        )
    ) or 0
    
    net_paid = paid_cents - refund_cents
    remaining = max(0, appt.total_price_cents - net_paid)

    return {
        "id": appt.id,
        "studio_id": appt.studio_id,
        "client_id": appt.client_id,
        "artist_id": appt.artist_id,
        "title": appt.title,
        "starts_at": appt.starts_at,
        "ends_at": appt.ends_at,
        "status": appt.status,
        "notes": appt.notes,
        "created_at": appt.created_at,
        "client_name": client.full_name,
        "artist_email": artist.email,
        "artist_name": artist.display_name,
        "artist_color": artist.calendar_color,
        "google_event_id": appt.google_event_id,
        "total_price_cents": appt.total_price_cents,
        "deposit_amount_cents": appt.deposit_amount_cents,
        "paid_cents": net_paid,
        "remaining_cents": remaining,
        "client_loyalty_points": client.loyalty_points or 0,
    }

def create_appointment(db: Session, studio_id: UUID, data) -> dict:
    if data.ends_at <= data.starts_at:
        raise ValueError("ends_at must be after starts_at")

    if _has_overlap(db, studio_id, data.artist_id, data.starts_at, data.ends_at):
        pass # Allow overlapping appointments

    obj = Appointment(
        studio_id=studio_id,
        client_id=data.client_id,
        artist_id=data.artist_id,
        title=data.title.strip(),
        starts_at=data.starts_at,
        ends_at=data.ends_at,
        status="scheduled",
        notes=data.notes,
        total_price_cents=data.total_price_cents or 0,
        deposit_amount_cents=data.deposit_amount_cents or 0,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    # Queue confirmation message
    enqueue_confirmation_message(db, obj)

    row = db.execute(
        select(Appointment, Client, User)
        .join(Client, Client.id == Appointment.client_id)
        .join(User, User.id == Appointment.artist_id)
        .where(Appointment.id == obj.id, Appointment.studio_id == studio_id)
    ).first()

    appt, client, artist = row
    return _appt_to_out_dict(db, appt, client, artist)

def list_appointments(db: Session, studio_id: UUID, start=None, end=None, artist_id: UUID | None = None, client_id: UUID | None = None) -> list[dict]:
    stmt = (
        select(Appointment, Client, User)
        .join(Client, Client.id == Appointment.client_id)
        .join(User, User.id == Appointment.artist_id)
        .where(Appointment.studio_id == studio_id)
    )

    if artist_id:
        stmt = stmt.where(Appointment.artist_id == artist_id)
        
    if client_id:
        stmt = stmt.where(Appointment.client_id == client_id)

    if start and end:
        stmt = stmt.where(Appointment.starts_at < end, Appointment.ends_at > start)

    stmt = stmt.order_by(Appointment.starts_at.asc())

    rows = db.execute(stmt).all()
    return [_appt_to_out_dict(db, appt, client, artist) for appt, client, artist in rows]

def get_appointment(db: Session, studio_id: UUID, appointment_id: UUID) -> Appointment | None:
    stmt = select(Appointment).where(Appointment.studio_id == studio_id, Appointment.id == appointment_id)
    return db.scalar(stmt)

def get_appointment_out(db: Session, studio_id: UUID, appointment_id: UUID) -> dict | None:
    row = db.execute(
        select(Appointment, Client, User)
        .join(Client, Client.id == Appointment.client_id)
        .join(User, User.id == Appointment.artist_id)
        .where(Appointment.studio_id == studio_id, Appointment.id == appointment_id)
    ).first()

    if not row:
        return None

    appt, client, artist = row
    return _appt_to_out_dict(db, appt, client, artist)

def update_appointment(db: Session, studio_id: UUID, appointment_id: UUID, data) -> dict | None:
    obj = get_appointment(db, studio_id, appointment_id)
    if not obj:
        return None

    prev_status = obj.status

    new_starts = data.starts_at if data.starts_at is not None else obj.starts_at
    new_ends = data.ends_at if data.ends_at is not None else obj.ends_at
    new_artist = data.artist_id if data.artist_id is not None else obj.artist_id

    if new_ends <= new_starts:
        raise ValueError("ends_at must be after starts_at")

    # בדיקת חפיפה רק אם זה תור scheduled
    if (data.starts_at is not None) or (data.ends_at is not None) or (data.artist_id is not None):
        if obj.status == "scheduled" and _has_overlap(db, studio_id, new_artist, new_starts, new_ends, exclude_id=obj.id):
            pass # Allow overlapping appointments

    if data.title is not None:
        obj.title = data.title.strip()
    if data.notes is not None:
        obj.notes = data.notes
    if data.status is not None:
        obj.status = data.status
    if data.client_id is not None:
        obj.client_id = data.client_id
    if data.artist_id is not None:
        obj.artist_id = data.artist_id

    starts_at_changed = False
    if data.starts_at is not None:
        if obj.starts_at != data.starts_at:
            starts_at_changed = True
        obj.starts_at = data.starts_at
    if data.ends_at is not None:
        obj.ends_at = data.ends_at

    if getattr(data, 'total_price_cents', None) is not None:
        obj.total_price_cents = data.total_price_cents
    if getattr(data, 'deposit_amount_cents', None) is not None:
        obj.deposit_amount_cents = data.deposit_amount_cents

    # אם עבר ל-done עכשיו (או נשאר done) נשתמש בפונקציה האידמפוטנטית
    if (obj.status in ("done", "completed")) and (prev_status not in ("done", "completed")):
        enqueue_aftercare_if_needed(db, obj)
        # Trigger modern event system
        appointment_completed({"client_id": str(obj.client_id), "appointment_id": str(obj.id)})

    if starts_at_changed and obj.status == "scheduled":
        enqueue_reschedule_message(db, obj)

    db.commit()
    db.refresh(obj)

    row = db.execute(
        select(Appointment, Client, User)
        .join(Client, Client.id == Appointment.client_id)
        .join(User, User.id == Appointment.artist_id)
        .where(Appointment.id == obj.id, Appointment.studio_id == studio_id)
    ).first()

    appt, client, artist = row
    return _appt_to_out_dict(db, appt, client, artist)

def cancel_appointment(db: Session, studio_id: UUID, appointment_id: UUID, reason: str | None = None) -> bool:
    obj = get_appointment(db, studio_id, appointment_id)
    if not obj:
        return False
    
    # Update Client Counters based on reason before marking canceled/no_show
    if reason in ("client_cancelled", "no_show"):
        client = db.get(Client, obj.client_id)
        if client:
            if reason == "client_cancelled":
                client.cancellation_count = int(client.cancellation_count or 0) + 1
            elif reason == "no_show":
                client.no_show_count = int(client.no_show_count or 0) + 1
    
    obj.status = "no_show" if reason == "no_show" else "canceled"
    db.commit()
    # Send cancellation message to client (only for real cancellations, not no-shows)
    if obj.status == "canceled":
        enqueue_cancel_message(db, obj)
    return True

def hard_delete_appointment(db: Session, studio_id: UUID, appointment_id: UUID) -> bool:
    obj = get_appointment(db, studio_id, appointment_id)
    if not obj:
        return False
    db.delete(obj)
    db.commit()
    return True
