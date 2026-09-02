"""
BizFind auto-imported businesses — public discovery + Claim flow.

GET  /api/businesses                          — list/search unclaimed businesses
GET  /api/businesses/{slug}                    — public profile of one business
POST /api/businesses/{id}/claim/request-otp    — send OTP to the business's public phone
POST /api/businesses/{id}/claim/verify-otp     — verify code, returns a short-lived claim_token
POST /api/businesses/{id}/claim/complete       — create the real Studio+User, auto-login

Businesses imported from an external source (OpenStreetMap etc.) live in the
`businesses` table, never in `studios` — a business only becomes a real
studio once its owner claims it here. See `business_sources` for where each
business's data actually came from.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import JWT_SECRET

log = logging.getLogger(__name__)
router = APIRouter(prefix="/businesses", tags=["Businesses"])

CLAIM_TOKEN_TTL_MINUTES = 15


def _slugify(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug, flags=re.UNICODE)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:48] or "business"


def _make_claim_token(business_id: str, phone: str) -> str:
    import jwt as pyjwt
    now = datetime.now(timezone.utc)
    return pyjwt.encode(
        {
            "business_id": business_id,
            "phone": phone,
            "type": "business_claim",
            "iat": now,
            "exp": now + timedelta(minutes=CLAIM_TOKEN_TTL_MINUTES),
        },
        JWT_SECRET, algorithm="HS256",
    )


def _verify_claim_token(token: str, business_id: str) -> str:
    """Returns the OTP-verified phone number, or raises HTTPException."""
    import jwt as pyjwt
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="האימות פג תוקף, יש להתחיל מחדש")
    except Exception:
        raise HTTPException(status_code=400, detail="טוקן אימות לא תקין")
    if payload.get("type") != "business_claim" or payload.get("business_id") != business_id:
        raise HTTPException(status_code=400, detail="טוקן אימות לא תקין")
    return payload["phone"]


def _get_business_or_404(db: Session, business_id: str):
    row = db.execute(
        text("SELECT id, name, category, city, address, phone, claim_status FROM businesses WHERE id = :id"),
        {"id": business_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="עסק לא נמצא")
    return row


# ── Schemas ───────────────────────────────────────────────────────────────────

class VerifyClaimOTPIn(BaseModel):
    code: str = Field(min_length=4, max_length=6)


class CompleteClaimIn(BaseModel):
    claim_token: str
    owner_name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6)


# ── Public discovery ─────────────────────────────────────────────────────────

@router.get("")
def list_businesses(
    q: Optional[str] = None,
    category: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Public — unclaimed businesses only. Claimed ones already appear via the
    normal /api/marketplace search (sourced from the real studios table)."""
    conditions = ["claim_status = 'unclaimed'"]
    params: dict = {"limit": min(limit, 50), "offset": offset}
    if q:
        conditions.append("name ILIKE :q")
        params["q"] = f"%{q}%"
    if category:
        conditions.append("category = :category")
        params["category"] = category
    if city:
        conditions.append("city ILIKE :city")
        params["city"] = f"%{city}%"

    where = " AND ".join(conditions)
    rows = db.execute(
        text(f"""
            SELECT id, slug, name, category, city, address, phone, latitude, longitude, description, claim_status
            FROM businesses WHERE {where}
            ORDER BY name LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    return {
        "businesses": [
            {
                "id": str(r[0]), "slug": r[1], "name": r[2], "category": r[3],
                "city": r[4], "address": r[5], "phone": r[6],
                "latitude": r[7], "longitude": r[8], "description": r[9],
                "claim_status": r[10],
            }
            for r in rows
        ],
        "offset": offset,
    }


@router.get("/{slug}")
def get_business(slug: str, db: Session = Depends(get_db)):
    row = db.execute(
        text("""
            SELECT id, slug, name, category, city, address, phone, latitude, longitude,
                   description, opening_hours, claim_status
            FROM businesses WHERE slug = :slug
        """),
        {"slug": slug},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="עסק לא נמצא")
    return {
        "id": str(row[0]), "slug": row[1], "name": row[2], "category": row[3],
        "city": row[4], "address": row[5], "phone": row[6],
        "latitude": row[7], "longitude": row[8], "description": row[9],
        "opening_hours": row[10], "claim_status": row[11],
    }


# ── Claim flow ────────────────────────────────────────────────────────────────

@router.post("/{business_id}/claim/request-otp")
@limiter.limit("3/minute")
def request_claim_otp(request: Request, business_id: str, db: Session = Depends(get_db)):
    from app.api.marketplace_customer_routes import _gen_otp, _send_sms, OTP_TTL_MINUTES

    biz = _get_business_or_404(db, business_id)
    if biz.claim_status == "claimed":
        raise HTTPException(status_code=409, detail="העסק כבר נתבע ע\"י בעלים")
    if not biz.phone:
        raise HTTPException(status_code=400, detail="לעסק זה אין מספר טלפון רשום לאימות")

    phone = biz.phone.strip().replace("-", "").replace(" ", "")
    code = _gen_otp()
    expires = datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)

    db.execute(text("UPDATE marketplace_otps SET used_at = NOW() WHERE phone = :phone AND used_at IS NULL"), {"phone": phone})
    db.execute(
        text("INSERT INTO marketplace_otps (id, phone, code, expires_at) VALUES (:id, :phone, :code, :exp)"),
        {"id": str(uuid.uuid4()), "phone": phone, "code": code, "exp": expires},
    )
    db.execute(text("UPDATE businesses SET claim_status = 'pending', updated_at = NOW() WHERE id = :id"), {"id": business_id})
    db.commit()

    _send_sms(phone, code, db=db)
    return {"ok": True, "expires_in_seconds": OTP_TTL_MINUTES * 60}


@router.post("/{business_id}/claim/verify-otp")
@limiter.limit("5/minute")
def verify_claim_otp(request: Request, business_id: str, body: VerifyClaimOTPIn, db: Session = Depends(get_db)):
    biz = _get_business_or_404(db, business_id)
    if not biz.phone:
        raise HTTPException(status_code=400, detail="לעסק זה אין מספר טלפון רשום")
    phone = biz.phone.strip().replace("-", "").replace(" ", "")
    now = datetime.now(timezone.utc)

    row = db.execute(
        text("""
            SELECT id FROM marketplace_otps
            WHERE phone = :phone AND code = :code AND expires_at > :now AND used_at IS NULL
            ORDER BY created_at DESC LIMIT 1
        """),
        {"phone": phone, "code": body.code.strip(), "now": now},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="קוד שגוי או פג תוקף")

    db.execute(text("UPDATE marketplace_otps SET used_at = NOW() WHERE id = :id"), {"id": str(row[0])})
    db.commit()

    return {"claim_token": _make_claim_token(business_id, phone)}


@router.post("/{business_id}/claim/complete", status_code=201)
def complete_claim(business_id: str, payload: CompleteClaimIn, db: Session = Depends(get_db)):
    """Verifies the claim_token from verify-otp, then creates a real Studio +
    owner User — same shape as marketplace_routes.bizfind_register, kept as
    its own implementation (not a shared helper) so this new flow can't
    regress the existing production self-registration path."""
    from app.models.studio import Studio
    from app.models.studio_settings import StudioSettings
    from app.models.user import User
    from app.models.refresh_token import RefreshToken
    from app.core.security import create_access_token, create_refresh_token
    from app.core.billing import apply_subscription_event
    from argon2 import PasswordHasher

    biz = _get_business_or_404(db, business_id)
    if biz.claim_status == "claimed":
        raise HTTPException(status_code=409, detail="העסק כבר נתבע ע\"י בעלים")

    _verify_claim_token(payload.claim_token, business_id)

    ph = PasswordHasher()
    email = payload.email.lower().strip()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="כתובת המייל כבר רשומה במערכת")

    base_slug = _slugify(biz.name)
    slug = base_slug
    counter = 1
    while db.scalar(select(Studio).where(Studio.slug == slug)):
        slug = f"{base_slug}-{counter}"
        counter += 1

    trial_days = 14
    expires = datetime.now(timezone.utc) + timedelta(days=trial_days)

    studio = Studio(
        id=uuid.uuid4(),
        name=biz.name,
        slug=slug,
        subscription_plan="trial",
        business_type=biz.category,
        is_active=True,
        plan_expires_at=expires,
        is_platform=False,
    )
    db.add(studio)
    db.flush()

    settings = StudioSettings(
        studio_id=studio.id,
        studio_address=biz.address or biz.city or "",
        marketplace_city=biz.city,
        marketplace_phone=biz.phone,
        marketplace_visible=True,
    )
    db.add(settings)

    import secrets
    verify_token = secrets.token_urlsafe(32)
    owner = User(
        id=uuid.uuid4(),
        studio_id=studio.id,
        email=email,
        password_hash=ph.hash(payload.password),
        role="owner",
        display_name=payload.owner_name.strip(),
        phone=biz.phone,
        is_active=True,
        email_verified=False,
        email_verify_token=verify_token,
        email_verify_sent_at=datetime.now(timezone.utc),
    )
    db.add(owner)
    db.flush()

    apply_subscription_event(
        db, studio.id, "trial_started", source="business_claim",
        plan_id="trial",
        current_period_start=datetime.now(timezone.utc),
        current_period_end=expires,
        trial_ends_at=expires,
    )

    db.execute(
        text("UPDATE businesses SET claim_status='claimed', claimed_studio_id=:sid, claimed_at=NOW(), updated_at=NOW() WHERE id=:id"),
        {"sid": str(studio.id), "id": business_id},
    )

    access = create_access_token({"user_id": str(owner.id), "studio_id": str(studio.id), "role": "owner"})
    refresh = create_refresh_token({"user_id": str(owner.id), "studio_id": str(studio.id)})
    db.add(RefreshToken(id=uuid.uuid4(), studio_id=studio.id, user_id=owner.id, token=refresh, is_revoked=False))
    db.commit()

    try:
        import os
        from app.services.email_center import send_email
        from app.utils.email_templates import verify_email_html, new_business_admin_email_html

        bizfind_url = os.getenv("BIZFIND_URL", "https://find.biz-control.com").rstrip("/")
        verify_link = f"{bizfind_url}/verify-email?token={verify_token}"
        send_email(
            db, to_email=email, subject="אימות כתובת המייל — BizControl",
            html_content=verify_email_html(payload.owner_name.strip(), verify_link),
            from_name="BizControl", studio_id=str(studio.id),
            template_key="verify_email", email_type="system",
        )
        send_email(
            db, to_email="bizcontrol.system@gmail.com",
            subject=f"עסק תבע בעלות (Claim): {studio.name}",
            html_content=new_business_admin_email_html(
                business_name=studio.name, owner_name=payload.owner_name.strip(),
                email=email, phone=biz.phone or "—", plan_label="ניסיון (Claim)", city=biz.city or "—",
            ),
            from_name="BizControl", template_key="new_business_admin", email_type="system",
        )
    except Exception as e:
        log.warning("[complete_claim] notification email failed: %s", e)

    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "studio_slug": slug,
    }
