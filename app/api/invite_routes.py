"""
Opt-out links for automated WhatsApp messages.

Short code (8 chars, stored in client_optout_links) instead of a JWT — same
studio_id+client_id a JWT would encode, just a lot shorter in the URL. The
same client always gets the same code back (idempotent — no link rot).
Endpoint (public, no auth):
  POST /public/invite/{code}/optout  → set client.whatsapp_opted_out = True
"""
from __future__ import annotations

import logging
import secrets
import string
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db

log = logging.getLogger(__name__)

router = APIRouter(prefix="/public/invite", tags=["Invite"])

_CODE_CHARS = string.ascii_letters + string.digits


def create_invite_token(db: Session, studio_id: str, client_id: str) -> str:
    """Return this client's opt-out code, creating one if they don't have it yet."""
    existing = db.execute(
        text("SELECT code FROM client_optout_links WHERE studio_id = :sid AND client_id = :cid"),
        {"sid": str(studio_id), "cid": str(client_id)}
    ).fetchone()
    if existing:
        return existing[0]

    for _ in range(5):
        code = "".join(secrets.choice(_CODE_CHARS) for _ in range(8))
        try:
            db.execute(
                text("INSERT INTO client_optout_links (code, studio_id, client_id) VALUES (:code, :sid, :cid)"),
                {"code": code, "sid": str(studio_id), "cid": str(client_id)}
            )
            db.commit()
            return code
        except IntegrityError:
            db.rollback()
            continue
    raise RuntimeError("Could not generate a unique opt-out code")


def _resolve_code(db: Session, code: str) -> tuple[str, str] | None:
    row = db.execute(
        text("SELECT studio_id, client_id FROM client_optout_links WHERE code = :code"),
        {"code": code}
    ).fetchone()
    if not row:
        return None
    return str(row[0]), str(row[1])


_DEFAULT_OPTOUT_MESSAGE = "לחיצה על הכפתור תסיר אותך מקבלת הודעות שיווקיות מ-{studio_name}."


@router.get("/{token}/info")
def optout_page_info(token: str, db: Session = Depends(get_db)):
    """Public — branding + customizable wording for the opt-out landing page."""
    decoded = _resolve_code(db, token)
    if not decoded:
        raise HTTPException(status_code=404, detail="קישור לא תקין")
    studio_id, _client_id = decoded

    row = db.execute(
        text("""
            SELECT s.name, COALESCE(s.logo_url, mp.logo_url) AS logo_url, ss.logo_filename, ss.optout_page_message
            FROM studios s
            LEFT JOIN studio_settings ss ON ss.studio_id = s.id
            LEFT JOIN marketplace_profiles mp ON mp.studio_id = s.id
            WHERE s.id = :sid
        """),
        {"sid": studio_id}
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="לא נמצא")

    studio_name = row[0] or "העסק"
    logo_url = row[1] or (f"/uploads/{row[2]}" if row[2] else None)
    template = row[3] or _DEFAULT_OPTOUT_MESSAGE
    message = template.replace("{studio_name}", studio_name)

    return {"studio_name": studio_name, "logo_url": logo_url, "message": message}


@router.post("/{token}/optout")
def optout_via_invite(token: str, db: Session = Depends(get_db)):
    """Opt the client out of all automated WhatsApp messages."""
    decoded = _resolve_code(db, token)
    if not decoded:
        raise HTTPException(status_code=404, detail="קישור לא תקין")
    studio_id, client_id = decoded

    from app.models.client import Client
    client = db.get(Client, UUID(client_id))
    if not client or str(client.studio_id) != studio_id:
        raise HTTPException(status_code=404, detail="לא נמצא")

    client.whatsapp_opted_out = True
    db.commit()
    log.info("Client %s opted out via link (studio %s)", client_id, studio_id)
    return {"ok": True}
