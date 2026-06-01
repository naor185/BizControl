"""
Automation Rule Execution Engine — Phase 2.

Call fire_event(db, studio_id, event, context) from any trigger point.
The engine loads matching active rules and executes their actions.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.automation_rule import AutomationRule, AutomationExecution

log = logging.getLogger(__name__)

# Available template variables per event
EVENT_CONTEXT_KEYS = {
    "appointment_done":    ["client_name", "client_phone", "service_name", "appointment_date", "appointment_time", "artist_name"],
    "appointment_created": ["client_name", "client_phone", "service_name", "appointment_date", "appointment_time", "artist_name"],
    "appointment_canceled":["client_name", "client_phone", "service_name", "appointment_date", "appointment_time"],
    "payment_received":    ["client_name", "client_phone", "service_name", "amount", "appointment_date"],
    "deposit_paid":        ["client_name", "client_phone", "service_name", "amount", "appointment_date"],
    "client_birthday":     ["client_name", "client_phone"],
    "client_joined_club":  ["client_name", "client_phone"],
}


def fire_event(
    db: Session,
    studio_id,
    event: str,
    context: dict[str, Any],
    appointment_id=None,
    client_id=None,
) -> int:
    """
    Fire an automation event.
    Returns the number of rules that were executed.
    """
    rules = db.scalars(
        select(AutomationRule).where(
            AutomationRule.studio_id == studio_id,
            AutomationRule.trigger_event == event,
            AutomationRule.is_active == True,  # noqa
        ).order_by(AutomationRule.sort_order)
    ).all()

    count = 0
    for rule in rules:
        if not _check_conditions(rule, context):
            continue
        try:
            _execute_rule(db, rule, context, appointment_id, client_id)
            db.add(AutomationExecution(
                rule_id=rule.id, studio_id=studio_id,
                trigger_event=event, context_data=context, status="ok",
            ))
            count += 1
        except Exception as e:
            log.exception("Automation rule %s failed: %s", rule.id, e)
            db.add(AutomationExecution(
                rule_id=rule.id, studio_id=studio_id,
                trigger_event=event, context_data=context,
                status="error", error=str(e),
            ))
    db.commit()
    return count


def _check_conditions(rule: AutomationRule, context: dict) -> bool:
    """Return True if the rule's conditions are met."""
    conds = rule.trigger_conditions or {}
    if not conds:
        return True
    # service_id match
    if "service_id" in conds and context.get("service_id") != conds["service_id"]:
        return False
    # category match
    if "category" in conds and context.get("category") != conds["category"]:
        return False
    return True


def _execute_rule(
    db: Session,
    rule: AutomationRule,
    context: dict,
    appointment_id,
    client_id,
) -> None:
    from app.models.studio_settings import StudioSettings
    from app.models.message_job import MessageJob
    from app.models.client import Client
    from app.crud.automation import format_template, smart_format

    settings = db.get(StudioSettings, rule.studio_id)
    client = db.get(Client, client_id) if client_id else None

    now = datetime.now(timezone.utc)

    for action in (rule.actions or []):
        atype = action.get("type")
        delay = int(action.get("delay_minutes", 0))
        scheduled_at = now + timedelta(minutes=delay)

        if atype == "send_whatsapp" and client and client.phone:
            template = action.get("template", "") or "שלום {client_name}!"
            body = smart_format(template, context)
            db.add(MessageJob(
                studio_id=rule.studio_id,
                client_id=client_id,
                appointment_id=appointment_id,
                channel="whatsapp",
                to_phone=client.phone,
                body=body,
                scheduled_at=scheduled_at,
                status="pending",
                reminder_type=f"rule_{rule.id}",
            ))

        elif atype == "send_email" and client and client.email:
            template = action.get("template", "") or "שלום {client_name}!"
            body = smart_format(template, context)
            db.add(MessageJob(
                studio_id=rule.studio_id,
                client_id=client_id,
                appointment_id=appointment_id,
                channel="email",
                to_phone=client.email,
                body=body,
                scheduled_at=scheduled_at,
                status="pending",
                reminder_type=f"rule_{rule.id}_email",
            ))

        elif atype == "add_points" and client and client.is_club_member:
            amount = int(action.get("amount", 10))
            if amount > 0:
                from app.crud.loyalty import add_points_to_client
                try:
                    add_points_to_client(db, rule.studio_id, client_id, amount,
                                         reason=f"אוטומציה: {rule.name}")
                except Exception:
                    client.loyalty_points = (client.loyalty_points or 0) + amount

        elif atype == "request_review" and client and client.phone:
            review_lines = []
            if settings and settings.review_link_google:
                review_lines.append(f"⭐ Google: {settings.review_link_google.strip()}")
            if settings and settings.review_link_instagram:
                review_lines.append(f"📸 Instagram: {settings.review_link_instagram.strip()}")
            if review_lines:
                body = f"שלום {context.get('client_name', '')}! 🙏\n\nנשמח לביקורת שלך:\n" + "\n".join(review_lines)
                db.add(MessageJob(
                    studio_id=rule.studio_id,
                    client_id=client_id,
                    appointment_id=appointment_id,
                    channel="whatsapp",
                    to_phone=client.phone,
                    body=body,
                    scheduled_at=scheduled_at,
                    status="pending",
                    reminder_type=f"rule_{rule.id}_review",
                ))

        elif atype == "send_aftercare" and client and client.phone:
            aftercare = (action.get("template") or
                         (settings.aftercare_message if settings else None) or
                         "הוראות טיפול לאחר הביקור 💊")
            body = smart_format(aftercare, context)
            db.add(MessageJob(
                studio_id=rule.studio_id,
                client_id=client_id,
                appointment_id=appointment_id,
                channel="whatsapp",
                to_phone=client.phone,
                body=body,
                scheduled_at=scheduled_at,
                status="pending",
                reminder_type=f"rule_{rule.id}_aftercare",
            ))

        elif atype == "generate_coupon" and client:
            import secrets, string
            code = "AUTO-" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
            discount = int(action.get("discount_percent", 10))
            try:
                from app.models.coupon import Coupon
                from datetime import date
                coupon = Coupon(
                    studio_id=rule.studio_id,
                    code=code,
                    discount_type="percent",
                    discount_value=discount,
                    valid_until=date.today().replace(year=date.today().year + 1),
                    max_uses=1,
                    current_uses=0,
                    is_active=True,
                )
                db.add(coupon)
                db.flush()
                if client.phone:
                    body = f"שלום {context.get('client_name', '')}! 🎁\n\nקיבלת קופון {discount}% הנחה:\n*{code}*\nתוקף: שנה"
                    db.add(MessageJob(
                        studio_id=rule.studio_id,
                        client_id=client_id,
                        channel="whatsapp",
                        to_phone=client.phone,
                        body=body,
                        scheduled_at=scheduled_at,
                        status="pending",
                        reminder_type=f"rule_{rule.id}_coupon",
                    ))
            except Exception as e:
                log.warning("Coupon generation failed in automation: %s", e)

        log.info("Automation rule %s action '%s' executed for studio %s", rule.id, atype, rule.studio_id)
