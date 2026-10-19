"""ויקי — the business's personal assistant (the owner, 2026-10-10/16: "learns the business and suggests what to improve —
the goal not reached: how to fix it; reached: how to keep it"). Stage 1: her suggestions, worked out from the system's
own numbers (the same ones לוח בקרה, the goals and the analytics show) and said in fixed plain Hebrew — nothing is made
up, nothing is sent to a client; each comes with the button to act on it. And her "moments": what just happened (a new
lead, a client who reported paying a deposit) — for her to pop in with (web: components/viki/VikiPopper).

A suggestion's key carries its period — "lapsed:2026-10" — so "עשיתי" / "לא רלוונטי" hides it until it's true again
in the next period (models/viki_dismissal).

Stage 3 (services/viki_learning.py): what came of what was done — a message to the clients and how many booked after
it — on her card and in the next suggestion of its kind; a kind marked "לא רלוונטי" again and again comes up far less."""
from __future__ import annotations

import math
import time as _time
from datetime import datetime, timedelta, timezone

import pytz
from sqlalchemy import func, select
from sqlalchemy.orm import Session

IL = pytz.timezone("Asia/Jerusalem")
SHOWN = 3                           # suggestions on the card at once
_CACHE: dict = {}                   # (studio, language) → (when, suggestions) — worked out at most every few minutes
CACHE_SECONDS = 300


def _ils(amount: float) -> str:
    return f"₪{round(amount):,}"


def _count(db: Session, q) -> int:
    return db.scalar(select(func.count()).select_from(q.subquery())) or 0


def _avg_appointment_ils(db: Session, studio_id, now: datetime) -> float:
    """The average price of an appointment in the last 90 days (those with a price)."""
    from app.models.appointment import Appointment
    avg = db.scalar(select(func.avg(Appointment.total_price_cents)).where(
        Appointment.studio_id == studio_id, Appointment.status.in_(("scheduled", "done")),
        Appointment.total_price_cents > 0, Appointment.starts_at >= now - timedelta(days=90)))
    return float(avg or 0) / 100


