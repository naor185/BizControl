"""
Class and membership notifications — the ONE place that decides whether a message goes out.

Every class/membership event (booked, reminder, cancelled, waitlist, membership changes…) calls
notify(). It decides, in this order:
1. The event's origin: an event from a migration/import never sends anything.
2. The business's choice for this event and channel (notification_templates), or the catalog default.
   An "always on" event (a class was cancelled or changed) cannot be switched off.
3. Once only: every message carries a dedup key — the event, the thing it is about and the recipient —
   and a unique index on (studio_id, dedup_key) makes a repeated event a no-op.
Then it queues the message (message_jobs → the existing dispatcher) or, for staff, a bell notification.
Many recipients at once (a class of 15 cancelled) are spaced out, not sent in one burst.

These are service messages (app/services/marketing.py classifies "notify-…" as service): they go to a
client whatever their marketing choices.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

ORIGINS = ("user", "system", "migration")
CLIENT_CHANNELS = ("whatsapp", "email")
SPACING_SECONDS = 3      # between messages when one event reaches many recipients


@dataclass(frozen=True)
class Event:
    key: str
    label: str                 # what the owner sees in settings; {staff} etc. = the business's words
    audience: str              # client | staff
    recipient: str             # who gets it, in the owner's words
    default_on: bool
    always_on: bool = False    # cannot be switched off (the client must know)
    texts: dict = field(default_factory=dict)   # channel → default text; {placeholders} filled at send time
    module: str = "classes"    # shown to the owner only when this module is on (e.g. waitlist events)
    link: str | None = None    # a staff bell opens this screen


# Wording rules: the class name can be masculine or feminine (שיעור / סדנה), so no sentence makes a verb
# agree with it; the business's words come in through {staff_title} and similar placeholders.
EVENTS: dict[str, Event] = {e.key: e for e in (
    Event("class_booked", "אישור הרשמה לשיעור", "client", "הלקוח/ה", True, texts={
        "whatsapp": "היי {client_name}, נרשמת ל{class_name} ב-{class_date} בשעה {class_time} ✅\n{studio_name}",
        "email": "היי {client_name},\nנרשמת ל{class_name} ב-{class_date} בשעה {class_time}.\n{studio_name}"}),
    Event("class_reminder", "תזכורת לפני שיעור", "client", "הלקוח/ה", True, texts={
        "whatsapp": "היי {client_name}, תזכורת: {class_name} ב-{class_date} בשעה {class_time} ⏰\n{studio_name}",
        "email": "היי {client_name},\nתזכורת: {class_name} ב-{class_date} בשעה {class_time}.\n{studio_name}"}),
    Event("class_changed", "שיעור בוטל או שונה ({staff}, חדר, שעה)", "client", "כל הנרשמים", True, always_on=True, texts={
        "whatsapp": "היי {client_name}, עדכון לגבי {class_name} ב-{class_date} בשעה {class_time}:\n{change_note}\n{studio_name}",
        "email": "היי {client_name},\nעדכון לגבי {class_name} ב-{class_date} בשעה {class_time}:\n{change_note}\n{studio_name}"}),
    Event("class_auto_cancel", "שיעור בוטל אוטומטית בגלל מעט נרשמים", "client", "כל הנרשמים", True, always_on=True, texts={
        "whatsapp": "היי {client_name}, ביטלנו את {class_name} ב-{class_date} בשעה {class_time} כי לא היו מספיק נרשמים. {entry_note}\nמצטערים! {studio_name}",
        "email": "היי {client_name},\nביטלנו את {class_name} ב-{class_date} בשעה {class_time} כי לא היו מספיק נרשמים. {entry_note}\n{studio_name}"}),
    Event("class_swapped", "הרשמה הועברה לשיעור אחר", "client", "הלקוח/ה", True, texts={
        "whatsapp": "היי {client_name}, ההרשמה שלך הועברה ל{class_name} ב-{class_date} בשעה {class_time} ✅\n{swap_note}\n{studio_name}",
        "email": "היי {client_name},\nההרשמה שלך הועברה ל{class_name} ב-{class_date} בשעה {class_time}.\n{swap_note}\n{studio_name}"}),
    Event("booking_cancelled", "ביטול הרשמה (והכניסה חזרה או נצרכה)", "client", "הלקוח/ה", True, texts={
        "whatsapp": "היי {client_name}, ההרשמה שלך ל{class_name} ב-{class_date} בוטלה. {entry_note}\n{studio_name}",
        "email": "היי {client_name},\nההרשמה שלך ל{class_name} ב-{class_date} בוטלה. {entry_note}\n{studio_name}"}),
    Event("late_fee", "נרשם חיוב על ביטול מאוחר או אי-הגעה, או נשלחה אזהרה", "client", "הלקוח/ה", True, texts={
        "whatsapp": "היי {client_name}, לפי מדיניות הביטולים של {studio_name}: {fee_note}",
        "email": "היי {client_name},\nלפי מדיניות הביטולים של {studio_name}: {fee_note}"}),
    Event("waitlist_promoted", "התפנה מקום, או נרשמת מרשימת ההמתנה", "client", "הממתין/ה שהגיע תורו/ה", True, module="class_waitlist", texts={
        "whatsapp": "היי {client_name}, התפנה מקום ב{class_name} ב-{class_date} בשעה {class_time} 🎉\n{promotion_note}",
        "email": "היי {client_name},\nהתפנה מקום ב{class_name} ב-{class_date} בשעה {class_time}.\n{promotion_note}"}),
    Event("waitlist_expiring", "חלון האישור בהמתנה עומד לפוג או פג", "client", "הממתין/ה", True, module="class_waitlist", texts={
        "whatsapp": "היי {client_name}, {expiry_note}",
        "email": "היי {client_name},\n{expiry_note}"}),
    Event("membership_frozen", "מנוי הוקפא, וחזרה מהקפאה מחר", "client", "הלקוח/ה", True, module="memberships", texts={
        "whatsapp": "היי {client_name}, {freeze_note}\n{studio_name}",
        "email": "היי {client_name},\n{freeze_note}\n{studio_name}"}),
    Event("membership_ended", "מנוי נעצר או בוטל", "client", "הלקוח/ה", True, module="memberships", texts={
        "whatsapp": "היי {client_name}, המנוי שלך {status_word} מתאריך {date}.\n{studio_name}",
        "email": "היי {client_name},\nהמנוי שלך {status_word} מתאריך {date}.\n{studio_name}"}),
    Event("membership_expiring", "מנוי עומד לפוג (7 ו-3 ימים לפני) או נותרו 2 כניסות", "client", "הלקוח/ה", True, module="memberships", texts={
        "whatsapp": "היי {client_name}, {expiry_note} לחידוש — דברו איתנו 🙏\n{studio_name}",
        "email": "היי {client_name},\n{expiry_note} לחידוש — דברו איתנו.\n{studio_name}"}),
    Event("freeze_request_declined", "בקשת הקפאה לא אושרה", "client", "הלקוח/ה", True, module="memberships", texts={
        "whatsapp": "היי {client_name}, {request_note}\n{studio_name}",
        "email": "היי {client_name},\n{request_note}\n{studio_name}"}),
    Event("class_full", "שיעור התמלא", "staff", "{staff} (פעמון)", False, texts={
        "bell": "אין יותר מקומות ב{class_name} ב-{class_date} בשעה {class_time}"}),
    Event("class_at_risk", "שיעור בסיכון: הנרשמים מתחת למינימום לפני שעת הבדיקה", "staff", "המנהל/ת (פעמון)", False, texts={
        "bell": "ב{class_name} ב-{class_date} בשעה {class_time} רשומים {booked} מתוך מינימום {minimum}"}),
    Event("membership_changed_by_staff", "מנוי הוקפא, נעצר או בוטל על ידי עובד", "staff", "הבעלים (פעמון)", True, module="memberships",
          link="/classes?tab=memberships", texts={
        "bell": "המנוי של {client_name} {status_word} על ידי {staff_name}"}),
    Event("freeze_requested", "לקוח ביקש הקפאה או עצירה", "staff", "הבעלים (פעמון)", True, module="memberships",
          link="/classes?tab=memberships", texts={
        "bell": "{client_name} ביקש/ה {request_word} של המנוי"}),
)}

# The placeholders a text may use: what the owner sees, and the sample value a test message and the
# settings preview fill in. studio_name and staff_title come from the business itself.
PLACEHOLDERS: dict[str, tuple[str, str]] = {
    "client_name": ("שם הלקוח/ה", "דנה"),
    "class_name": ("שם השיעור", "פילאטיס מכשירים"),
    "class_date": ("תאריך השיעור", "12/10"),
    "class_time": ("שעת השיעור", "18:00"),
    "studio_name": ("שם העסק", ""),
    "staff_title": ("{staff}", ""),
    "change_note": ("מה השתנה", "השעה עודכנה ל-19:00"),
    "entry_note": ("מה קרה לכניסה", "הכניסה שלך הוחזרה לכרטיסייה."),
    "swap_note": ("מאיזה שיעור הועבר/ה", "במקום פילאטיס מכשירים ב-4/10 בשעה 18:00."),
    "fee_note": ("פירוט המדיניות", "ביטול בפחות מ-6 שעות לפני השיעור נחשב כניצול כניסה."),
    "promotion_note": ("פרטי ההרשמה מההמתנה", "נרשמת אוטומטית — נתראה!"),
    "expiry_note": ("פרטי התוקף", "המקום ששמרנו לך מחכה לאישור עד 18:30."),
    "freeze_note": ("פרטי ההקפאה", "המנוי שלך הוקפא עד 1/11."),
    "status_word": ("נעצר / בוטל", "נעצר"),
    "date": ("תאריך", "1/11"),
    "booked": ("מספר הנרשמים", "2"),
    "minimum": ("המינימום", "4"),
    "staff_name": ("שם העובד/ת", "נועה"),
    "request_word": ("הקפאה / עצירה", "הקפאה"),
    "request_note": ("פרטי הבקשה והתשובה", "בקשת ההקפאה שלך (4/10–18/10) לא אושרה: בחודש הראשון אין הקפאות."),
}


def placeholders(ev: Event) -> list[str]:
    """The placeholders offered for this event: those its texts use, then the business's own."""
    import re
    found = [k for t in ev.texts.values() for k in re.findall(r"\{(\w+)\}", t)]
    extra = (["client_name"] if ev.audience == "client" else []) + ["studio_name", "staff_title"]
    return list(dict.fromkeys(found + extra))


