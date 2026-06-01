"""Automation Rule CRUD — Phase 2 WHEN/THEN builder."""
from __future__ import annotations
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import require_studio_ctx, AuthContext
from app.db.deps import get_db
from app.models.automation_rule import AutomationRule, AutomationExecution, TRIGGER_EVENTS, ACTION_TYPES

router = APIRouter(prefix="/automation-rules", tags=["AutomationRules"])


class RuleCreate(BaseModel):
    name: str
    trigger_event: str
    trigger_conditions: dict[str, Any] = {}
    actions: list[dict[str, Any]] = []
    is_active: bool = True
    sort_order: int = 0


class RuleUpdate(BaseModel):
    name: Optional[str] = None
    trigger_event: Optional[str] = None
    trigger_conditions: Optional[dict[str, Any]] = None
    actions: Optional[list[dict[str, Any]]] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


def _rule_out(r: AutomationRule) -> dict:
    return {
        "id": str(r.id),
        "studio_id": str(r.studio_id),
        "name": r.name,
        "is_active": r.is_active,
        "trigger_event": r.trigger_event,
        "trigger_conditions": r.trigger_conditions,
        "actions": r.actions,
        "sort_order": r.sort_order,
        "created_at": r.created_at.isoformat(),
    }


@router.get("/meta")
def get_meta(_: AuthContext = Depends(require_studio_ctx)):
    """Return available trigger events and action types for the builder UI."""
    return {
        "trigger_events": [
            {"id": "appointment_done",     "label": "תור הושלם", "icon": "✅"},
            {"id": "appointment_created",  "label": "תור נוצר",  "icon": "📅"},
            {"id": "appointment_canceled", "label": "תור בוטל",  "icon": "❌"},
            {"id": "payment_received",     "label": "תשלום התקבל","icon": "💳"},
            {"id": "deposit_paid",         "label": "מקדמה שולמה","icon": "💰"},
            {"id": "client_birthday",      "label": "יום הולדת ללקוח","icon": "🎂"},
            {"id": "client_joined_club",   "label": "לקוח הצטרף למועדון","icon": "🎉"},
        ],
        "action_types": [
            {"id": "send_whatsapp",  "label": "שלח WhatsApp",          "icon": "💬", "has_template": True,  "has_delay": True},
            {"id": "send_email",     "label": "שלח Email",             "icon": "📧", "has_template": True,  "has_delay": True},
            {"id": "add_points",     "label": "הוסף נקודות",           "icon": "🌟", "has_template": False, "has_amount": True},
            {"id": "request_review", "label": "בקש ביקורת",            "icon": "⭐", "has_template": False, "has_delay": True},
            {"id": "send_aftercare", "label": "שלח הוראות טיפול",      "icon": "💊", "has_template": True,  "has_delay": True},
            {"id": "generate_coupon","label": "צור קופון",             "icon": "🎁", "has_template": False, "has_discount": True},
        ],
        "template_variables": [
            "{client_name}", "{service_name}", "{appointment_date}",
            "{appointment_time}", "{artist_name}", "{amount}",
        ],
    }


@router.get("")
def list_rules(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    rules = db.scalars(
        select(AutomationRule)
        .where(AutomationRule.studio_id == ctx.studio_id)
        .order_by(AutomationRule.sort_order, AutomationRule.created_at)
    ).all()
    return [_rule_out(r) for r in rules]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rule(payload: RuleCreate, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    if payload.trigger_event not in TRIGGER_EVENTS:
        raise HTTPException(400, f"Unknown trigger event: {payload.trigger_event}")
    rule = AutomationRule(
        studio_id=ctx.studio_id,
        name=payload.name,
        trigger_event=payload.trigger_event,
        trigger_conditions=payload.trigger_conditions,
        actions=payload.actions,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.put("/{rule_id}")
def update_rule(rule_id: uuid.UUID, payload: RuleUpdate, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    rule = db.scalar(select(AutomationRule).where(
        AutomationRule.id == rule_id, AutomationRule.studio_id == ctx.studio_id
    ))
    if not rule:
        raise HTTPException(404, "Rule not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(rule, field, val)
    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: uuid.UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    rule = db.scalar(select(AutomationRule).where(
        AutomationRule.id == rule_id, AutomationRule.studio_id == ctx.studio_id
    ))
    if not rule:
        raise HTTPException(404, "Rule not found")
    db.delete(rule)
    db.commit()


@router.get("/{rule_id}/executions")
def get_executions(rule_id: uuid.UUID, ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    execs = db.scalars(
        select(AutomationExecution)
        .where(AutomationExecution.rule_id == rule_id)
        .order_by(AutomationExecution.executed_at.desc())
        .limit(50)
    ).all()
    return [{"id": str(e.id), "status": e.status, "error": e.error,
             "executed_at": e.executed_at.isoformat()} for e in execs]