def suggestions(db: Session, studio_id, now: datetime | None = None, lang: str = "he") -> list[dict]:
    """Every suggestion that's true for the business now, the most important first:
    {key, tone: warn|tip|good, text, action: {label, href} | None} — said in the user's language (he | en —
    core/i18n.py; each text is written in both, side by side)."""
    from app.api.dashboard_routes import calendar_fill
    from app.core.features import has_module
    from app.models.appointment import Appointment
    from app.models.client import Client
    from app.models.lead import Lead
    from app.models.studio_settings import StudioSettings
    from app.repositories.goal_repository import GoalRepository
    from app.services.marketing import broadcast_recipients_query

    now = now or datetime.now(timezone.utc)
    today = now.astimezone(IL).date()
    ym = f"{today:%Y-%m}"
    settings = db.get(StudioSettings, studio_id)
    can_broadcast = has_module(db, studio_id, "broadcasts")
    out: list[tuple[int, dict]] = []

    def w(he: str, en: str) -> str:
        return en if lang == "en" else he

    def add(prio: int, key: str, tone: str, text: str, label: str | None = None, href: str | None = None):
        out.append((prio, {"key": key, "tone": tone, "text": text, "action": {"label": label, "href": href} if label else None}))

    # ── the month's goal ──
    prog = GoalRepository(db).get_progress(studio_id, today.year, today.month)
    target, current = float(prog["target_amount"]), float(prog["current_revenue"])
    if target <= 0:
        add(45, f"goal_none:{ym}", "tip", w("עוד לא הגדרת יעד הכנסות לחודש הזה. עם יעד אני יכולה להגיד לך כל יום אם אתה בקצב — ומה לעשות אם לא.",
                                           "You haven't set a revenue goal for this month yet. With a goal I can tell you every day whether you're on pace — and what to do if not."),
            w("להגדיר יעד", "Set a goal"), "/expenses")
    elif current >= target:
        add(50, f"goal_hit:{ym}", "good", w(f"כל הכבוד! עברת את יעד החודש — {_ils(current)} מתוך {_ils(target)}. עכשיו העיקר לשמור על הקצב עד סוף החודש.",
                                           f"Well done! You passed this month's goal — {_ils(current)} of {_ils(target)}. Now the key is to keep the pace until the month ends."),
            w("לראות את החודש", "See the month"), "/analytics/business")
    elif prog["days_elapsed"] >= 3:
        projected = float(prog["current_daily_avg"]) * prog["days_in_month"]
        pct = round(projected / target * 100)
        if projected < target * 0.95:
            missing, days_left = target - current, prog["days_remaining"]
            avg = _avg_appointment_ils(db, studio_id, now)
            appts = math.ceil(missing / avg) if avg > 0 else 0
            more = w(f" — בערך {appts} תורים ב-{days_left} ימי העבודה שנשארו.", f" — about {appts} appointments in the {days_left} working days left.") \
                if appts and days_left else "."
            add(90, f"goal_behind:{ym}", "warn",
                w(f"בקצב הנוכחי החודש ייסגר בערך ב-{_ils(projected)} — {pct}% מהיעד ({_ils(target)}). כדי להגיע ליעד חסרים {_ils(missing)}{more}",
                  f"At the current pace the month will close at about {_ils(projected)} — {pct}% of the goal ({_ils(target)}). To reach the goal you need {_ils(missing)} more{more}"),
                w("לפתוח את היומן", "Open the calendar"), "/calendar")
        else:
            add(35, f"goal_pace:{ym}", "good", w(f"אתה בקצב טוב: בקצב הזה החודש ייסגר בערך ב-{_ils(projected)} — {pct}% מהיעד.",
                                                f"You're on a good pace: at this pace the month will close at about {_ils(projected)} — {pct}% of the goal."))

    # ── leads waiting for an answer ──
    waiting = _count(db, select(Lead.id).where(Lead.studio_id == studio_id, Lead.status == "new",
                                               Lead.created_at < now - timedelta(hours=24)))
    if waiting:
        add(85, f"leads:{today.isoformat()}", "warn",
            w(("ליד אחד מחכה" if waiting == 1 else f"{waiting} לידים מחכים") + " לתשובה כבר יותר מיום. ליד שעונים לו מהר — נסגר הרבה יותר.",
              ("One lead has" if waiting == 1 else f"{waiting} leads have") + " been waiting for an answer for over a day. A lead answered quickly closes far more often."),
            w("ללידים", "To the leads"), "/dashboard#leads")

    # ── clients who haven't come back ──
    lapsed = _count(db, broadcast_recipients_query(studio_id, "lapsed"))
    if lapsed >= 3:
        add(75, f"lapsed:{ym}", "tip",
            w(f"{lapsed} לקוחות לא הגיעו כבר יותר מחודשיים ואין להם תור. הודעה אישית קצרה מחזירה חלק מהם.",
              f"{lapsed} clients haven't come in for over two months and have no appointment. A short personal message brings some of them back."),
            *((w("לשלוח להם הודעה", "Send them a message"), "/broadcasts?audience=lapsed") if can_broadcast else (w("לראות", "See them"), "/clients/analytics")))

    # ── next week's calendar ──
    week_start = today - timedelta(days=(today.weekday() + 1) % 7)
    next_week = calendar_fill(db, studio_id, week_start + timedelta(days=7), week_start + timedelta(days=14))
    work_days = getattr(settings, "work_days", None)
    if next_week["percent"] < 40 and (work_days is None or len(work_days) > 0):
        add(70, f"fill_next:{(week_start + timedelta(days=7)).isoformat()}", "warn",
            w(f"השבוע הבא מלא רק ב-{next_week['percent']}%. זה זמן טוב להזכיר ללקוחות שאפשר לקבוע — הודעה קצרה ללקוחות קבועים עושה פלאים.",
              f"Next week is only {next_week['percent']}% full. A good time to remind clients they can book — a short message to regulars works wonders."),
            *((w("לשלוח הודעה ללקוחות", "Message your clients"), "/broadcasts?audience=all") if can_broadcast else (w("לפתוח את היומן", "Open the calendar"), "/calendar")))

    # ── no-shows, while the reminder two hours before is off ──
    if settings is not None and not settings.reminder_2_hours_enabled:
        no_shows = _count(db, select(Appointment.id).where(Appointment.studio_id == studio_id, Appointment.status == "no_show",
                                                          Appointment.starts_at >= now - timedelta(days=30)))
        if no_shows >= 3:
            add(60, f"noshow:{ym}", "tip",
                w(f"{no_shows} לקוחות לא הגיעו לתור ב-30 הימים האחרונים. תזכורת נוספת כשעתיים לפני התור מורידה את זה.",
                  f"{no_shows} clients didn't show up in the last 30 days. Another reminder about two hours before the appointment brings that down."),
                w("להפעיל את התזכורת", "Turn on the reminder"), "/message-templates")

    # ── birthdays, while the birthday message is off ──
    if settings is not None and not settings.birthday_automation_enabled:
        born = _count(db, select(Client.id).where(Client.studio_id == studio_id, Client.is_active.is_(True),
                                                  func.extract("month", Client.birth_date) == today.month))
        if born:
            add(40, f"birthdays:{ym}", "tip",
                w(f"{born} לקוחות חוגגים יום הולדת החודש, וההודעה ליום הולדת כבויה. ברכה עם הטבה קטנה מחזירה לקוחות.",
                  f"{born} clients have a birthday this month, and the birthday message is off. A greeting with a small benefit brings clients back."),
                w("להפעיל ברכות", "Turn on greetings"), "/automation")

    # ── what came of what was done (stage 3 — services/viki_learning.py) ──
    from app.services import viki_learning as vl
    sent = vl.recent(db, studio_id, now)
    for b, r in sent[:2]:
        when = b.scheduled_at.astimezone(IL).strftime("%d/%m")
        if r["booked"] and r["days"] >= 1:
            money = w(f" — תורים בסך {_ils(r['revenue'])}", f" — appointments worth {_ils(r['revenue'])}") if r["revenue"] else ""
            add(55, f"bc_good:{b.id}", "good",
                w(f"ההודעה ששלחת ב-{when} ל-{r['recipients']} לקוחות: {r['booked']} מהם כבר קבעו תור אחרי ההודעה{money}. "
                  "זה עובד — שווה לחזור על זה בעוד חודש.",
                  f"The message you sent on {when} to {r['recipients']} clients: {r['booked']} of them already booked after it{money}. "
                  "It works — worth repeating in a month."), w("להודעות ללקוחות", "To client messages"), "/broadcasts")
        elif r["days"] >= 7 and r["recipients"] >= 10 and not r["booked"]:
            add(30, f"bc_none:{b.id}", "tip",
                w(f"ההודעה מ-{when} ל-{r['recipients']} לקוחות עוד לא הביאה תורים. בפעם הבאה אפשר לנסות הטבה קטנה או נוסח אישי יותר.",
                  f"The message from {when} to {r['recipients']} clients hasn't brought appointments yet. Next time try a small benefit or a more personal wording."),
                w("לנסח הודעה חדשה", "Write a new message"), "/broadcasts")
    last = {}                                            # the newest message with bookings, per audience
    for b, r in sent:
        if r["booked"] and b.audience not in last:
            last[b.audience] = (b, r)
    quiet = vl.quiet_kinds(db, studio_id, now)
    learned = []
    for prio, s in out:
        kind = s["key"].split(":")[0]
        if kind in quiet:
            prio -= 40                                   # the owner said, again and again, it isn't for them
        before = last.get({"lapsed": "lapsed", "fill_next": "all"}.get(kind, ""))
        if before:
            b, r = before
            on = b.scheduled_at.astimezone(IL).strftime("%d/%m")
            s = {**s, "text": s["text"] + w(f" בפעם הקודמת ({on}) {r['booked']} לקוחות קבעו תור אחרי ההודעה.",
                                            f" Last time ({on}) {r['booked']} clients booked after the message.")}
            prio += 10
        learned.append((prio, s))

    return [s for _, s in sorted(learned, key=lambda x: -x[0])]


