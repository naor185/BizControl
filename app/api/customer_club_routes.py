"""
Customer Club Card API — studio-authenticated endpoints.

Studio staff can:
  GET  /api/customer-club/card/{client_id}       — get QR card data for a client
  POST /api/customer-club/card/{client_id}/regen — revoke + regenerate QR token
  GET  /api/customer-club/scan/{token}            — scan QR, get client summary
  GET  /api/wallet-design                         — get wallet card design
  PATCH /api/wallet-design                        — update wallet card design
"""
from __future__ import annotations

import os
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.deps import require_studio_ctx, AuthContext
from app.core.database import get_db
from app.crud.customer_club import (
    get_or_create_card, revoke_and_regenerate, get_card_by_token,
    get_design, upsert_design,
)
from app.models.client import Client
from app.models.birthday_coupon import BirthdayCoupon
from datetime import datetime, timezone

router = APIRouter(prefix="/customer-club", tags=["Customer Club"])
design_router = APIRouter(prefix="/wallet-design", tags=["Wallet Design"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class CardOut(BaseModel):
    client_id: str
    qr_token: str
    status: str
    full_name: str
    loyalty_points: int
    is_club_member: bool


class ScanResult(BaseModel):
    client_id: str
    full_name: str
    phone: str | None
    loyalty_points: int
    is_club_member: bool
    active_coupons: list[dict]
    card_status: str


class DesignOut(BaseModel):
    background_color: str
    text_color: str
    strip_color: str
    label_color: str
    logo_url: str | None
    icon_url: str | None
    show_points: bool
    show_tier: bool
    show_barcode: bool
    card_title: str | None
    card_description: str | None


class DesignUpdate(BaseModel):
    background_color: str | None = None
    text_color: str | None = None
    strip_color: str | None = None
    label_color: str | None = None
    logo_url: str | None = None
    icon_url: str | None = None
    show_points: bool | None = None
    show_tier: bool | None = None
    show_barcode: bool | None = None
    card_title: str | None = None
    card_description: str | None = None


# ── Card endpoints ─────────────────────────────────────────────────────────────

@router.get("/card/{client_id}", response_model=CardOut)
def get_card(
    client_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    client = db.scalar(select(Client).where(Client.id == client_id, Client.studio_id == ctx.studio_id))
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    card = get_or_create_card(db, ctx.studio_id, client_id)
    db.commit()
    return CardOut(
        client_id=str(client.id),
        qr_token=card.qr_token,
        status=card.status,
        full_name=client.full_name,
        loyalty_points=int(client.loyalty_points or 0),
        is_club_member=client.is_club_member,
    )


@router.post("/card/{client_id}/regen", response_model=CardOut)
def regenerate_card(
    client_id: UUID,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    client = db.scalar(select(Client).where(Client.id == client_id, Client.studio_id == ctx.studio_id))
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    card = revoke_and_regenerate(db, ctx.studio_id, client_id)
    db.commit()
    return CardOut(
        client_id=str(client.id),
        qr_token=card.qr_token,
        status=card.status,
        full_name=client.full_name,
        loyalty_points=int(client.loyalty_points or 0),
        is_club_member=client.is_club_member,
    )


@router.get("/scan/{token}", response_model=ScanResult)
def scan_card(
    token: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    card = get_card_by_token(db, token)
    if not card:
        raise HTTPException(status_code=404, detail="כרטיס לא נמצא, מבוטל, או QR לא תקין")
    if str(card.studio_id) != str(ctx.studio_id):
        raise HTTPException(status_code=403, detail="כרטיס שייך לסטודיו אחר")

    client = db.get(Client, card.client_id)
    if not client or not client.is_active:
        raise HTTPException(status_code=404, detail="לקוח לא נמצא")

    now = datetime.now(timezone.utc)
    coupons = db.scalars(
        select(BirthdayCoupon).where(
            BirthdayCoupon.client_id == client.id,
            BirthdayCoupon.studio_id == ctx.studio_id,
            BirthdayCoupon.status == "active",
            BirthdayCoupon.expires_at >= now,
        )
    ).all()

    return ScanResult(
        client_id=str(client.id),
        full_name=client.full_name,
        phone=client.phone,
        loyalty_points=int(client.loyalty_points or 0),
        is_club_member=client.is_club_member,
        active_coupons=[
            {"code": c.code, "discount_percent": c.discount_percent, "expires_at": c.expires_at.isoformat()}
            for c in coupons
        ],
        card_status=card.status,
    )


# ── Design endpoints ───────────────────────────────────────────────────────────

@design_router.get("/status")
def get_wallet_status(_ctx: AuthContext = Depends(require_studio_ctx)):
    """Return whether Apple/Google Wallet is globally configured (env vars set)."""
    apple = all([
        os.getenv("APPLE_WALLET_PASS_TYPE_ID"),
        os.getenv("APPLE_WALLET_TEAM_ID"),
        os.getenv("APPLE_WALLET_CERT_PEM"),
    ])
    google = all([
        os.getenv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON"),
        os.getenv("GOOGLE_WALLET_ISSUER_ID"),
    ])
    return {"apple_configured": apple, "google_configured": google}


@design_router.get("", response_model=DesignOut)
def get_wallet_design(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    design = get_design(db, ctx.studio_id)
    db.commit()
    return DesignOut(
        background_color=design.background_color,
        text_color=design.text_color,
        strip_color=design.strip_color,
        label_color=design.label_color,
        logo_url=design.logo_url,
        icon_url=design.icon_url,
        show_points=design.show_points,
        show_tier=design.show_tier,
        show_barcode=design.show_barcode,
        card_title=design.card_title,
        card_description=design.card_description,
    )


@design_router.patch("", response_model=DesignOut)
def update_wallet_design(
    payload: DesignUpdate,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    design = upsert_design(db, ctx.studio_id, updates)
    return DesignOut(
        background_color=design.background_color,
        text_color=design.text_color,
        strip_color=design.strip_color,
        label_color=design.label_color,
        logo_url=design.logo_url,
        icon_url=design.icon_url,
        show_points=design.show_points,
        show_tier=design.show_tier,
        show_barcode=design.show_barcode,
        card_title=design.card_title,
        card_description=design.card_description,
    )
