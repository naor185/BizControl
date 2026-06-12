"""
WhatsApp Multi-Tenant Management
- Per-studio Green API instance management
- QR code connection flow
- Status checking
- Message logs + stats
- Managed flow: if GREEN_API_PARTNER_TOKEN is set, auto-creates instances
- Manual flow: studio enters own credentials
"""
from __future__ import annotations

import os
import uuid
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])

GREEN_BASE = "https://api.green-api.com"
PARTNER_TOKEN = os.getenv("GREEN_API_PARTNER_TOKEN", "")


# ── Green API helpers ─────────────────────────────────────────────────────────

def _green_get(instance_id: str, api_token: str, endpoint: str) -> dict:
    url = f"{GREEN_BASE}/waInstance{instance_id}/{endpoint}/{api_token}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(500, f"Green API error {e.code}: {e.read().decode()[:200]}")
    except Exception as e:
        raise HTTPException(500, f"Green API unreachable: {str(e)[:100]}")


def _green_state(instance_id: str, api_token: str) -> str:
    """Returns: authorized | notAuthorized | blocked | sleepMode | starting"""
    try:
        data = _green_get(instance_id, api_token, "getStateInstance")
        return data.get("stateInstance", "unknown")
    except Exception:
        return "unknown"


def _green_qr(instance_id: str, api_token: str) -> dict:
    """Returns QR code as base64 or status if already authorized."""
    data = _green_get(instance_id, api_token, "qr")
    return data


def _green_get_phone(instance_id: str, api_token: str) -> Optional[str]:
    """Get the phone number linked to this instance."""
    try:
        data = _green_get(instance_id, api_token, "getWaSettings")
        return data.get("wid", "").replace("@c.us", "") or None
    except Exception:
        return None


def _green_logout(instance_id: str, api_token: str) -> None:
    url = f"{GREEN_BASE}/waInstance{instance_id}/logout/{api_token}"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=8):
            pass
    except Exception:
        pass


def _partner_create_instance() -> dict:
    """Create a new Green API instance via partner API."""
    if not PARTNER_TOKEN:
        raise HTTPException(400, "GREEN_API_PARTNER_TOKEN לא מוגדר בשרת")
    url = f"{GREEN_BASE}/partner/createInstance/{PARTNER_TOKEN}"
    req = urllib.request.Request(url, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(500, f"Partner API error: {e.read().decode()[:200]}")


def _partner_delete_instance(instance_id: str) -> None:
    if not PARTNER_TOKEN:
        return
    url = f"{GREEN_BASE}/partner/deleteInstance/{PARTNER_TOKEN}"
    payload = json.dumps({"idInstance": instance_id}).encode()
    req = urllib.request.Request(url, data=payload, method="DELETE")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=8):
            pass
    except Exception:
        pass


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_connection(studio_id: str, db: Session) -> Optional[dict]:
    row = db.execute(
        text("SELECT * FROM whatsapp_connections WHERE studio_id = :sid"),
        {"sid": studio_id}
    ).fetchone()
    return dict(row._mapping) if row else None


def _sync_to_settings(studio_id: str, instance_id: str, api_token: str, db: Session) -> None:
    """Keep studio_settings in sync for existing automations."""
    db.execute(
        text("""
            UPDATE studio_settings SET
                whatsapp_provider = 'green_api',
                whatsapp_instance_id = :iid,
                whatsapp_api_key = :key
            WHERE studio_id = :sid
        """),
        {"iid": instance_id, "key": api_token, "sid": studio_id}
    )


def _clear_settings(studio_id: str, db: Session) -> None:
    db.execute(
        text("""
            UPDATE studio_settings SET
                whatsapp_provider = NULL,
                whatsapp_instance_id = NULL,
                whatsapp_api_key = NULL
            WHERE studio_id = :sid
        """),
        {"sid": studio_id}
    )


# ── Schemas ───────────────────────────────────────────────────────────────────