def fill_words(text_: str, words: dict) -> str:
    """The business's words into a label for the owner: "{staff} (פעמון)" → "מדריך/ה (פעמון)"."""
    import re
    return re.sub(r"\{(\w+)\}", lambda m: str(words.get(m.group(1), m.group(0))), text_)


def sample_context(db: Session, studio_id) -> dict:
    from app.models.studio import Studio
    from app.services.business_types import studio_terms
    studio = db.get(Studio, studio_id)
    return {**{k: sample for k, (_, sample) in PLACEHOLDERS.items()},
            "studio_name": studio.name if studio else "", "staff_title": studio_terms(db, studio_id)["staff"]}


def event_channels(ev: Event) -> tuple[str, ...]:
    return CLIENT_CHANNELS if ev.audience == "client" else ("bell",)


def _choices(db: Session, studio_id, event: str) -> dict:
    from app.models.notification_template import NotificationTemplate
    rows = db.scalars(select(NotificationTemplate).where(NotificationTemplate.studio_id == studio_id,
                                                         NotificationTemplate.event == event)).all()
    return {r.channel: r for r in rows}


def channel_setting(db: Session, studio_id, event: str, channel: str) -> tuple[bool, str]:
    """(on?, text) for one event and channel at this business — its own choice or the catalog's."""
    ev = EVENTS[event]
    row = _choices(db, studio_id, event).get(channel)
    on = True if ev.always_on else (row.enabled if row and row.enabled is not None else ev.default_on)
    body = row.body if row and row.body else ev.texts.get(channel, "")
    return on, body


