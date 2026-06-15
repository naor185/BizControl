"""
BizFind Marketplace Customer Auth API

POST /api/marketplace/auth/request-otp  — send OTP to phone
POST /api/marketplace/auth/verify-otp   — verify OTP, return JWT + customer
POST /api/marketplace/auth/complete     — set name (first-time users)
GET  /api/marketplace/auth/me           — get profile (JWT required)
POST /api/marketplace/auth/favorites    — toggle favorite studio
GET  /api/marketplace/auth/favorites    — list favorites
GET  /api/marketplace/auth/linked/{slug} — check if customer is a client of this studio
"""
from __future__ import annotations

import os
import random
import string
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import JWT_SECRET
from app.core.limiter import limiter

router = APIRouter(prefix="/marketplace/auth", tags=["MarketplaceAuth"])

OTP_TTL_MINUTES = 10


# ── Simple models (no SQLAlchemy ORM — raw SQL for speed) ────────────────────

def _gen_otp() -> str:
    return "".join(random.choices(string.digits, k=5))


def _make_token(customer_id: str) -> str:
    import jwt as pyjwt
    return pyjwt.encode(
        {"sub": customer_id, "type": "marketplace_customer", "iat": datetime.now(timezone.utc)},
        JWT_SECRET, algorithm="HS256"
    )


def _verify_token(token: str) -> str:
    import jwt as pyjwt
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "marketplace_customer":
            raise ValueError
        return payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="טוקן לא תקין")


def _get_customer_id(authorization: str = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="לא מחובר")
    return _verify_token(authorization[7:])


def _send_sms(phone: str, code: str, db=None):
    """Send OTP via WhatsApp (Green API). Credentials stored in platform_config."""
    import logging
    log = logging.getLogger(__name__)
    log.info(f"[OTP] {phone} → {code}")

    # Normalize to international format
    clean = phone.lstrip("+").replace("-", "").replace(" ", "")
    if clean.startswith("0"):
        clean = "972" + clean[1:]
    chat_id = clean + "@c.us"
    msg = f"קוד האימות שלך ב-BizFind: *{code}*\n\nהקוד תקף ל-5 דקות."

    # Read platform Green API credentials (single source of truth)
    wa_instance, wa_token = None, None
    if db is not None:
        try:
            from sqlalchemy import text as _text
            ri = db.execute(_text("SELECT value FROM platform_config WHERE key='platform_wa_instance'")).fetchone()
            rt = db.execute(_text("SELECT value FROM platform_config WHERE key='platform_wa_token'")).fetchone()
            wa_instance = ri[0] if ri else None
            wa_token    = rt[0] if rt else None
        except Exception as e:
            log.warning(f"platform_config read failed: {e}")

    # Fallback: env vars
    if not wa_instance or not wa_token:
        wa_instance = os.getenv("BIZFIND_WA_INSTANCE")
        wa_token    = os.getenv("BIZFIND_WA_TOKEN")

    if wa_instance and wa_token:
        try:
            import requests as _req
            url = f"https://api.green-api.com/waInstance{wa_instance}/sendMessage/{wa_token}"
            _req.post(url, json={"chatId": chat_id, "message": msg}, timeout=10)
            return
        except Exception as e:
            log.warning(f"Green API OTP send failed: {e}")

    # 3. Fallback: Twilio SMS
    twilio_sid   = os.getenv("TWILIO_ACCOUNT_SID")
    twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
    twilio_from  = os.getenv("TWILIO_FROM_NUMBER")
    if twilio_sid and twilio_token and twilio_from:
        try:
            from twilio.rest import Client as TwilioClient
            TwilioClient(twilio_sid, twilio_token).messages.create(
                body=f"קוד האימות שלך ב-BizFind: {code}",
                from_=twilio_from,
                to=f"+{clean}",
            )
            return
        except Exception as e:
            log.warning(f"Twilio OTP send failed: {e}")


# ── Schemas ───────────────────────────────────────────────────────────────────

class RequestOTPIn(BaseModel):
    phone: str

class VerifyOTPIn(BaseModel):
    phone: str
    code: str

class CompleteProfileIn(BaseModel):
    first_name: str
    last_name: str
    city: Optional[str] = None

class ToggleFavoriteIn(BaseModel):
    studio_slug: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/request-otp")
def request_otp(body: RequestOTPIn, db: Session = Depends(get_db)):
    phone = body.phone.strip().replace("-", "").replace(" ", "")
    if not phone or len(phone) < 9:
        raise HTTPException(status_code=400, detail="מספר טלפון לא תקין")

    code = _gen_otp()
    expires = datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)

    # Invalidate old OTPs for this phone
    db.execute(text("UPDATE marketplace_otps SET used_at = NOW() WHERE phone = :phone AND used_at IS NULL"), {"phone": phone})

    db.execute(
        text("INSERT INTO marketplace_otps (id, phone, code, expires_at) VALUES (:id, :phone, :code, :exp)"),
        {"id": str(uuid.uuid4()), "phone": phone, "code": code, "exp": expires}
    )
    db.commit()

    _send_sms(phone, code, db=db)

    return {"ok": True, "expires_in_seconds": OTP_TTL_MINUTES * 60}


