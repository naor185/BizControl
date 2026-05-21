from __future__ import annotations
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models.membership_tier import MembershipTier
from app.models.client import Client
from app.models.appointment import Appointment
from app.models.payment import Payment
from app.models.client_points_ledger import ClientPointsLedger


def list_tiers(db: Session, studio_id: UUID) -> list[MembershipTier]:
    return list(db.scalars(
        select(MembershipTier)
        .where(MembershipTier.studio_id == studio_id)
        .order_by(MembershipTier.rank_order.asc())
    ).all())


def get_tier(db: Session, studio_id: UUID, tier_id: UUID) -> MembershipTier | None:
    return db.scalar(
        select(MembershipTier).where(MembershipTier.id == tier_id, MembershipTier.studio_id == studio_id)
    )


def create_tier(db: Session, studio_id: UUID, data: dict) -> MembershipTier:
    tier = MembershipTier(studio_id=studio_id, **data)
    db.add(tier)
    db.commit()
    db.refresh(tier)
    return tier


def update_tier(db: Session, studio_id: UUID, tier_id: UUID, data: dict) -> MembershipTier | None:
    tier = get_tier(db, studio_id, tier_id)
    if not tier:
        return None
    for k, v in data.items():
        setattr(tier, k, v)
    db.commit()
    db.refresh(tier)
    return tier


def delete_tier(db: Session, studio_id: UUID, tier_id: UUID) -> bool:
    tier = get_tier(db, studio_id, tier_id)
    if not tier:
        return False
    db.delete(tier)
    db.commit()
    return True


def _client_visits(db: Session, studio_id: UUID, client_id: UUID) -> int:
    return db.scalar(
        select(func.count()).select_from(Appointment).where(
            Appointment.studio_id == studio_id,
            Appointment.client_id == client_id,
            Appointment.status == "done",
        )
    ) or 0


def _client_spend_ils(db: Session, studio_id: UUID, client_id: UUID) -> int:
    paid = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
            Payment.studio_id == studio_id,
            Payment.client_id == client_id,
            Payment.status == "paid",
            Payment.type.in_(["payment", "deposit"]),
        )
    ) or 0
    refund = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
            Payment.studio_id == studio_id,
            Payment.client_id == client_id,
            Payment.status == "paid",
            Payment.type == "refund",
        )
    ) or 0
    return max(0, int(paid - refund)) // 100


def _client_points_earned(db: Session, studio_id: UUID, client_id: UUID) -> int:
    return db.scalar(
        select(func.coalesce(func.sum(ClientPointsLedger.delta_points), 0)).where(
            ClientPointsLedger.studio_id == studio_id,
            ClientPointsLedger.client_id == client_id,
            ClientPointsLedger.delta_points > 0,
        )
    ) or 0


def get_client_tier(db: Session, studio_id: UUID, client_id: UUID) -> MembershipTier | None:
    tiers = list(db.scalars(
        select(MembershipTier).where(
            MembershipTier.studio_id == studio_id,
            MembershipTier.is_active == True,
        ).order_by(MembershipTier.rank_order.desc())
    ).all())
    if not tiers:
        return None

    visits = None
    spend = None
    points = None

    for tier in tiers:
        if tier.threshold_type == "visits":
            if visits is None:
                visits = _client_visits(db, studio_id, client_id)
            if visits >= tier.threshold_value:
                return tier
        elif tier.threshold_type == "spend_ils":
            if spend is None:
                spend = _client_spend_ils(db, studio_id, client_id)
            if spend >= tier.threshold_value:
                return tier
        elif tier.threshold_type == "points_earned":
            if points is None:
                points = _client_points_earned(db, studio_id, client_id)
            if points >= tier.threshold_value:
                return tier
    return None