def _fill(template: str, context: dict) -> str:
    from app.crud.automation import format_template
    return format_template(template, context)


def _dedup(event: str, about: str, recipient: str, channel: str) -> str:
    raw = f"{event}:{about}:{recipient}:{channel}"
    return raw if len(raw) <= 160 else raw[:120] + ":" + hashlib.sha1(raw.encode()).hexdigest()[:39]


def _claim(db: Session, table: str, studio_id, key: str) -> bool:
    """True if nothing was sent for this key yet. The unique index is the final guard (see notify)."""
    return db.execute(text(f"SELECT 1 FROM {table} WHERE studio_id = :s AND dedup_key = :k"),
                      {"s": str(studio_id), "k": key}).first() is None


def notify(db: Session, studio_id, event: str, *, origin: str, about: str, context: dict,
           clients: list | None = None, staff_user_ids: list | None = None, per_client: dict | None = None) -> int:
    """Queue this event's messages. Returns how many were queued (0 when the origin, the business's
    choice or an earlier identical event says not to). `about` names the thing the event is about
    (a booking id, a session id…) — with the recipient and channel it makes the dedup key. per_client
    adds to one client's context (client id → values), e.g. what happened to that client's entry."""
    if event not in EVENTS:
        raise ValueError(f"unknown notification event: {event}")
    if origin not in ORIGINS:
        raise ValueError(f"unknown event origin: {origin}")
    if origin == "migration":
        return 0                      # imports never send messages
    ev = EVENTS[event]
    from app.models.message_job import MessageJob
    from app.models.notification import Notification
    from app.models.studio import Studio
    studio = db.get(Studio, studio_id)
    from app.services.business_types import studio_terms
    words = studio_terms(db, studio_id)
    base = {"studio_name": studio.name if studio else "", "staff_title": words["staff"], **context}
    label = fill_words(ev.label, words)
    now = datetime.now(timezone.utc)
    queued = 0

    if ev.audience == "client":
        for n, client in enumerate(clients or []):
            ctx = {**base, "client_name": client.full_name or "", **(per_client or {}).get(client.id, {})}
            for channel in CLIENT_CHANNELS:
                on, body = channel_setting(db, studio_id, event, channel)
                to = client.phone if channel == "whatsapp" else client.email
                if not on or not body or not to:
                    continue
                key = _dedup(event, about, str(client.id), channel)
                if not _claim(db, "message_jobs", studio_id, key):
                    continue
                db.add(MessageJob(
                    studio_id=studio_id, client_id=client.id, channel=channel, to_phone=to,
                    subject=label if channel == "email" else None, body=_fill(body, ctx),
                    scheduled_at=now + timedelta(seconds=SPACING_SECONDS * n), status="pending",
                    reminder_type=f"notify-{event}"[:32], dedup_key=key,
                ))
                queued += 1
    else:
        on, body = channel_setting(db, studio_id, event, "bell")
        if on and body:
            key = _dedup(event, about, "staff", "bell")
            if _claim(db, "notifications", studio_id, key):
                db.add(Notification(studio_id=studio_id, type=f"notify-{event}"[:32], title=label,
                                    body=_fill(body, base), dedup_key=key, action_url=ev.link))
                queued += 1
    db.flush()
    return queued


