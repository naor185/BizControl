"""
Client Portal — OTP-based login, then JWT-protected views.
Clients see their own appointments, payments, loyalty points, coupons, and wallet pass.
"""
from datetime import datetime, timezone, timedelta
import os
import random
import string

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import select
from pydantic import BaseModel
from jose import JWTError
from app.core.limiter import limiter

from app.core.database import get_db
from app.core.security import JWT_SECRET, JWT_ALG, decode_token
from app.models.studio import Studio
from app.models.client import Client
from app.models.appointment import Appointment
from app.models.user import User
from app.models.customer_login_otp import CustomerLoginOtp
from app.models.birthday_coupon import BirthdayCoupon
from jose import jwt as jose_jwt

router = APIRouter(prefix="/portal", tags=["Client Portal"])

PORTAL_TOKEN_HOURS = 72
OTP_VALID_MINUTES = 10
OTP_MAX_ATTEMPTS = 5


# ── Token helpers ──────────────────────────────────────────────────────────────

def create_portal_token(client_id: str, studio_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=PORTAL_TOKEN_HOURS)
    return jose_jwt.encode(
        {"type": "client_portal", "client_id": client_id, "studio_id": studio_id, "exp": expire},
        JWT_SECRET, algorithm=JWT_ALG,
    )


def get_portal_client(token: str, db: Session) -> tuple[Client, Studio]:
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired portal token")
    if payload.get("type") != "client_portal":
        raise HTTPException(status_code=401, detail="Invalid token type")
    client_id = payload.get("client_id")
    studio_id = payload.get("studio_id")
    client = db.get(Client, client_id)
    studio = db.get(Studio, studio_id)
    if not client or not studio:
        raise HTTPException(status_code=401, detail="Client not found")
    return client, studio


from fastapi import Header

async def portal_auth(
    authorization: str = Header(...),
    db: Session = Depends(get_db),
) -> tuple[Client, Studio]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.removeprefix("Bearer ").strip()
    return get_portal_client(token, db)


# ── Schemas ────────────────────────────────────────────────────────────────────

class OtpRequestIn(BaseModel):
    studio_slug: str
    phone: str


class OtpVerifyIn(BaseModel):
    studio_slug: str
    phone: str
    code: str


class AppointmentOut(BaseModel):
    id: str
    title: str
    starts_at: datetime
    ends_at: datetime
    status: str
    artist_name: str
    total_price_cents: int
    deposit_amount_cents: int
    can_cancel: bool


class CouponOut(BaseModel):
    code: str
    discount_percent: int
    expires_at: str
    status: str


class CardOut(BaseModel):
    qr_token: str
    full_name: str
    loyalty_points: int
    is_club_member: bool
    studio_name: str
    background_color: str
    text_color: str
    strip_color: str
    label_color: str
    logo_url: str | None
    card_title: str | None
    apple_wallet_enabled: bool
    google_wallet_enabled: bool
    apple_wallet_url: str | None
    google_wallet_url: str | None


# ── OTP helpers ────────────────────────────────────────────────────────────────

def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


