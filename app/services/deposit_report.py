"""The client says they paid the deposit — on the payment page (/pay/<appointment>): "שילמתי", with a picture of the
payment if they like. The business hears it at once — the bell, and a push to the owner's and the managers' phones —
and approves it from the calendar.

Why (the owner, 2026-10-15): most businesses send through the platform's WhatsApp number, so a proof a client sent
back on WhatsApp never reached the business; the "שילמתי" button only marked the appointment and nobody heard it."""
from __future__ import annotations

import io
import logging
from datetime import datetime, timezone

import pytz
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.notification import Notification
from app.models.studio_settings import StudioSettings

log = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024   # a phone's screenshot is 1–3 MB
MAX_SIDE = 1600                # enough to read a Bit confirmation, small to keep
CLOSED = ("canceled", "cancelled", "done", "no_show")


def open_for_report(db: Session, appointment_id) -> Appointment:
    """The appointment a client may report a deposit for — one that asks a deposit and is still ahead."""
    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="התור לא נמצא")
    if not appt.deposit_amount_cents:
        raise HTTPException(status_code=409, detail="לתור הזה אין מקדמה")
    if appt.status in CLOSED:
        raise HTTPException(status_code=409, detail="התור כבר לא פעיל")
    return appt


def save_proof(db: Session, appt: Appointment, data: bytes) -> str:
    """The picture of the payment — checked to be an image, turned upright, shrunk and saved without its metadata."""
    if appt.payment_verified_at:
        raise HTTPException(status_code=409, detail="המקדמה כבר אושרה")
    if not data:
        raise HTTPException(status_code=400, detail="לא התקבלה תמונה")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="התמונה גדולה מדי")
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail="זו לא תמונה — צלמו מסך של אישור התשלום")
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=85)

    from app.services.image_store import save_image
    url = save_image(out.getvalue(), "image/jpeg", folder=f"deposit-proofs/{appt.studio_id}", prefix="proof", db=db)
    if not url:
        raise HTTPException(status_code=503, detail="לא הצלחנו לשמור את התמונה — נסו שוב")
    added_later = appt.payment_sent_at is not None and not appt.payment_proof_url
    appt.payment_proof_url = url
    db.commit()
    if added_later:              # reported before without a picture — the business hears the picture came
        _notify(db, appt, "deposit_proof", "צילום של תשלום מקדמה")
    return url


def report(db: Session, appt: Appointment, notes: str | None) -> bool:
    """The client tapped "שילמתי" — True the first time (the business is told then, once)."""
    if appt.payment_verified_at:
        return False
    first = appt.payment_sent_at is None
    if first:
        appt.payment_sent_at = datetime.now(timezone.utc)
    if notes and notes.strip():
        appt.notes = (appt.notes or "") + f"\n[הודעת לקוח לגבי תשלום]: {notes.strip()[:500]}"
    db.commit()
    if first:
        _notify(db, appt, "deposit_reported", "דיווח על תשלום מקדמה")
    return first


def _notify(db: Session, appt: Appointment, kind: str, title: str) -> None:
    """The bell and a push to the owner and the managers — opens the appointment in the calendar. Never raises: the
    client's report is saved whatever happens here."""
    try:
        client = db.get(Client, appt.client_id)
        settings = db.get(StudioSettings, appt.studio_id)
        tz = pytz.timezone((settings.timezone if settings else None) or "Asia/Jerusalem")
        when = appt.starts_at.astimezone(tz).strftime("%d/%m %H:%M")
        amount = appt.deposit_amount_cents / 100
        body = f"{client.full_name if client else 'לקוח'} — ₪{amount:g} · התור ב־{when}"
        if kind == "deposit_reported" and appt.payment_proof_url:
            body += " · עם צילום"
        link = f"/calendar?appt={appt.id}"
        key = f"{kind}:{appt.id}"
        if db.scalar(select(Notification.id).where(Notification.studio_id == appt.studio_id,
                                                   Notification.dedup_key == key)):
            return
        db.add(Notification(studio_id=appt.studio_id, type=kind, title=title, body=body, action_url=link, dedup_key=key))
        db.commit()
        from app.crud.push import enqueue_push_to_studio_admins
        enqueue_push_to_studio_admins(db, appt.studio_id, title=title, body=body, deep_link=link,
                                      reminder_type="deposit_reported")
    except Exception as e:
        db.rollback()
        log.warning("deposit report notification failed for appointment %s: %s", appt.id, e)
