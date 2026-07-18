from __future__ import annotations
import os
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import AuthContext, require_studio_ctx
from app.models.broadcast import Broadcast

router = APIRouter(prefix="/broadcasts", tags=["broadcasts"])

ALLOWED_MEDIA_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "video/mp4", "video/quicktime", "video/x-msvideo", "video/3gpp", "video/webm",
}
_UPLOAD_DIR = "uploads/broadcasts"


class BroadcastCreate(BaseModel):
    title: str
    body: str
    audience: str = "all"   # all | club | non_club
    scheduled_at: datetime
    media_url: Optional[str] = None


@router.get("")
def list_broadcasts(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Broadcast)
        .where(Broadcast.studio_id == ctx.studio_id)
        .order_by(Broadcast.scheduled_at.desc())
        .limit(100)
    ).all()
    return [_out(b) for b in rows]


@router.post("/upload-media")
def upload_broadcast_media(
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Cloudinary first (permanent, reliably fetchable by Green API), local
    disk only as a fallback. Railway's local disk is ephemeral — it's wiped
    on every deploy, so a broadcast saved locally and sent even a few
    deploys later would point Green API at a 404 and silently never
    deliver the media (this exact pattern already bit receipts/logos/
    vouchers earlier — same fix applies here)."""
    if file.content_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(400, "סוג קובץ לא נתמך. מותרים: תמונות ווידאו בלבד")
    ext = (file.filename or "file").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    file_bytes = file.file.read()

    try:
        from app.api.upload_routes import _cloudinary_upload
        public_id = f"broadcast_{uuid4().hex[:10]}"
        cloud_url = _cloudinary_upload(file_bytes, folder=f"broadcasts/{ctx.studio_id}", public_id=public_id, db=db)
        if cloud_url:
            return {"url": cloud_url, "filename": public_id, "local_path": None}
    except Exception:
        pass

    os.makedirs(_UPLOAD_DIR, exist_ok=True)
    filename = f"broadcast_{ctx.studio_id}_{uuid4().hex[:10]}.{ext}"
    dest = os.path.join(_UPLOAD_DIR, filename)
    with open(dest, "wb") as buf:
        buf.write(file_bytes)
    backend_url = (
        os.getenv("API_BASE_URL") or
        (f"https://{os.getenv('RAILWAY_PUBLIC_DOMAIN')}" if os.getenv("RAILWAY_PUBLIC_DOMAIN") else "") or
        ""
    ).rstrip("/")
    local_path = dest  # e.g. uploads/broadcasts/filename.jpg
    url = f"{backend_url}/uploads/broadcasts/{filename}" if backend_url else f"/uploads/broadcasts/{filename}"
    return {"url": url, "filename": filename, "local_path": local_path}


@router.post("", status_code=201)
def create_broadcast(
    payload: BroadcastCreate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if payload.audience not in ("all", "club", "non_club"):
        raise HTTPException(400, "audience חייב להיות all / club / non_club")

    from app.models.client import Client
    q = select(Client).where(
        Client.studio_id == ctx.studio_id,
        Client.is_active == True,
        Client.phone != None,
        Client.whatsapp_opted_out == False,
    )
    if payload.audience == "club":
        q = q.where(Client.is_club_member == True)
    elif payload.audience == "non_club":
        q = q.where(Client.is_club_member == False)

    count = len(db.scalars(q).all())

    b = Broadcast(
        studio_id=ctx.studio_id,
        created_by=ctx.user_id,
        title=payload.title.strip(),
        body=payload.body.strip(),
        audience=payload.audience,
        scheduled_at=payload.scheduled_at,
        status="scheduled",
        recipient_count=count,
        media_url=payload.media_url or None,
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return _out(b)


@router.delete("/{broadcast_id}", status_code=204)
def cancel_broadcast(
    broadcast_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    b = db.scalar(
        select(Broadcast).where(
            Broadcast.id == broadcast_id,
            Broadcast.studio_id == ctx.studio_id,
        )
    )
    if not b:
        raise HTTPException(404, "תפוצה לא נמצאה")
    if b.status != "scheduled":
        raise HTTPException(400, "ניתן לבטל רק תפוצות שעדיין לא נשלחו")
    b.status = "canceled"
    db.commit()
    return None


class BroadcastTestIn(BaseModel):
    body: str
    phone: str
    media_url: Optional[str] = None


@router.post("/test")
def send_test(
    payload: BroadcastTestIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """שלח הודעת טסט למספר טלפון ספציפי לפני שמפעילים תפוצה."""
    from app.models.studio_settings import StudioSettings
    from app.services.message_worker import send_whatsapp_message

    if not payload.phone.strip():
        raise HTTPException(400, "יש להזין מספר טלפון")
    if not payload.body.strip():
        raise HTTPException(400, "יש להזין תוכן הודעה")

    preview_body = payload.body.strip()
    if "{optout_link}" in preview_body:
        # If the test number belongs to a real client, generate a genuine,
        # working opt-out link so the test is a true end-to-end check —
        # otherwise fall back to a placeholder (no client to build a token for).
        from app.models.client import Client
        client = db.scalar(
            select(Client).where(Client.studio_id == ctx.studio_id, Client.phone == payload.phone.strip())
        )
        if client:
            import os as _os
            from app.api.invite_routes import create_invite_token
            frontend_url = _os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app").rstrip("/")
            token = create_invite_token(db, str(ctx.studio_id), str(client.id))
            real_link = f"{frontend_url}/optout/{token}"
            preview_body = preview_body.replace("{optout_link}", f"להסרה מרשימת התפוצה: {real_link}")
        else:
            preview_body = preview_body.replace(
                "{optout_link}",
                "להסרה מרשימת התפוצה: [קישור הסרה אישי יופיע כאן — הוסף/י את המספר הזה כלקוח כדי לראות קישור אמיתי בבדיקה]",
            )

    settings = db.get(StudioSettings, ctx.studio_id)
    try:
        send_whatsapp_message(
            payload.phone.strip(),
            preview_body,
            settings,
            db,
            media_url=payload.media_url or None,
        )
    except ValueError as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(502, f"שגיאה בשליחה: {e}")

    return {"ok": True, "sent_to": payload.phone.strip()}


def _out(b: Broadcast) -> dict:
    return {
        "id": str(b.id),
        "title": b.title,
        "body": b.body,
        "audience": b.audience,
        "scheduled_at": b.scheduled_at.isoformat() if b.scheduled_at else None,
        "status": b.status,
        "recipient_count": b.recipient_count or 0,
        "sent_count": b.sent_count or 0,
        "media_url": b.media_url,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }
