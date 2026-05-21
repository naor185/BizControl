from __future__ import annotations

import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.customer_club_card import CustomerClubCard
from app.models.wallet_pass_design import WalletPassDesign


def _new_token() -> str:
    return secrets.token_urlsafe(48)


def get_or_create_card(db: Session, studio_id: UUID, client_id: UUID) -> CustomerClubCard:
    """Idempotent — returns existing active card or creates a new one."""
    card = db.scalar(
        select(CustomerClubCard).where(
            CustomerClubCard.studio_id == studio_id,
            CustomerClubCard.client_id == client_id,
        )
    )
    if card:
        return card
    card = CustomerClubCard(
        studio_id=studio_id,
        client_id=client_id,
        qr_token=_new_token(),
        status="active",
    )
    db.add(card)
    db.flush()
    return card


def get_card_by_token(db: Session, qr_token: str) -> CustomerClubCard | None:
    return db.scalar(
        select(CustomerClubCard).where(
            CustomerClubCard.qr_token == qr_token,
            CustomerClubCard.status == "active",
        )
    )


def revoke_and_regenerate(db: Session, studio_id: UUID, client_id: UUID) -> CustomerClubCard:
    """Revokes current token and issues a new one."""
    card = db.scalar(
        select(CustomerClubCard).where(
            CustomerClubCard.studio_id == studio_id,
            CustomerClubCard.client_id == client_id,
        )
    )
    if card:
        card.qr_token = _new_token()
        card.status = "active"
    else:
        card = CustomerClubCard(
            studio_id=studio_id,
            client_id=client_id,
            qr_token=_new_token(),
            status="active",
        )
        db.add(card)
    db.flush()
    return card


def get_design(db: Session, studio_id: UUID) -> WalletPassDesign:
    """Returns the studio's wallet pass design, creating defaults if not set."""
    design = db.scalar(
        select(WalletPassDesign).where(WalletPassDesign.studio_id == studio_id)
    )
    if not design:
        design = WalletPassDesign(studio_id=studio_id)
        db.add(design)
        db.flush()
    return design


def upsert_design(db: Session, studio_id: UUID, updates: dict) -> WalletPassDesign:
    design = get_design(db, studio_id)
    allowed = {
        "background_color", "text_color", "strip_color", "label_color",
        "logo_url", "icon_url", "show_points", "show_tier", "show_barcode",
        "card_title", "card_description",
    }
    for k, v in updates.items():
        if k in allowed:
            setattr(design, k, v)
    db.commit()
    db.refresh(design)
    return design
