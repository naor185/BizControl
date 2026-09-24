"""
Who may receive MARKETING — one definition, used by every marketing send path and enforced again at
the single point every queued message passes through (message_worker.process_due_jobs).

What the two client flags mean is taken from what the system itself tells the client, not from the
column names:
- clients.marketing_consent is the checkbox on the club sign-up form (LandingPageTemplate):
  "אני מאשר/ת קבלת עדכונים, הטבות והודעות שיווקיות מ-<studio>". False = did not agree to marketing.
- clients.whatsapp_opted_out is set by the personal unsubscribe link (invite_routes.optout_via_invite),
  whose page tells the client "לא תקבל/י יותר הודעות שיווקיות אוטומטיות", and by the switch on the
  client card. The same link is in the marketing e-mails ("להסרה מרשימת הדיוור"), so it covers every
  channel. It stops marketing ONLY — the owner decided (2026-09-24) that reminders and every other
  service message still go out; this is the only place that reads it (a test enforces that).

Marketing = a message whose purpose is promotion rather than the client's own booking or purchase:
broadcasts (תפוצות), club invitations, birthday benefits. Service messages (confirmations, reminders,
cancellations, receipts, waitlist, aftercare, …) are deliberately NOT governed here — their existing
checks are unchanged. Every message type must be listed in exactly one of the two sets below; a test
fails when a new type appears unclassified.
"""
from __future__ import annotations

from sqlalchemy import Select, select

from app.models.client import Client

MARKETING_TYPES = frozenset({
    "broadcast",             # תפוצות (main.tick_broadcasts)
    "club_invite",           # הזמנה למועדון (crud/automation.maybe_enqueue_club_invite)
    "club_invite_email",
    "birthday_manual",       # קופון יום הולדת שנשלח ידנית (customer_club_routes)
})
MARKETING_PREFIXES = (
    "birthday-",             # קופון יום הולדת אוטומטי (message_worker.sweep_birthday_messages, crud/client on join)
    "birthday_email-",
)

SERVICE_TYPES = frozenset({
    # the client's own appointments
    "new_appointment", "reschedule", "appointment_cancelled", "no_show",
    "1day", "3day", "7day", "same_day", "1day_email", "3day_email", "7day_email", "same_day_email",
    "deposit_24h", "aftercare", "post_payment",
    # receipts and purchases
    "receipt_link", "receipt_link_email", "pos_receipt",
    "gift_card_voucher", "gift_card_receipt_link", "gift_card_receipt_link_email",
    "gift_card_buyer_thanks", "gift_card_buyer_thanks_email",
    # requests the client made
    "waitlist_notify", "waitlist_joined", "waitlist_join", "booking_request_new", "booking_new_notification",
    # a response to the client's own action (joining the club / redeeming points) — kept as service,
    # i.e. their behaviour is unchanged; listed separately so the owner can decide otherwise
    "club_welcome", "points_celebration",
    # to the studio's staff, not to clients
    "new_lead", "manual",
})
SERVICE_PREFIXES = ("plan_",)   # subscription notices to the studio owner


def is_marketing(reminder_type: str | None) -> bool:
    if not reminder_type:
        return False
    return reminder_type in MARKETING_TYPES or reminder_type.startswith(MARKETING_PREFIXES)


def is_classified(reminder_type: str) -> bool:
    return (is_marketing(reminder_type) or reminder_type in SERVICE_TYPES
            or reminder_type.startswith(SERVICE_PREFIXES))


def refusal_reason(client: Client | None) -> str | None:
    """Why this client may not receive marketing, or None when they may."""
    if client is None:
        return "הלקוח לא נמצא"
    if not client.is_active:
        return "הלקוח לא פעיל"
    if client.whatsapp_opted_out:
        return "הלקוח הסיר את עצמו מהודעות שיווקיות"
    if client.marketing_consent is False:
        return "הלקוח לא אישר קבלת הודעות שיווקיות"
    return None


def may_receive_marketing(client: Client | None) -> bool:
    return refusal_reason(client) is None


def marketing_audience_conditions() -> tuple:
    """The same rule as may_receive_marketing, as SQL conditions on Client."""
    return (
        Client.is_active.is_(True),
        Client.whatsapp_opted_out.is_(False),
        Client.marketing_consent.is_(True),
    )


def broadcast_recipients_query(studio_id, audience: str) -> Select:
    """Everyone a broadcast (תפוצה) goes to. Used both for the count shown when it is scheduled and
    when it is actually sent, so the two can never disagree."""
    q = select(Client).where(Client.studio_id == studio_id, Client.phone.isnot(None), *marketing_audience_conditions())
    if audience == "club":
        q = q.where(Client.is_club_member.is_(True))
    elif audience == "non_club":
        q = q.where(Client.is_club_member.is_(False))
    return q