def _send_otp(client: Client, studio: Studio, code: str, channel: str, db: Session) -> None:
    """Queue an OTP via WhatsApp (primary) or email (fallback)."""
    from app.models.studio_settings import StudioSettings
    from app.models.message_job import MessageJob

    settings = db.get(StudioSettings, studio.id)
    now = datetime.now(timezone.utc)
    msg = f"קוד הכניסה שלך לפורטל {studio.name}: *{code}*\nתקף ל-{OTP_VALID_MINUTES} דקות."

    # Try WhatsApp first
    if channel in ("whatsapp", "both") and client.phone and settings and settings.whatsapp_provider:
        db.add(MessageJob(
            studio_id=studio.id,
            client_id=client.id,
            channel="whatsapp",
            to_phone=client.phone,
            body=msg,
            scheduled_at=now,
            status="pending",
        ))

    # Email fallback / both
    if channel in ("email", "both") and client.email and settings and settings.resend_api_key:
        html = f"""
        <div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;max-width:480px">
            <h2 style="color:#1a1a2e">קוד כניסה לפורטל {studio.name}</h2>
            <p style="font-size:16px">קוד הכניסה החד-פעמי שלך:</p>
            <div style="font-size:40px;font-weight:bold;letter-spacing:8px;color:#6366f1;padding:20px 0">{code}</div>
            <p style="color:#888;font-size:12px">הקוד תקף ל-{OTP_VALID_MINUTES} דקות בלבד.</p>
        </div>
        """
        db.add(MessageJob(
            studio_id=studio.id,
            client_id=client.id,
            channel="email",
            to_phone=client.email,
            body=html,
            scheduled_at=now,
            status="pending",
        ))

    db.commit()


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@router.post("/request-otp")
@limiter.limit("3/minute")
def request_otp(request: Request, payload: OtpRequestIn, db: Session = Depends(get_db)):
    """Step 1 of 2-step OTP login. Sends a 6-digit code via WhatsApp/email."""
    studio = db.scalar(select(Studio).where(Studio.slug == payload.studio_slug))
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")

    phone = payload.phone.strip().replace("-", "").replace(" ", "")
    client = db.scalar(
        select(Client).where(
            Client.studio_id == studio.id,
            Client.phone == phone,
            Client.is_active.is_(True),
        )
    )
    if not client:
        # Security: don't leak whether phone exists; return generic message
        return {"detail": "אם מספר זה קיים במערכת, נשלח קוד אימות."}

    # Invalidate any previous unused OTPs for this client
    old_otps = db.scalars(
        select(CustomerLoginOtp).where(
            CustomerLoginOtp.client_id == client.id,
            CustomerLoginOtp.used.is_(False),
        )
    ).all()
    for o in old_otps:
        o.used = True

    code = _generate_otp()
    expires = datetime.now(timezone.utc) + timedelta(minutes=OTP_VALID_MINUTES)
    otp = CustomerLoginOtp(
        studio_id=studio.id,
        client_id=client.id,
        code=code,
        channel="whatsapp",
        expires_at=expires,
    )
    db.add(otp)
    db.commit()

    _send_otp(client, studio, code, "both", db)

    return {"detail": "אם מספר זה קיים במערכת, נשלח קוד אימות."}


@router.post("/verify-otp")
@limiter.limit("5/minute")
def verify_otp(request: Request, payload: OtpVerifyIn, db: Session = Depends(get_db)):
    """Step 2 — verify the OTP and receive a JWT token."""
    studio = db.scalar(select(Studio).where(Studio.slug == payload.studio_slug))
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")

    phone = payload.phone.strip().replace("-", "").replace(" ", "")
    client = db.scalar(
        select(Client).where(
            Client.studio_id == studio.id,
            Client.phone == phone,
            Client.is_active.is_(True),
        )
    )
    if not client:
        raise HTTPException(status_code=401, detail="קוד שגוי או פג תוקף")

    now = datetime.now(timezone.utc)
    otp = db.scalar(
        select(CustomerLoginOtp).where(
            CustomerLoginOtp.client_id == client.id,
            CustomerLoginOtp.studio_id == studio.id,
            CustomerLoginOtp.used.is_(False),
            CustomerLoginOtp.expires_at >= now,
        ).order_by(CustomerLoginOtp.created_at.desc())
    )

    if not otp:
        raise HTTPException(status_code=401, detail="קוד שגוי או פג תוקף")

    if otp.attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="יותר מדי ניסיונות. בקש קוד חדש.")

    if otp.code != payload.code.strip():
        otp.attempts = otp.attempts + 1
        db.commit()
        raise HTTPException(status_code=401, detail="קוד שגוי או פג תוקף")

    otp.used = True
    db.commit()

    token = create_portal_token(str(client.id), str(studio.id))
    return {
        "token": token,
        "client_name": client.full_name,
        "studio_name": studio.name,
    }


# Legacy phone-only auth (kept for backward compatibility)
class AuthIn(BaseModel):
    studio_slug: str
    phone: str

@router.post("/auth")
@limiter.limit("5/minute")
def portal_login(request: Request, payload: AuthIn, db: Session = Depends(get_db)):
    """Legacy single-step login (no OTP). Kept for compatibility."""
    studio = db.scalar(select(Studio).where(Studio.slug == payload.studio_slug))
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    phone = payload.phone.strip().replace("-", "").replace(" ", "")
    client = db.scalar(
        select(Client).where(
            Client.studio_id == studio.id,
            Client.phone == phone,
            Client.is_active.is_(True),
        )
    )
    if not client:
        raise HTTPException(status_code=404, detail="לא נמצא לקוח עם מספר זה. אנא פנה לסטודיו.")
    token = create_portal_token(str(client.id), str(studio.id))
    return {"token": token, "client_name": client.full_name, "studio_name": studio.name}


# ── Authenticated portal endpoints ────────────────────────────────────────────