def suggestions_cached(db: Session, studio_id, lang: str = "he") -> list[dict]:
    hit = _CACHE.get((studio_id, lang))
    if hit and _time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    fresh = suggestions(db, studio_id, lang=lang)
    _CACHE[(studio_id, lang)] = (_time.monotonic(), fresh)
    return fresh


def forget(studio_id) -> None:
    for lang in ("he", "en"):
        _CACHE.pop((studio_id, lang), None)


def for_user(db: Session, studio_id, user_id, lang: str = "he") -> list[dict]:
    """The suggestions this user hasn't answered, in their language."""
    from app.models.viki_dismissal import VikiDismissal
    answered = set(db.scalars(select(VikiDismissal.key).where(VikiDismissal.user_id == user_id)).all())
    return [s for s in suggestions_cached(db, studio_id, lang) if s["key"] not in answered]


def moments(db: Session, studio_id, since: datetime, now: datetime | None = None, lang: str = "he") -> list[dict]:
    """What happened since `since` that ויקי pops in for: a new lead, a client who reported paying a deposit.
    {key, text, action}."""
    from app.models.appointment import Appointment
    from app.models.client import Client
    from app.models.lead import Lead
    now = now or datetime.now(timezone.utc)
    since = max(since, now - timedelta(hours=2))          # never a backlog of old news
    out: list[dict] = []
    for lead in db.scalars(select(Lead).where(Lead.studio_id == studio_id, Lead.created_at > since)
                           .order_by(Lead.created_at.desc()).limit(3)).all():
        what = f" — {lead.service_interest}" if lead.service_interest else ""
        out.append({"key": f"lead:{lead.id}",
                    "text": f"A new lead: {lead.name}{what}. A lead answered quickly closes far more often!" if lang == "en"
                    else f"נכנס ליד חדש: {lead.name}{what}. ליד שעונים לו מהר — נסגר הרבה יותר!",
                    "action": {"label": "To the leads" if lang == "en" else "ללידים", "href": "/dashboard#leads"}})
    rows = db.execute(select(Appointment, Client.full_name).join(Client, Client.id == Appointment.client_id, isouter=True)
                      .where(Appointment.studio_id == studio_id, Appointment.payment_sent_at > since,
                             Appointment.payment_verified_at.is_(None), Appointment.deposit_amount_cents > 0)
                      .order_by(Appointment.payment_sent_at.desc()).limit(3)).all()
    for appt, name in rows:
        out.append({"key": f"deposit:{appt.id}",
                    "text": f"{name or 'A client'} reported paying a {_ils(appt.deposit_amount_cents / 100)} deposit. Approve?" if lang == "en"
                    else f"{name or 'לקוח'} דיווח ששילם מקדמה של {_ils(appt.deposit_amount_cents / 100)}. לאשר?",
                    "action": {"label": "Approve" if lang == "en" else "לאשר", "href": f"/calendar?appt={appt.id}"}})
    return out