@router.post("/verify-otp")
@limiter.limit("5/minute")
def verify_otp(request: Request, body: VerifyOTPIn, db: Session = Depends(get_db)):
    phone = body.phone.strip().replace("-", "").replace(" ", "")
    now = datetime.now(timezone.utc)

    row = db.execute(
        text("""
            SELECT id FROM marketplace_otps
            WHERE phone = :phone AND code = :code
              AND expires_at > :now AND used_at IS NULL
            ORDER BY created_at DESC LIMIT 1
        """),
        {"phone": phone, "code": body.code.strip(), "now": now}
    ).fetchone()

    if not row:
        raise HTTPException(status_code=400, detail="קוד שגוי או פג תוקף")

    # Mark OTP used
    db.execute(text("UPDATE marketplace_otps SET used_at = NOW() WHERE id = :id"), {"id": str(row[0])})

    # Find or create customer
    customer = db.execute(
        text("SELECT id, first_name, last_name, city FROM marketplace_customers WHERE phone = :phone"),
        {"phone": phone}
    ).fetchone()

    is_new = False
    if customer:
        cid = str(customer[0])
        db.execute(text("UPDATE marketplace_customers SET last_login_at = NOW() WHERE id = :id"), {"id": cid})
        db.commit()
        return {
            "token": _make_token(cid),
            "is_new": False,
            "customer": {
                "id": cid,
                "first_name": customer[1],
                "last_name": customer[2],
                "city": customer[3],
                "phone": phone,
            }
        }
    else:
        # New customer — create minimal record, needs name
        cid = str(uuid.uuid4())
        db.execute(
            text("INSERT INTO marketplace_customers (id, phone, last_login_at) VALUES (:id, :phone, NOW())"),
            {"id": cid, "phone": phone}
        )
        db.commit()
        return {
            "token": _make_token(cid),
            "is_new": True,
            "customer": {"id": cid, "first_name": "", "last_name": "", "city": None, "phone": phone}
        }


@router.post("/complete")
def complete_profile(
    body: CompleteProfileIn,
    db: Session = Depends(get_db),
    customer_id: str = Depends(_get_customer_id),
):
    first = body.first_name.strip()
    last = body.last_name.strip()
    if not first or not last:
        raise HTTPException(status_code=400, detail="שם פרטי ושם משפחה נדרשים")

    db.execute(
        text("UPDATE marketplace_customers SET first_name=:f, last_name=:l, city=:c WHERE id=:id"),
        {"f": first, "l": last, "c": body.city, "id": customer_id}
    )
    db.commit()
    return {"ok": True}


@router.get("/me")
def get_me(
    db: Session = Depends(get_db),
    customer_id: str = Depends(_get_customer_id),
):
    row = db.execute(
        text("SELECT id, phone, first_name, last_name, city, created_at FROM marketplace_customers WHERE id = :id"),
        {"id": customer_id}
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="לקוח לא נמצא")

    favs = db.execute(
        text("SELECT studio_slug FROM marketplace_favorites WHERE customer_id = :cid ORDER BY created_at DESC"),
        {"cid": customer_id}
    ).fetchall()

    return {
        "id": str(row[0]),
        "phone": row[1],
        "first_name": row[2] or "",
        "last_name": row[3] or "",
        "full_name": f"{row[2] or ''} {row[3] or ''}".strip(),
        "city": row[4],
        "created_at": row[5].isoformat() if row[5] else None,
        "favorites": [f[0] for f in favs],
    }


@router.post("/favorites")
def toggle_favorite(
    body: ToggleFavoriteIn,
    db: Session = Depends(get_db),
    customer_id: str = Depends(_get_customer_id),
):
    existing = db.execute(
        text("SELECT id FROM marketplace_favorites WHERE customer_id=:cid AND studio_slug=:slug"),
        {"cid": customer_id, "slug": body.studio_slug}
    ).fetchone()

    if existing:
        db.execute(text("DELETE FROM marketplace_favorites WHERE id=:id"), {"id": str(existing[0])})
        db.commit()
        return {"is_favorite": False}
    else:
        db.execute(
            text("INSERT INTO marketplace_favorites (id, customer_id, studio_slug) VALUES (:id, :cid, :slug)"),
            {"id": str(uuid.uuid4()), "cid": customer_id, "slug": body.studio_slug}
        )
        db.commit()
        return {"is_favorite": True}


