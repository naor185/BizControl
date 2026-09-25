"""
The business owner's settings for classes and memberships — nothing hardcoded.

Each setting (POLICIES) has a type, a default, allowed values and the levels it can be set at: the whole
business ("studio"), a class template, a membership type. get_policy() returns the value at the most
specific level that has one — class template first, then membership type, then the business, then the
default (the owner's decision, 2026-09-24: a costly workshop keeps its own rules whatever the client's
membership). Screens for the template and membership-type levels come with those objects (stages 2, 4);
the data model already holds every level.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

STUDIO, TEMPLATE, MEMBERSHIP = "studio", "class_template", "membership_type"
PRECEDENCE = (TEMPLATE, MEMBERSHIP, STUDIO)


@dataclass(frozen=True)
class Policy:
    key: str
    label: str
    kind: str                       # int | bool | choice
    default: object
    scopes: tuple[str, ...]
    minimum: int | None = None
    maximum: int | None = None
    choices: tuple[tuple[str, str], ...] = ()
    unit: str = ""
    help: str = ""
    module: str = "classes"         # shown to the owner only when this module is on
    requires: tuple[str, ...] = ()  # …and these too
    presets: tuple[tuple[int, str], ...] = ()   # ready-made values offered next to a number (the owner may type another)


_POINTS_PRESETS = ((0, "בלי נקודות"), (2, "2%"), (5, "5%"), (10, "10%"))

POLICIES: dict[str, Policy] = {p.key: p for p in (
    Policy("free_cancel_hours", "חלון ביטול חינם", "int", 6, (STUDIO, TEMPLATE), 0, 168, unit="שעות לפני השיעור",
           help="ביטול לפני זה לא עולה כלום והכניסה חוזרת. אחרי זה — לפי מדיניות הביטול המאוחר."),
    Policy("booking_opens_days", "ההרשמה נפתחת", "int", 14, (STUDIO, TEMPLATE), 1, 90, unit="ימים לפני השיעור"),
    Policy("booking_closes_minutes", "ההרשמה נסגרת", "int", 15, (STUDIO, TEMPLATE), 0, 1440, unit="דקות לפני השיעור"),
    Policy("waitlist_max", "מקסימום ממתינים", "int", 10, (STUDIO, TEMPLATE), 0, 100, unit="ממתינים לשיעור",
           help="הערך 0 — בלי רשימת המתנה.", module="class_waitlist"),
    Policy("waitlist_mode", "קידום מרשימת ההמתנה", "choice", "auto", (STUDIO, TEMPLATE),
           choices=(("auto", "אוטומטי — הממתין הראשון נרשם מיד (כשיש לו זכאות)"),
                    ("approval", "באישור — הממתין מקבל הודעה ומאשר בתוך חלון זמן")), module="class_waitlist"),
    Policy("waitlist_confirm_minutes", "חלון האישור לממתין", "int", 30, (STUDIO, TEMPLATE), 5, 1440, unit="דקות", module="class_waitlist"),
    Policy("min_participants", "מינימום משתתפים", "int", 0, (STUDIO, TEMPLATE), 0, 100, unit="משתתפים",
           help="הערך 0 — אין מינימום."),
    Policy("min_check_hours", "בדיקת המינימום", "int", 3, (STUDIO, TEMPLATE), 1, 72, unit="שעות לפני השיעור"),
    Policy("auto_cancel_below_min", "ביטול אוטומטי מתחת למינימום", "bool", False, (STUDIO, TEMPLATE),
           help="כשבשעת הבדיקה רשומים פחות מהמינימום: השיעור מתבטל, הנרשמים מקבלים הודעה והכניסות חוזרות."),
    Policy("reminder_hours", "תזכורת לפני שיעור", "int", 3, (STUDIO,), 0, 72, unit="שעות לפני השיעור",
           help="הערך 0 — בלי תזכורת."),
    Policy("weeks_ahead", "כמה שבועות מראש נוצרים שיעורים", "int", 8, (STUDIO,), 1, 26, unit="שבועות"),
    Policy("client_booking", "לקוחות נרשמים בעצמם ב-BizFind", "bool", True, (STUDIO,),
           help="רק מי שכבר לקוח/ה של העסק ויש לו/ה מנוי שמכסה את השיעור. ההרשמה נפתחת ונסגרת לפי ההגדרות כאן.",
           module="memberships"),
    # Club points on class payments — the owner's percentages (a point is worth ₪1, as on any payment); 0 = none.
    Policy("club_points_membership_percent", "נקודות מועדון על קניית מנוי", "int", 0, (STUDIO,), 0, 100, unit="% מהתשלום",
           help="חבר/ת מועדון שמשלם/ת על מנוי מקבל/ת נקודות לפי האחוז הזה. מחיקת התשלום מורידה אותן.",
           module="customer_club", requires=("memberships",), presets=_POINTS_PRESETS),
    Policy("club_points_entry_percent", "נקודות מועדון על כניסה בודדת", "int", 0, (STUDIO,), 0, 100, unit="% מהתשלום",
           help="על תשלום לשיעור בלי מנוי. חיוב על ביטול מאוחר או על אי-הגעה לא מזכה בנקודות.",
           module="customer_club", presets=_POINTS_PRESETS),
)}

CLUB_POINTS = ("club_points_membership_percent", "club_points_entry_percent")


def validate(key: str, value) -> object:
    """The value to store, or ValueError with a message for the owner."""
    p = POLICIES.get(key)
    if not p:
        raise ValueError(f"הגדרה לא מוכרת: {key}")
    if p.kind == "bool":
        if not isinstance(value, bool):
            raise ValueError(f"{p.label}: כן או לא")
        return value
    if p.kind == "choice":
        if value not in {c for c, _ in p.choices}:
            raise ValueError(f"{p.label}: ערך לא מוכר")
        return value
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{p.label}: מספר שלם")
    if (p.minimum is not None and value < p.minimum) or (p.maximum is not None and value > p.maximum):
        raise ValueError(f"{p.label}: בין {p.minimum} ל-{p.maximum}")
    return value


def _rows(db: Session, studio_id, key: str | None = None):
    from app.models.policy_setting import PolicySetting as P
    q = select(P).where(P.studio_id == studio_id)
    if key:
        q = q.where(P.key == key)
    return db.scalars(q).all()


def get_policy(db: Session, studio_id, key: str, *, template_id=None, membership_type_id=None):
    """The value that applies — the most specific level that has one, else the default."""
    p = POLICIES[key]
    found = {(r.scope_type, r.scope_id): r.value for r in _rows(db, studio_id, key)}
    wanted = {TEMPLATE: template_id, MEMBERSHIP: membership_type_id, STUDIO: None}
    for scope in PRECEDENCE:
        if scope not in p.scopes or (scope != STUDIO and wanted[scope] is None):
            continue
        if (scope, wanted[scope]) in found:
            return found[(scope, wanted[scope])]
    return p.default


def is_late_cancel(db: Session, studio_id, class_starts_at, cancelled_at, *, template_id=None) -> bool:
    """True when a cancellation falls inside the free-cancel window the owner set (free_cancel_hours) —
    then the late-cancel policy applies (stage 4); otherwise the entry simply returns."""
    from datetime import timedelta
    hours = get_policy(db, studio_id, "free_cancel_hours", template_id=template_id)
    return cancelled_at > class_starts_at - timedelta(hours=hours)


def studio_policies(db: Session, studio_id) -> dict:
    """Every setting at the business level: its value (own or default) and whether the owner set it."""
    own = {r.key: r.value for r in _rows(db, studio_id) if r.scope_type == STUDIO and r.scope_id is None}
    return {k: {"value": own.get(k, p.default), "is_default": k not in own} for k, p in POLICIES.items()}


def shown(db: Session, studio_id) -> list[Policy]:
    """The settings this business has — each one's modules are in its plan (the club's points only with the club)."""
    from app.services.memberships import _module
    on: dict[str, bool] = {}

    def enabled(module: str) -> bool:        # one check per module
        if module not in on:
            on[module] = _module(db, studio_id, module)
        return on[module]

    return [p for p in POLICIES.values() if all(enabled(m) for m in (p.module, *p.requires))]


def presets(db: Session, studio_id, p: Policy) -> list[tuple[int, str]]:
    """The ready-made values offered for a number — for the club's points, also the business's own
    percentage on a regular payment."""
    out = list(p.presets)
    if p.key in CLUB_POINTS:
        from app.models.studio_settings import StudioSettings
        s = db.get(StudioSettings, studio_id)
        regular = int(s.points_percent_per_payment or 0) if s else 0
        if regular:
            out = [(v, l) for v, l in out if v != regular]
            out.insert(1, (regular, f"כמו בתשלום רגיל ({regular}%)"))
    return out


def set_policy(db: Session, studio_id, key: str, value, *, scope_type: str = STUDIO, scope_id=None,
               user_id=None) -> None:
    """Store one setting at one level; value None removes it (the level above applies again)."""
    from app.models.policy_setting import PolicySetting
    p = POLICIES.get(key)
    if not p:
        raise ValueError(f"הגדרה לא מוכרת: {key}")
    if scope_type not in p.scopes:
        raise ValueError(f"{p.label}: לא ניתן להגדיר ברמה הזו")
    if (scope_type == STUDIO) != (scope_id is None):
        raise ValueError("רמה לא תקינה")
    row = next((r for r in _rows(db, studio_id, key) if r.scope_type == scope_type and r.scope_id == scope_id), None)
    if value is None:
        if row:
            db.delete(row)
        return
    value = validate(key, value)
    if row:
        row.value, row.updated_by = value, user_id
    else:
        db.add(PolicySetting(studio_id=studio_id, scope_type=scope_type, scope_id=scope_id, key=key,
                             value=value, updated_by=user_id))
