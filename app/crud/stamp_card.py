from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.stamp_card import StampCard, ClientStampProgress


def list_stamp_cards(db: Session, studio_id: UUID) -> list[StampCard]:
    return list(db.scalars(
        select(StampCard).where(StampCard.studio_id == studio_id).order_by(StampCard.created_at.asc())
    ).all())


def get_stamp_card(db: Session, studio_id: UUID, card_id: UUID) -> StampCard | None:
    return db.scalar(
        select(StampCard).where(StampCard.id == card_id, StampCard.studio_id == studio_id)
    )


def create_stamp_card(db: Session, studio_id: UUID, data: dict) -> StampCard:
    card = StampCard(studio_id=studio_id, **data)
    db.add(card)
    db.commit()
    db.refresh(card)
    return card


def update_stamp_card(db: Session, studio_id: UUID, card_id: UUID, data: dict) -> StampCard | None:
    card = get_stamp_card(db, studio_id, card_id)
    if not card:
        return None
    for k, v in data.items():
        setattr(card, k, v)
    db.commit()
    db.refresh(card)
    return card


def delete_stamp_card(db: Session, studio_id: UUID, card_id: UUID) -> bool:
    card = get_stamp_card(db, studio_id, card_id)
    if not card:
        return False
    db.delete(card)
    db.commit()
    return True


def get_client_progress(db: Session, studio_id: UUID, client_id: UUID) -> list[dict]:
    cards = list(db.scalars(
        select(StampCard).where(StampCard.studio_id == studio_id, StampCard.is_active == True)
    ).all())
    result = []
    for card in cards:
        progress = db.scalar(
            select(ClientStampProgress).where(
                ClientStampProgress.studio_id == studio_id,
                ClientStampProgress.client_id == client_id,
                ClientStampProgress.stamp_card_id == card.id,
            )
        )
        result.append({
            "card": card,
            "stamps_collected": progress.stamps_collected if progress else 0,
            "completed_count": progress.completed_count if progress else 0,
        })
    return result


def add_stamp_for_appointment(db: Session, studio_id: UUID, client_id: UUID) -> list[dict]:
    """Called when an appointment is marked done. Adds stamp to all active cards."""
    cards = list(db.scalars(
        select(StampCard).where(StampCard.studio_id == studio_id, StampCard.is_active == True)
    ).all())

    rewards_triggered = []

    for card in cards:
        progress = db.scalar(
            select(ClientStampProgress).where(
                ClientStampProgress.studio_id == studio_id,
                ClientStampProgress.client_id == client_id,
                ClientStampProgress.stamp_card_id == card.id,
            )
        )
        if not progress:
            progress = ClientStampProgress(
                studio_id=studio_id,
                client_id=client_id,
                stamp_card_id=card.id,
                stamps_collected=0,
                completed_count=0,
            )
            db.add(progress)
            db.flush()

        progress.stamps_collected += 1
        progress.last_stamp_at = datetime.now(timezone.utc)

        if progress.stamps_collected >= card.required_stamps:
            progress.stamps_collected = 0
            progress.completed_count += 1
            rewards_triggered.append({"card": card, "client_id": client_id})

    db.commit()
    return rewards_triggered


def grant_stamp_reward(db: Session, studio_id: UUID, client_id: UUID, card: StampCard):
    """Issue the reward after a stamp card is completed."""
    from app.models.client import Client
    client = db.get(Client, client_id)
    if not client:
        return

    if card.reward_type == "points":
        client.loyalty_points = int(client.loyalty_points or 0) + card.reward_value
        from app.models.client_points_ledger import ClientPointsLedger
        db.add(ClientPointsLedger(
            studio_id=studio_id,
            client_id=client_id,
            delta_points=card.reward_value,
            reason=f"Stamp card reward: {card.name}",
        ))
        db.commit()

    elif card.reward_type == "discount_percent":
        import secrets
        from datetime import timedelta
        from app.models.birthday_coupon import BirthdayCoupon
        now = datetime.now(timezone.utc)
        code = f"STAMP-{secrets.token_hex(4).upper()}"
        coupon = BirthdayCoupon(
            studio_id=studio_id,
            client_id=client_id,
            code=code,
            discount_percent=card.reward_value,
            birthday_month=now.month,
            birthday_year=now.year,
            starts_at=now,
            expires_at=now + timedelta(days=60),
            status="active",
        )
        db.add(coupon)
        db.commit()