@router.get("/me")
def portal_me(ctx: tuple[Client, Studio] = Depends(portal_auth)):
    client, studio = ctx
    return {
        "client_name": client.full_name,
        "phone": client.phone,
        "email": client.email,
        "loyalty_points": client.loyalty_points,
        "is_club_member": client.is_club_member,
        "studio_name": studio.name,
        "studio_slug": studio.slug,
        "logo_url": studio.logo_url,
        "primary_color": studio.primary_color,
    }


@router.get("/appointments", response_model=list[AppointmentOut])
def portal_appointments(ctx: tuple[Client, Studio] = Depends(portal_auth), db: Session = Depends(get_db)):
    client, studio = ctx
    now = datetime.now(timezone.utc)
    appts = db.scalars(
        select(Appointment)
        .where(Appointment.client_id == client.id, Appointment.studio_id == studio.id)
        .order_by(Appointment.starts_at.desc())
    ).all()
    result = []
    for a in appts:
        artist = db.get(User, a.artist_id)
        artist_name = artist.display_name if artist else "—"
        can_cancel = (
            a.status == "scheduled"
            and a.starts_at.replace(tzinfo=timezone.utc) > now + timedelta(hours=24)
        )
        result.append(AppointmentOut(
            id=str(a.id),
            title=a.title,
            starts_at=a.starts_at,
            ends_at=a.ends_at,
            status=a.status,
            artist_name=artist_name,
            total_price_cents=a.total_price_cents,
            deposit_amount_cents=a.deposit_amount_cents,
            can_cancel=can_cancel,
        ))
    return result


@router.patch("/appointments/{appointment_id}/cancel")
def portal_cancel(
    appointment_id: str,
    ctx: tuple[Client, Studio] = Depends(portal_auth),
    db: Session = Depends(get_db),
):
    client, studio = ctx
    appt = db.get(Appointment, appointment_id)
    if not appt or str(appt.client_id) != str(client.id):
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt.status != "scheduled":
        raise HTTPException(status_code=400, detail="ניתן לבטל רק תורים מתוכננים")
    now = datetime.now(timezone.utc)
    starts = appt.starts_at.replace(tzinfo=timezone.utc) if appt.starts_at.tzinfo is None else appt.starts_at
    if starts <= now + timedelta(hours=24):
        raise HTTPException(status_code=400, detail="לא ניתן לבטל תוך פחות מ-24 שעות")
    appt.status = "canceled"
    db.commit()
    return {"status": "canceled"}


@router.get("/coupons", response_model=list[CouponOut])
def portal_coupons(ctx: tuple[Client, Studio] = Depends(portal_auth), db: Session = Depends(get_db)):
    client, studio = ctx
    now = datetime.now(timezone.utc)
    coupons = db.scalars(
        select(BirthdayCoupon).where(
            BirthdayCoupon.client_id == client.id,
            BirthdayCoupon.studio_id == studio.id,
            BirthdayCoupon.expires_at >= now,
        ).order_by(BirthdayCoupon.created_at.desc())
    ).all()
    return [
        CouponOut(
            code=c.code,
            discount_percent=c.discount_percent,
            expires_at=c.expires_at.isoformat(),
            status=c.status,
        )
        for c in coupons
    ]


@router.get("/card", response_model=CardOut)
def portal_card(ctx: tuple[Client, Studio] = Depends(portal_auth), db: Session = Depends(get_db)):
    """Returns the client's digital club card data including QR token and wallet URLs."""
    from app.crud.customer_club import get_or_create_card, get_design
    from app.services.apple_wallet_service import is_configured as apple_ok, generate_pkpass
    from app.services.google_wallet_service import is_configured as google_ok, generate_save_url

    client, studio = ctx
    card = get_or_create_card(db, studio.id, client.id)
    design = get_design(db, studio.id)
    db.commit()

    apple_url = None
    if apple_ok():
        apple_url = f"{os.getenv('API_BASE_URL', '')}/api/portal/wallet/apple"

    google_url = None
    if google_ok():
        try:
            google_url = generate_save_url(
                client_id=str(client.id),
                client_name=client.full_name,
                loyalty_points=int(client.loyalty_points or 0),
                qr_token=card.qr_token,
                studio_name=studio.name,
                studio_id=str(studio.id),
                background_color=design.background_color,
                logo_url=design.logo_url or studio.logo_url,
                card_title=design.card_title,
            )
        except Exception:
            pass

    return CardOut(
        qr_token=card.qr_token,
        full_name=client.full_name,
        loyalty_points=int(client.loyalty_points or 0),
        is_club_member=client.is_club_member,
        studio_name=studio.name,
        background_color=design.background_color,
        text_color=design.text_color,
        strip_color=design.strip_color,
        label_color=design.label_color,
        logo_url=design.logo_url or studio.logo_url,
        card_title=design.card_title or studio.name,
        apple_wallet_enabled=apple_ok(),
        google_wallet_enabled=google_ok(),
        apple_wallet_url=apple_url,
        google_wallet_url=google_url,
    )


