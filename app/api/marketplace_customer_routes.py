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

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/marketplace/auth", tags=["MarketplaceAuth"])

JWT_SECRET = os.getenv("JWT_SECRET", "bizcontrol_secret")
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


def _send_sms(phone: str, code: str):
    """Send OTP via WhatsApp message-job or fallback to logging."""
    try:
        # Try to send via whatever SMS/WhatsApp provider is available
        # For now log it — integrate with real SMS provider here
        import logging
        logging.getLogger(__name__).info(f"[OTP] {phone} → {code}")

        # Try to send via Green API or Twilio if configured
        twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
        twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
        twilio_from = os.getenv("TWILIO_FROM_NUMBER")
        if twilio_sid and twilio_token and twilio_from:
            from twilio.rest import Client as TwilioClient
            client = TwilioClient(twilio_sid, twilio_token)
            client.messages.create(
                body=f"קוד האימות שלך ב-BizFind: {code}",
                from_=twilio_from,
                to=phone,
            )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"SMS send failed: {e}")


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

    _send_sms(phone, code)

    return {"ok": True, "expires_in_seconds": OTP_TTL_MINUTES * 60}


@router.post("/verify-otp")
def verify_otp(body: VerifyOTPIn, db: Session = Depends(get_db)):
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