def send_test(db: Session, studio_id, event: str, channel: str, user) -> str:
    """A test of one notification to the owner's own phone or e-mail, with sample values. Sent once per
    wording — the same text again is refused; an edited text can be tested again."""
    from app.models.message_job import MessageJob
    ev = EVENTS[event]
    _, body = channel_setting(db, studio_id, event, channel)
    if channel == "bell" or ev.audience != "client":
        raise ValueError("בדיקה נשלחת רק להודעות ללקוח (וואטסאפ או מייל)")
    to = user.phone if channel == "whatsapp" else user.email
    if not to:
        raise ValueError("אין לך מספר טלפון בפרופיל — הוסף אותו כדי לקבל בדיקה בוואטסאפ" if channel == "whatsapp"
                         else "אין לך כתובת מייל בפרופיל")
    version = hashlib.sha1(body.encode()).hexdigest()[:12]
    key = f"test:{event}:{channel}:{user.id}:{version}"
    if not _claim(db, "message_jobs", studio_id, key):
        raise ValueError("הבדיקה של הנוסח הזה כבר נשלחה. ערכת את הנוסח? שמור ונסה שוב.")
    from app.services.business_types import studio_terms
    ctx = sample_context(db, studio_id)
    ctx["client_name"] = (user.display_name or "").split(" ")[0] or ctx["client_name"]
    db.add(MessageJob(studio_id=studio_id, client_id=None, channel=channel, to_phone=to,
                      subject=f"בדיקה: {fill_words(ev.label, studio_terms(db, studio_id))}" if channel == "email" else None, body=_fill(body, ctx),
                      scheduled_at=datetime.now(timezone.utc), status="pending",
                      reminder_type=f"notify-{event}"[:32], dedup_key=key))
    db.flush()
    return to
