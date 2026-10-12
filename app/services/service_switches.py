"""
The owner's on/off for each service (owner, 2026-10-10) — the one place every part of the system asks "is it on, and
how much": the aftercare & review message, the club's joining gift, cashback, the birthday benefit, selling gift
cards (and so its bonus), the designed voucher. Every switch starts on — nothing changes for a business until its
owner turns something off — and a value set (points, percent) is kept while off and back when turned on.
The club's three are the club's: only where the business's plan has it (app/services/club.py).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

DEFAULT_BIRTHDAY_PERCENT = 10

# The messages the owner turns on and off on the message templates page (owner, 2026-10-12: "only a delete button,
# no way to cancel a message"), by the page's id — those without a switch of their own; the reminders, the birthday,
# the club invite, the aftercare and the points card keep theirs. Every one starts on.
MESSAGE_IDS = frozenset({
    "confirm", "deposit_request", "deposit_approved", "reschedule", "cancel",
    "post_payment", "receipt_link", "pos_receipt", "deposit_reminder",
    "booking_request_approved", "booking_request_rejected", "waitlist_joined", "waitlist_notify", "welcome",
})


def messages_off(settings) -> set[str]:
    import json
    try:
        return set(json.loads(getattr(settings, "messages_off", None) or "[]")) & MESSAGE_IDS
    except (ValueError, TypeError):
        return set()


def message_on(settings, message_id: str) -> bool:
    """Is this message sent — not turned off on the message templates page."""
    return message_id not in messages_off(settings)


def _settings(db: Session, studio_id):
    from app.models.studio_settings import StudioSettings
    return db.get(StudioSettings, studio_id)


def aftercare_on(settings) -> bool:
    """The message after the appointment — care instructions and the review request."""
    return bool(settings is not None and getattr(settings, "aftercare_enabled", True))


def join_gift_points(db: Session, studio_id, settings=None) -> int:
    """Points a client gets on joining the club — 0 when the gift is off, or the plan has no club."""
    from app.services.club import club_on
    settings = settings if settings is not None else _settings(db, studio_id)
    if settings is None or not getattr(settings, "club_join_gift_enabled", True) or not club_on(db, studio_id):
        return 0
    return max(0, int(settings.points_on_signup or 0))


def cashback_on(settings) -> bool:
    """Points back on a payment — appointments, the till, memberships, classes, courses."""
    return bool(settings is not None and getattr(settings, "cashback_enabled", True))


def birthday_on(db: Session, studio_id, settings=None) -> bool:
    """The birthday benefit — the message and its coupon, sent by itself or by hand."""
    from app.services.club import club_on
    settings = settings if settings is not None else _settings(db, studio_id)
    return bool(settings is not None and getattr(settings, "birthday_automation_enabled", True) and club_on(db, studio_id))


def birthday_percent(settings) -> int:
    """The birthday coupon's discount — what the owner set (it used to turn a 0 into 10%)."""
    value = int(getattr(settings, "birthday_benefit_percent", 0) or 0) if settings is not None else 0
    return value if value > 0 else DEFAULT_BIRTHDAY_PERCENT


def gift_card_sales_on(db: Session, studio_id, settings=None) -> bool:
    """Selling new gift cards — online and from the business — in the plan and switched on. A card already sold
    keeps working either way."""
    import uuid
    from app.core.features import has_module
    try:
        sid = studio_id if isinstance(studio_id, uuid.UUID) else uuid.UUID(str(studio_id))
    except ValueError:
        return False
    if not has_module(db, sid, "gift_cards"):
        return False
    settings = settings if settings is not None else _settings(db, sid)
    return bool(settings is not None and getattr(settings, "gift_card_sales_enabled", True))


def voucher_design_on(settings) -> bool:
    """The designed voucher picture sent with a gift card — off: the card goes as a message with its link."""
    return bool(settings is not None and getattr(settings, "gift_voucher_design_enabled", True))
