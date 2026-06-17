"""Wait List — clients waiting for an earlier/specific slot."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db
from app.models.wait_list import WaitListEntry

from app.core.features import require_module
router = APIRouter(prefix="/wait-list", tags=["WaitList"], dependencies=[Depends(require_module("wait_list"))])


class WaitListAdd(BaseModel):
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    client_phone: Optional[str] = None
    service_id: Optional[str] = None
    preferred_artist_id: Optional[str] = None
    notes: Optional[str] = None


def _out(e: WaitListEntry) -> dict:
    return {
        "id": str(e.id),
        "studio_id": str(e.studio_id),
        "client_id": str(e.client_id) if e.client_id else None,
        "client_name": e.client_name,
        "client_phone": e.client_phone,
        "service_id": str(e.service_id) if e.service_id else None,
        "preferred_artist_id": str(e.preferred_artist_id) if e.preferred_artist_id else None,
        "notes": e.notes,
        "status": e.status,
        "notified_at": e.notified_at.isoformat() if e.notified_at else None,
        "created_at": e.created_at.isoformat(),
    }


@router.get("")
def list_wait_list(
    status_filter: Optional[str] = None,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    q = select(WaitListEntry).where(WaitListEntry.studio_id == ctx.studio_id)
    if status_filter:
        q = q.where(WaitListEntry.status == status_filter)
    else:
        q = q.where(WaitListEntry.status.in_(["waiting", "notified"]))
    q = q.order_by(WaitListEntry.created_at.asc())
    return [_out(e) for e in db.scalars(q).all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def add_to_wait_list(
    payload: WaitListAdd,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    entry = WaitListEntry(
        studio_id=ctx.studio_id,
        client_id=uuid.UUID(payload.client_id) if payload.client_id else None,
        client_name=payload.client_name,
        client_phone=payload.client_phone,
        service_id=uuid.UUID(payload.service_id) if payload.service_id else None,
        preferred_artist_id=uuid.UUID(payload.preferred_artist_id) if payload.preferred_artist_id else None,
        notes=payload.notes,
        status="waiting",
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _out(entry)


@router.post("/{entry_id}/notify")
def notify_wait_list_entry(
    entry_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Manually notify a specific waitlisted client that a slot opened."""
    entry = db.scalar(select(WaitListEntry).where(
        WaitListEntry.id == entry_id, WaitListEntry.studio_id == ctx.studio_id
    ))
    if not entry:
        raise HTTPException(404, "Entry not found")
    _send_wait_list_notification(db, entry, ctx.studio_id)
    entry.status = "notified"
    entry.notified_at = datetime.now(timezone.utc)
    db.commit()
    return _out(entry)


@router.post("/{entry_id}/confirm")
def confirm_wait_list_entry(
    entry_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    entry = db.scalar(select(WaitListEntry).where(
        WaitListEntry.id == entry_id, WaitListEntry.studio_id == ctx.studio_id
    ))
    if not entry:
        raise HTTPException(404, "Entry not found")
    entry.status = "confirmed"
    entry.confirmed_at = datetime.now(timezone.utc)
    db.commit()
    return _out(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_wait_list_entry(
    entry_id: uuid.UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    entry = db.scalar(select(WaitListEntry).where(
        WaitListEntry.id == entry_id, WaitListEntry.studio_id == ctx.studio_id
    ))
    if not entry:
        raise HTTPException(404, "Entry not found")
    db.delete(entry)
    db.commit()


# ── Internal: auto-notify on cancellation ─────────────────────────────────────

def notify_wait_list_on_cancellation(db: Session, studio_id, service_id=None) -> int:
    """
    Called when an appointment is canceled.
    Notifies the next waiting client(s) that a slot opened.
    Returns number of clients notified.
    """
    q = select(WaitListEntry).where(
        WaitListEntry.studio_id == studio_id,
        WaitListEntry.status == "waiting",
    ).order_by(WaitListEntry.created_at.asc())

    if service_id:
        # Prefer matching service, fall back to any
        matching = db.scalars(q.where(WaitListEntry.service_id == service_id).limit(3)).all()
        if not matching:
            matching = db.scalars(q.where(WaitListEntry.service_id == None).limit(3)).all()  # noqa
    else:
        matching = db.scalars(q.limit(3)).all()

    notified = 0
    for entry in matching:
        try:
            _send_wait_list_notification(db, entry, studio_id)
            entry.status = "notified"
            entry.notified_at = datetime.now(timezone.utc)
            notified += 1
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Failed to notify wait list entry %s", entry.id)

    if notified:
        db.commit()
    return notified


def _send_wait_list_notification(db: Session, entry: WaitListEntry, studio_id) -> None:
    """Send WhatsApp notification to the waitlisted client."""
    from app.models.studio import Studio
    from app.models.message_job import MessageJob

    studio = db.get(Studio, studio_id)
    phone = entry.client_phone
    if not phone and entry.client_id:
        from app.models.client import Client
        client = db.get(Client, entry.client_id)
        if client:
            phone = client.phone
            if not entry.client_name:
                entry.client_name = client.full_name

    if not phone:
        return

    import os as _os
    studio_name = studio.name if studio else "הסטודיו"
    name = entry.client_name or "שלום"
    slug = studio.slug if studio else ""
    bizfind_url = _os.environ.get("BIZFIND_URL", "https://find-biz.com")
    booking_url = f"{bizfind_url}/b/{slug}/book" if slug else ""
    booking_line = f"\n\nלקביעת תור מהיר:\n{booking_url}" if booking_url else ""

    from app.models.studio_settings import StudioSettings as _WLSettings
    _wl_settings = db.get(_WLSettings, studio_id)
    custom_tpl = getattr(_wl_settings, "waitlist_notify_wa_template", None) if _wl_settings else None
    if custom_tpl:
        from app.crud.automation import format_template
        body = format_template(custom_tpl, {
            "client_name": name,
            "studio_name": studio_name,
            "booking_link": booking_url,
        })
    else:
        body = (
            f"שלום {name}! 🎉\n\n"
            f"התפנה מקום ב{studio_name}!{booking_line}\n\n"
            f"המקום לא שמור — קבע/י מהר 📅"
        )

    db.add(MessageJob(
        studio_id=studio_id,
        client_id=entry.client_id,
        channel="whatsapp",
        to_phone=phone,
        body=body,
        scheduled_at=datetime.now(timezone.utc),
        status="pending",
        reminder_type="waitlist_notify",
    ))
