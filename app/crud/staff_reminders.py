from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.staff_reminder_rule import StaffReminderRule


def list_rules(db: Session, studio_id: UUID) -> list[StaffReminderRule]:
    return list(db.scalars(
        select(StaffReminderRule)
        .where(StaffReminderRule.studio_id == studio_id)
        .order_by(StaffReminderRule.lead_minutes)
    ).all())


def create_rule(db: Session, studio_id: UUID, applies_to: str, lead_minutes: int, enabled: bool) -> StaffReminderRule:
    rule = StaffReminderRule(studio_id=studio_id, applies_to=applies_to, lead_minutes=lead_minutes, enabled=enabled)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def get_rule(db: Session, studio_id: UUID, rule_id: UUID) -> StaffReminderRule | None:
    return db.scalar(
        select(StaffReminderRule).where(StaffReminderRule.id == rule_id, StaffReminderRule.studio_id == studio_id)
    )


def update_rule(db: Session, rule: StaffReminderRule, **fields) -> StaffReminderRule:
    for k, v in fields.items():
        if v is not None:
            setattr(rule, k, v)
    db.commit()
    db.refresh(rule)
    return rule


def delete_rule(db: Session, rule: StaffReminderRule) -> None:
    db.delete(rule)
    db.commit()