class SaveCredsIn(BaseModel):
    instance_id: str
    api_token: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/status")
def get_status(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Get connection status for this studio."""
    conn = _get_connection(str(ctx.studio_id), db)

    if not conn or not conn.get("instance_id") or not conn.get("api_token"):
        # Check legacy studio_settings
        legacy = db.execute(
            text("SELECT whatsapp_instance_id, whatsapp_api_key, whatsapp_provider FROM studio_settings WHERE studio_id = :sid"),
            {"sid": str(ctx.studio_id)}
        ).fetchone()

        if legacy and legacy[0] and legacy[1]:
            state = _green_state(legacy[0], legacy[1])
            phone = _green_get_phone(legacy[0], legacy[1]) if state == "authorized" else None
            return {
                "connected": state == "authorized",
                "status": state,
                "instance_id": legacy[0],
                "phone_number": phone,
                "managed": False,
                "source": "legacy",
            }
        return {"connected": False, "status": "not_configured", "instance_id": None}

    # Check live status
    state = _green_state(conn["instance_id"], conn["api_token"])
    connected = state == "authorized"

    # Update DB if status changed
    if conn["status"] != state:
        phone = _green_get_phone(conn["instance_id"], conn["api_token"]) if connected else conn.get("phone_number")
        db.execute(
            text("""
                UPDATE whatsapp_connections SET status=:st, phone_number=:ph, updated_at=NOW(),
                last_connected_at = CASE WHEN :connected THEN NOW() ELSE last_connected_at END
                WHERE studio_id=:sid
            """),
            {"st": state, "ph": phone, "connected": connected, "sid": str(ctx.studio_id)}
        )
        db.commit()
        conn["phone_number"] = phone
        conn["status"] = state

    # Stats
    msgs_month = db.execute(
        text("""
            SELECT COUNT(*) FROM whatsapp_logs
            WHERE studio_id=:sid AND created_at >= date_trunc('month', CURRENT_DATE)
        """),
        {"sid": str(ctx.studio_id)}
    ).scalar() or 0

    return {
        "connected": connected,
        "status": state,
        "instance_id": conn["instance_id"],
        "phone_number": conn.get("phone_number"),
        "managed": conn.get("managed", False),
        "last_connected_at": conn.get("last_connected_at").isoformat() if conn.get("last_connected_at") else None,
        "messages_this_month": int(msgs_month),
    }


@router.get("/qr")
def get_qr(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """
    Get QR code to connect WhatsApp.
    If partner token configured AND no instance exists → creates one automatically.
    Otherwise → uses existing instance credentials.
    """
    conn = _get_connection(str(ctx.studio_id), db)

    # Managed flow: auto-create instance
    if not conn and PARTNER_TOKEN:
        data = _partner_create_instance()
        instance_id = str(data.get("idInstance", ""))
        api_token = str(data.get("apiTokenInstance", ""))
        if not instance_id or not api_token:
            raise HTTPException(500, "יצירת Instance נכשלה — בדוק את ה-Partner Token")

        db.execute(
            text("""
                INSERT INTO whatsapp_connections
                    (id, studio_id, instance_id, api_token, status, managed)
                VALUES (:id, :sid, :iid, :tok, 'created', true)
                ON CONFLICT (studio_id) DO UPDATE SET
                    instance_id=EXCLUDED.instance_id,
                    api_token=EXCLUDED.api_token,
                    status='created', managed=true, updated_at=NOW()
            """),
            {"id": str(uuid.uuid4()), "sid": str(ctx.studio_id), "iid": instance_id, "tok": api_token}
        )
        _sync_to_settings(str(ctx.studio_id), instance_id, api_token, db)
        db.commit()

    else:
        # Use existing credentials
        if conn:
            instance_id = conn["instance_id"]
            api_token = conn["api_token"]
        else:
            # Fall back to studio_settings
            legacy = db.execute(
                text("SELECT whatsapp_instance_id, whatsapp_api_key FROM studio_settings WHERE studio_id=:sid"),
                {"sid": str(ctx.studio_id)}
            ).fetchone()
            if not legacy or not legacy[0]:
                raise HTTPException(400, "אין Instance מוגדר — הכנס פרטי Green API תחילה")
            instance_id, api_token = legacy[0], legacy[1]

    qr_data = _green_qr(instance_id, api_token)
    qr_type = qr_data.get("type", "")

    if qr_type == "qrCode":
        return {
            "type": "qr",
            "qr_base64": qr_data.get("message", ""),
            "instance_id": instance_id,
        }
    elif qr_type == "alreadyLogged":
        phone = _green_get_phone(instance_id, api_token)
        db.execute(
            text("UPDATE whatsapp_connections SET status='authorized', phone_number=:ph, last_connected_at=NOW() WHERE studio_id=:sid"),
            {"ph": phone, "sid": str(ctx.studio_id)}
        )
        db.commit()
        return {"type": "already_connected", "phone_number": phone}
    else:
        return {"type": qr_type, "message": qr_data.get("message", "")}


@router.post("/save-credentials")
def save_credentials(
    body: SaveCredsIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Save manual Green API credentials for this studio."""
    instance_id = body.instance_id.strip()
    api_token = body.api_token.strip()
    if not instance_id or not api_token:
        raise HTTPException(400, "Instance ID ו-API Token נדרשים")

    # Verify credentials work
    state = _green_state(instance_id, api_token)

    db.execute(
        text("""
            INSERT INTO whatsapp_connections
                (id, studio_id, instance_id, api_token, status, managed, updated_at)
            VALUES (:id, :sid, :iid, :tok, :st, false, NOW())
            ON CONFLICT (studio_id) DO UPDATE SET
                instance_id=EXCLUDED.instance_id,
                api_token=EXCLUDED.api_token,
                status=EXCLUDED.status,
                managed=false,
                updated_at=NOW()
        """),
        {"id": str(uuid.uuid4()), "sid": str(ctx.studio_id), "iid": instance_id, "tok": api_token, "st": state}
    )
    _sync_to_settings(str(ctx.studio_id), instance_id, api_token, db)
    db.commit()

    return {"ok": True, "status": state, "connected": state == "authorized"}


@router.post("/disconnect")
def disconnect(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Disconnect WhatsApp — logout from Green API and clear credentials."""
    conn = _get_connection(str(ctx.studio_id), db)

    if conn and conn.get("instance_id") and conn.get("api_token"):
        # Logout from Green API
        _green_logout(conn["instance_id"], conn["api_token"])
        # Delete managed instance
        if conn.get("managed") and PARTNER_TOKEN:
            _partner_delete_instance(conn["instance_id"])

    db.execute(
        text("DELETE FROM whatsapp_connections WHERE studio_id=:sid"),
        {"sid": str(ctx.studio_id)}
    )
    _clear_settings(str(ctx.studio_id), db)
    db.commit()
    return {"ok": True}


@router.get("/logs")
def get_logs(
    limit: int = 50,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text("""
            SELECT wl.*, c.full_name AS client_name
            FROM whatsapp_logs wl
            LEFT JOIN clients c ON c.id = wl.client_id
            WHERE wl.studio_id = :sid
            ORDER BY wl.created_at DESC
            LIMIT :lim
        """),
        {"sid": str(ctx.studio_id), "lim": limit}
    ).fetchall()

    return [dict(r._mapping) for r in rows]


@router.get("/stats")
def get_stats(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    stats = db.execute(
        text("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS this_month,
                COUNT(*) FILTER (WHERE status = 'sent') AS sent_ok,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed
            FROM whatsapp_logs WHERE studio_id = :sid
        """),
        {"sid": str(ctx.studio_id)}
    ).fetchone()

    return {
        "total": stats[0] or 0,
        "this_month": stats[1] or 0,
        "sent_ok": stats[2] or 0,
        "failed": stats[3] or 0,
    }
