"""
Client Portal — unauthenticated login by phone, then JWT-protected views.
Clients see their own appointments, payments and loyalty points.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
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
from jose import jwt as jose_jwt

router = APIRouter(prefix="/portal", tags=["Client Portal"])

PORTAL_TOKEN_HOURS = 24


# ── Token helpers ─────────────────────────────────────────────────────────────

def create_portal_token(client_id: str, studio_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=PORTAL_TOKEN_HOURS)
    return jose_jwt.encode(
        {"type": "client_portal", "client_id": client_id, "studio_id": studio_id, "exp": expire},
        JWT_SECRET,
        algorithm=JWT_ALG,
    )


def get_portal_client(token: str, db: Session) -> tuple[Client, Studio]:
    """Dependency-like helper: validates portal JWT, returns (client, studio)."""
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


# ── Dependency ────────────────────────────────────────────────────────────────

from fastapi import Header

async def portal_auth(
    authorization: str = Header(...),
    db: Session = Depends(get_db),
) -> tuple[Client, Studio]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.removeprefix("Bearer ").strip()
    return get_portal_client(token, db)


# ── Schemas ───────────────────────────────────────────────────────────────────

class AuthIn(BaseModel):
    studio_slug: str
    phone: str


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


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/auth")
@limiter.limit("5/minute")
def portal_login(request: Request, payload: AuthIn, db: Session = Depends(get_db)):
    studio = db.scalar(select(Studio).where(Studio.slug == payload.studio_slug))
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")

    phone = payload.phone.strip().replace("-", "").replace(" ", "")
    client = db.scalar(
        select(Client).where(
            Client.studio_id == studio.id,
            Client.phone == phone,
            Client.is_active == True,  # noqa: E712
        )
    )
    if not client:
        raise HTTPException(
            status_code=404,
            detail="לא נמצא לקוח עם מספר זה. אנא פנה לסטודיו.",
        )

    token = create_portal_token(str(client.id), str(studio.id))
    return {
        "token": token,
        "client_name": client.full_name,
        "studio_name": studio.name,
    }


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
        # Can cancel if scheduled + starts more than 24h from now
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
