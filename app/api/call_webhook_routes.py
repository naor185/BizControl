"""
BizControl Voice — Phase 2: Voicenter CDR webhook receiver.

Public endpoint (no BizControl auth — Voicenter calls this directly), one
per studio: POST /api/webhook/voicenter/{studio_id}. The studio pastes this
exact URL into their own Voicenter account's webhook/CDR-notification
settings when they set up telephony (mirrors the existing per-studio
webhook pattern used for Green API WhatsApp — see webhook_routes.py's
/webhook/green/{instance_id}).

Field names below (ivruniqueid, direction, caller, target, did, duration,
actualCallDuration, isAnswer, status, record) come from Voicenter's public
CDR Notification System API docs. NOT verified against a live account yet
— once real payloads are observed, adjust field mapping here if needed.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Request, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.features import _is_feature_enabled
from app.models.studio import Studio
from app.models.call import Call
from app.models.client import Client
from app.services.call_ai import process_call_recording

log = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook/voicenter", tags=["Voice"])


async def _parse_payload(request: Request) -> dict:
    """Voicenter can send POST-JSON, XML-RPC, or form-urlencoded. We support
    JSON and form-urlencoded (the two common cases); XML-RPC isn't handled
    yet — set the CDR format to JSON or form in the Voicenter account config."""
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            return await request.json()
        except Exception:
            return {}
    try:
        form = await request.form()
        return dict(form)
    except Exception:
        return {}


def _to_int(v, default=None):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


@router.post("/{studio_id}")
async def voicenter_cdr(studio_id: str, request: Request, db: Session = Depends(get_db)):
    try:
        sid = uuid.UUID(studio_id)
    except ValueError:
        return {"status": "ignored"}

    studio = db.get(Studio, sid)
    if not studio or not studio.is_active:
        return {"status": "ignored"}
    if not _is_feature_enabled(db, sid, "voice"):
        return {"status": "ignored"}

    payload = await _parse_payload(request)
    if not payload:
        return {"status": "ignored"}

    raw_direction = str(payload.get("direction", "")).lower()
    if raw_direction not in ("incoming", "outgoing"):
        # "internal" (extension-to-extension) calls aren't client calls — skip.
        return {"status": "ignored"}
    direction = "inbound" if raw_direction == "incoming" else "outbound"

    caller = str(payload.get("caller", "")).strip()
    target = str(payload.get("target", "")).strip()
    did = str(payload.get("did", "")).strip()
    # Inbound: caller = client's number, did = the studio number they dialed.
    # Outbound: caller = the studio's agent/extension, target = the client's number.
    if direction == "inbound":
        from_number, to_number = caller, (did or target)
    else:
        from_number, to_number = caller, target

    external_id = str(payload.get("ivruniqueid", "")).strip() or None
    duration = _to_int(payload.get("actualCallDuration")) or _to_int(payload.get("duration")) or 0
    is_answer = str(payload.get("isAnswer", "0")) == "1" or str(payload.get("status", "")).upper() == "ANSWER"
    status = "answered" if is_answer else "missed"
    recording_url = str(payload.get("record", "")).strip() or None
    epoch = _to_int(payload.get("time"))
    started_at = datetime.fromtimestamp(epoch, tz=timezone.utc) if epoch else datetime.now(timezone.utc)

    client_phone = from_number if direction == "inbound" else to_number
    client_phone_clean = client_phone.replace("-", "").replace(" ", "") if client_phone else ""

    call = None
    if external_id:
        call = db.scalar(select(Call).where(Call.studio_id == sid, Call.external_call_id == external_id))

    if call:
        call.duration_seconds = duration or call.duration_seconds
        call.status = status
        if recording_url:
            call.recording_url = recording_url
        db.commit()
    else:
        client = None
        if client_phone_clean:
            client = db.scalar(select(Client).where(Client.studio_id == sid, Client.phone == client_phone_clean))
        call = Call(
            studio_id=sid,
            direction=direction,
            from_number=from_number or "unknown",
            to_number=to_number or "unknown",
            client_id=client.id if client else None,
            started_at=started_at,
            duration_seconds=duration,
            status=status,
            recording_url=recording_url,
            external_call_id=external_id,
        )
        db.add(call)
        db.commit()
        db.refresh(call)

    if call.recording_url and not call.transcript:
        # process_call_recording does blocking HTTP + AI calls — keep it off
        # the event loop so it doesn't stall other requests on this worker.
        from fastapi.concurrency import run_in_threadpool
        await run_in_threadpool(process_call_recording, db, call)

    return {"status": "ok"}
