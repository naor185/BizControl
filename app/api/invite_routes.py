"""
Opt-out links for automated WhatsApp messages.

Token: JWT (no expiry) encoding studio_id + client_id — same secret as the rest of the app.
Endpoint (public, no auth):
  POST /public/invite/{token}/optout  → set client.whatsapp_opted_out = True
"""
from __future__ import annotations

import logging
import os
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db

log = logging.getLogger(__name__)

router = APIRouter(prefix="/public/invite", tags=["Invite"])

_JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
_JWT_ALG = "HS256"


def create_invite_token(studio_id: str, client_id: str) -> str:
    from jose import jwt
    return jwt.encode(
        {"type": "invite", "studio_id": str(studio_id), "client_id": str(client_id)},
        _JWT_SECRET,
        algorithm=_JWT_ALG,
    )


def _decode(token: str) -> tuple[str, str] | None:
    from jose import jwt, JWTError
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
        if payload.get("type") != "invite":
            return None
        return payload["studio_id"], payload["client_id"]
    except (JWTError, KeyError):
        return None


@router.post("/{token}/optout")
def optout_via_invite(token: str, db: Session = Depends(get_db)):
    """Opt the client out of all automated WhatsApp messages."""
    decoded = _decode(token)
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