@router.get("/my-invoices")
def my_invoices(
    db: Session = Depends(get_db),
    customer_id: str = Depends(_get_customer_id),
):
    customer_row = db.execute(
        text("SELECT phone FROM marketplace_customers WHERE id = :id"),
        {"id": customer_id}
    ).fetchone()
    if not customer_row:
        return []

    phone = customer_row[0]
    # Only show invoices from studios where this customer has actually booked
    # (prevents leaking another studio's billing data to someone who shares a phone number)
    rows = db.execute(
        text("""
            SELECT DISTINCT i.id, i.doc_type, i.doc_number, i.status,
                   i.total_cents, i.issued_at, i.business_name
            FROM invoices i
            JOIN clients c ON c.studio_id = i.studio_id AND c.phone = :phone
            WHERE i.client_phone = :phone AND i.doc_type != 'credit'
            ORDER BY i.issued_at DESC LIMIT 50
        """),
        {"phone": phone}
    ).fetchall()

    DOC_LABELS = {
        "receipt": "קבלה", "invoice_tax_receipt": "חשבונית מס/קבלה",
        "invoice_tax": "חשבונית מס", "transaction": "חשבונית עסקה",
    }
    return [
        {
            "id": str(r[0]), "doc_type": r[1],
            "doc_type_label": DOC_LABELS.get(r[1], r[1]),
            "doc_number": r[2], "status": r[3],
            "total_ils": round((r[4] or 0) / 100, 2),
            "issued_at": r[5].isoformat() if r[5] else None,
            "business_name": r[6],
        }
        for r in rows
    ]


@router.get("/linked/{slug}")
def check_linked(
    slug: str,
    db: Session = Depends(get_db),
    customer_id: str = Depends(_get_customer_id),
):
    """Check if this customer is already a client of the given studio."""
    from app.models.client import Client
    from app.models.studio import Studio
    from sqlalchemy import select as sa_select

    customer_row = db.execute(
        text("SELECT phone FROM marketplace_customers WHERE id = :id"),
        {"id": customer_id}
    ).fetchone()
    if not customer_row:
        return {"is_client": False}

    phone = customer_row[0]

    studio = db.execute(
        text("SELECT id FROM studios WHERE slug = :slug"),
        {"slug": slug}
    ).fetchone()
    if not studio:
        return {"is_client": False}

    studio_id = studio[0]

    client = db.execute(
        text("""
            SELECT c.id, c.full_name, c.loyalty_points, c.is_club_member
            FROM clients c
            WHERE c.studio_id = :sid AND c.phone = :phone AND c.is_active = true
            LIMIT 1
        """),
        {"sid": studio_id, "phone": phone}
    ).fetchone()

    if not client:
        return {"is_client": False}

    # Get appointment count + total paid
    appt_count = db.execute(
        text("SELECT COUNT(*) FROM appointments WHERE studio_id=:sid AND client_id=:cid AND status != 'canceled'"),
        {"sid": studio_id, "cid": client[0]}
    ).scalar() or 0

    total_paid = db.execute(
        text("SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE studio_id=:sid AND client_id=:cid AND status='paid'"),
        {"sid": studio_id, "cid": client[0]}
    ).scalar() or 0

    return {
        "is_client": True,
        "client_id": str(client[0]),
        "full_name": client[1],
        "loyalty_points": int(client[2] or 0),
        "is_club_member": client[3],
        "appointment_count": appt_count,
        "total_paid_ils": round(total_paid / 100, 2),
    }


@router.get("/my-bookings")
def my_bookings(db: Session = Depends(get_db), customer_id: str = Depends(_get_customer_id)):
    row = db.execute(text("SELECT phone FROM marketplace_customers WHERE id = :id"), {"id": customer_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="לקוח לא נמצא")
    phone = row[0]
    rows = db.execute(text("""
        SELECT a.id, a.starts_at, a.status, a.notes,
               s.name AS studio_name, s.slug AS studio_slug,
               sv.name AS service_name,
               u.display_name AS artist_name
        FROM appointments a
        JOIN clients c ON c.id = a.client_id AND c.phone = :phone
        JOIN studios s ON s.id = a.studio_id
        LEFT JOIN services sv ON sv.id = a.service_id
        LEFT JOIN users u ON u.id = a.artist_id
        ORDER BY a.starts_at DESC
        LIMIT 50
    """), {"phone": phone}).fetchall()
    return [
        {
            "id": str(r[0]),
            "starts_at": r[1].isoformat() if r[1] else None,
            "status": r[2],
            "notes": r[3],
            "studio_name": r[4],
            "studio_slug": r[5],
            "service_name": r[6],
            "artist_name": r[7],
        }
        for r in rows
    ]