@router.get("/wallet/apple")
def portal_apple_wallet(ctx: tuple[Client, Studio] = Depends(portal_auth), db: Session = Depends(get_db)):
    """Returns a signed .pkpass file for Apple Wallet."""
    from app.crud.customer_club import get_or_create_card, get_design
    from app.services.apple_wallet_service import generate_pkpass, is_configured

    if not is_configured():
        raise HTTPException(status_code=503, detail="Apple Wallet is not configured for this deployment.")

    client, studio = ctx
    card = get_or_create_card(db, studio.id, client.id)
    design = get_design(db, studio.id)
    db.commit()

    pkpass_bytes = generate_pkpass(
        serial_number=str(client.id),
        client_name=client.full_name,
        loyalty_points=int(client.loyalty_points or 0),
        qr_token=card.qr_token,
        studio_name=studio.name,
        background_color=design.background_color,
        text_color=design.text_color,
        label_color=design.label_color,
        strip_color=design.strip_color,
        logo_url=design.logo_url or studio.logo_url,
        card_title=design.card_title,
    )

    import io
    return StreamingResponse(
        io.BytesIO(pkpass_bytes),
        media_type="application/vnd.apple.pkpass",
        headers={"Content-Disposition": f'attachment; filename="club_card.pkpass"'},
    )


@router.get("/tier")
def portal_tier(ctx: tuple[Client, Studio] = Depends(portal_auth), db: Session = Depends(get_db)):
    """Returns the client's current membership tier (or null)."""
    from app.crud.membership_tier import get_client_tier
    client, studio = ctx
    tier = get_client_tier(db, studio.id, client.id)
    if not tier:
        return {"tier": None}
    return {
        "tier": {
            "name": tier.name,
            "color": tier.color,
            "icon": tier.icon,
            "points_multiplier": tier.points_multiplier,
            "birthday_gift_percent": tier.birthday_gift_percent,
        }
    }


@router.get("/stamps")
def portal_stamps(ctx: tuple[Client, Studio] = Depends(portal_auth), db: Session = Depends(get_db)):
    """Returns the client's stamp card progress for all active cards."""
    from app.crud.stamp_card import get_client_progress
    client, studio = ctx
    progress = get_client_progress(db, studio.id, client.id)
    return [
        {
            "card_id": str(p["card"].id),
            "name": p["card"].name,
            "description": p["card"].description,
            "required_stamps": p["card"].required_stamps,
            "stamps_collected": p["stamps_collected"],
            "completed_count": p["completed_count"],
            "reward_type": p["card"].reward_type,
            "reward_value": p["card"].reward_value,
            "reward_description": p["card"].reward_description,
        }
        for p in progress
    ]


@router.get("/timeline")
def portal_timeline(ctx: tuple[Client, Studio] = Depends(portal_auth), db: Session = Depends(get_db)):
    """Returns the client's full activity timeline: appointments + points events."""
    from app.models.payment import Payment
    from app.models.client_points_ledger import ClientPointsLedger
    from app.models.user import User

    client, studio = ctx
    events = []

    # Appointments
    appts = db.scalars(
        select(Appointment)
        .where(Appointment.client_id == client.id, Appointment.studio_id == studio.id)
        .order_by(Appointment.starts_at.desc())
        .limit(50)
    ).all()
    for a in appts:
        artist = db.get(User, a.artist_id)
        events.append({
            "type": "appointment",
            "date": a.starts_at.isoformat(),
            "title": a.title,
            "status": a.status,
            "artist_name": artist.display_name if artist else "—",
            "total_price_cents": a.total_price_cents,
        })

    # Points ledger
    ledger = db.scalars(
        select(ClientPointsLedger)
        .where(
            ClientPointsLedger.client_id == client.id,
            ClientPointsLedger.studio_id == studio.id,
        )
        .order_by(ClientPointsLedger.created_at.desc())
        .limit(50)
    ).all()
    for entry in ledger:
        events.append({
            "type": "points",
            "date": entry.created_at.isoformat(),
            "delta_points": entry.delta_points,
            "reason": entry.reason,
        })

    # Sort all events together by date desc
    events.sort(key=lambda e: e["date"], reverse=True)
    return events[:60]
