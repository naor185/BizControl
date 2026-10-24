"""ויקי's summaries — the week (every Sunday morning) and the month (on the 1st), for each business (the owner's vision,
2026-10-10: "the goal not reached — how to improve; reached — how to keep it; the good points and the bad points").

The numbers come only from the system — the same revenue the goals count (payments received + till sales, by the
Israeli day), appointments, first-time clients, no-shows, the calendar's fill, the month's goal. The lines are built
from them in fixed plain Hebrew; then, when an AI provider is set, she may say them more warmly — accepted only if not
one number was changed, added or dropped (else the fixed lines stay). Stored once per business and period
(models/viki_summary); the bell and a push say it's ready — without amounts (the bell is the managers' too) — and the
summary itself is on לוח בקרה, for whoever may see the money."""
from __future__ import annotations

import json
import logging
import math
import re
from datetime import date, datetime, time, timedelta, timezone

import pytz
from sqlalchemy import func, select
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)
IL = pytz.timezone("Asia/Jerusalem")
HOUR = 9                                  # Sunday / the 1st, from 9:00 Israel time
MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]


def _ils(amount: float) -> str:
    return f"₪{round(amount):,}"


def _pct_change(now: float, before: float) -> int:
    return round((now - before) / before * 100) if before else 0


def _revenue(db: Session, studio_id, start: date, end: date) -> float:
    """Money in from `start` up to (not including) `end` — the goals' own count."""
    from app.repositories.goal_repository import GoalRepository
    from app.services.classes import at_il
    return sum(GoalRepository(db)._cents_by_day(studio_id, at_il(start, time(0)), at_il(end, time(0))).values()) / 100


def _utc(d: date) -> datetime:
    return IL.localize(datetime.combine(d, time(0))).astimezone(timezone.utc)


def _appointments(db: Session, studio_id, start: date, end: date, status=None) -> int:
    from app.models.appointment import Appointment
    q = select(func.count(Appointment.id)).where(Appointment.studio_id == studio_id,
                                                 Appointment.starts_at >= _utc(start), Appointment.starts_at < _utc(end))
    q = q.where(Appointment.status == status) if status else q.where(Appointment.status.notin_(("canceled", "no_show")))
    return db.scalar(q) or 0


def _first_timers(db: Session, studio_id, start: date, end: date) -> int:
    """Clients whose first real appointment ever fell in the period."""
    from app.models.appointment import Appointment
    first = (select(Appointment.client_id, func.min(Appointment.starts_at).label("first"))
             .where(Appointment.studio_id == studio_id, Appointment.client_id.isnot(None),
                    Appointment.status.notin_(("canceled", "no_show")))
             .group_by(Appointment.client_id).subquery())
    return db.scalar(select(func.count()).select_from(first).where(first.c.first >= _utc(start), first.c.first < _utc(end))) or 0


def week_facts(db: Session, studio_id, week_start: date) -> dict:
    """The week that started on `week_start` (a Sunday), against the one before, and what's ahead."""
    from app.api.dashboard_routes import calendar_fill
    from app.repositories.goal_repository import GoalRepository
    from app.services import viki
    from app.services.marketing import broadcast_recipients_query
    end, prev = week_start + timedelta(days=7), week_start - timedelta(days=7)
    prog = GoalRepository(db).get_progress(studio_id, end.year, end.month)
    target = float(prog["target_amount"])
    projected = float(prog["current_daily_avg"]) * prog["days_in_month"] if prog["days_elapsed"] else 0
    return {
        "revenue": _revenue(db, studio_id, week_start, end), "revenue_before": _revenue(db, studio_id, prev, week_start),
        "appointments": _appointments(db, studio_id, week_start, end),
        "appointments_before": _appointments(db, studio_id, prev, week_start),
        "first_timers": _first_timers(db, studio_id, week_start, end),
        "no_shows": _appointments(db, studio_id, week_start, end, status="no_show"),
        "fill_ahead": calendar_fill(db, studio_id, end, end + timedelta(days=7))["percent"],
        "goal": target, "goal_projected": projected, "goal_days_elapsed": prog["days_elapsed"],
        "goal_missing": max(0.0, target - float(prog["current_revenue"])),
        "avg_appointment": viki._avg_appointment_ils(db, studio_id, datetime.now(timezone.utc)),
        "lapsed": viki._count(db, broadcast_recipients_query(studio_id, "lapsed")),
    }


def month_facts(db: Session, studio_id, year: int, month: int) -> dict:
    """The month, against its goal, the month before and the same month a year ago."""
    from app.repositories.goal_repository import GoalRepository
    from app.services import viki
    from app.services.marketing import broadcast_recipients_query
    start = date(year, month, 1)
    end = (start + timedelta(days=32)).replace(day=1)
    before = (start - timedelta(days=1)).replace(day=1)
    year_ago = date(year - 1, month, 1)
    goal = GoalRepository(db).get_goal(studio_id, year, month)
    return {
        "month": month, "revenue": _revenue(db, studio_id, start, end), "revenue_before": _revenue(db, studio_id, before, start),
        "revenue_year_ago": _revenue(db, studio_id, year_ago, (year_ago + timedelta(days=32)).replace(day=1)),
        "goal": float(goal.target_amount) if goal else 0.0,
        "appointments": _appointments(db, studio_id, start, end),
        "appointments_before": _appointments(db, studio_id, before, start),
        "first_timers": _first_timers(db, studio_id, start, end),
        "no_shows": _appointments(db, studio_id, start, end, status="no_show"),
        "lapsed": viki._count(db, broadcast_recipients_query(studio_id, "lapsed")),
    }


def _compare(lines_good: list, lines_improve: list, now: float, before: float, what_up: str, what_down: str) -> None:
    change = _pct_change(now, before)
    if before and change >= 5:
        lines_good.append(what_up.format(change=change))
    elif before and change <= -5:
        lines_improve.append(what_down.format(change=-change))


def week_lines(f: dict) -> dict | None:
    """What went well, what to improve, the goal for the week — None when there's nothing to say yet."""
    if not (f["revenue"] or f["revenue_before"] or f["appointments"] or f["appointments_before"]):
        return None
    good: list[str] = []
    improve: list[str] = []
    _compare(good, improve, f["revenue"], f["revenue_before"],
             f"ההכנסות בשבוע שעבר: {_ils(f['revenue'])} — {{change}}% יותר מהשבוע שלפניו.",
             f"ההכנסות בשבוע שעבר: {_ils(f['revenue'])} — {{change}}% פחות מהשבוע שלפניו.")
    _compare(good, improve, f["appointments"], f["appointments_before"],
             f"{f['appointments']} תורים — {{change}}% יותר מהשבוע שלפניו.",
             f"{f['appointments']} תורים — {{change}}% פחות מהשבוע שלפניו.")
    if f["first_timers"]:
        good.append("לקוח חדש אחד הגיע בפעם הראשונה." if f["first_timers"] == 1 else f"{f['first_timers']} לקוחות חדשים הגיעו בפעם הראשונה.")
    if f["no_shows"] >= 2:
        improve.append(f"{f['no_shows']} לקוחות לא הגיעו לתור — מקדמה או תזכורת נוספת לפני התור יעזרו.")
    elif f["appointments"] >= 5 and not f["no_shows"]:
        good.append("אף לקוח לא הבריז השבוע.")
    behind = f["goal"] > 0 and f["goal_days_elapsed"] >= 3 and f["goal_projected"] < f["goal"] * 0.95
    if f["goal"] > 0 and f["goal_days_elapsed"] >= 3:
        pct = round(f["goal_projected"] / f["goal"] * 100)
        if behind:
            improve.append(f"בקצב הנוכחי החודש ייסגר בערך ב-{pct}% מהיעד — חסרים {_ils(f['goal_missing'])}.")
        else:
            good.append(f"אתה בקצב ליעד החודש — בערך {pct}% ממנו.")
    if f["fill_ahead"] < 40:
        improve.append(f"השבוע מלא רק ב-{f['fill_ahead']}%.")

    if f["fill_ahead"] < 40:
        focus = "המטרה השבוע: למלא את היומן — הודעה קצרה ללקוחות קבועים, או מבצע לשעות הריקות."
    elif behind and f["avg_appointment"] > 0:
        focus = f"המטרה השבוע: עוד בערך {math.ceil(f['goal_missing'] / f['avg_appointment'])} תורים עד סוף החודש, כדי להגיע ליעד."
    elif f["lapsed"] >= 3:
        focus = f"המטרה השבוע: להחזיר לקוחות שלא הגיעו מזמן — יש {f['lapsed']} כאלה."
    else:
        focus = "המטרה השבוע: לשמור על הקצב — אתה בכיוון הנכון."
    return {"good": good, "improve": improve, "focus": focus}


def month_lines(f: dict) -> dict | None:
    if not (f["revenue"] or f["revenue_before"] or f["appointments"]):
        return None
    name = MONTHS[f["month"] - 1]
    good: list[str] = []
    improve: list[str] = []
    if f["goal"] > 0:
        pct = round(f["revenue"] / f["goal"] * 100)
        if f["revenue"] >= f["goal"]:
            good.append(f"הגעת ליעד של {name}: {_ils(f['revenue'])} מתוך {_ils(f['goal'])} — {pct}%.")
        else:
            improve.append(f"{name} נסגר ב-{_ils(f['revenue'])} — {pct}% מהיעד. חסרו {_ils(f['goal'] - f['revenue'])}.")
    _compare(good, improve, f["revenue"], f["revenue_before"],
             f"ההכנסות ב{name}: {_ils(f['revenue'])} — {{change}}% יותר מהחודש שלפניו.",
             f"ההכנסות ב{name}: {_ils(f['revenue'])} — {{change}}% פחות מהחודש שלפניו.")
    if f["revenue_year_ago"]:
        _compare(good, improve, f["revenue"], f["revenue_year_ago"],
                 f"לעומת {name} בשנה שעברה: {{change}}% יותר.", f"לעומת {name} בשנה שעברה: {{change}}% פחות.")
    _compare(good, improve, f["appointments"], f["appointments_before"],
             f"{f['appointments']} תורים — {{change}}% יותר מהחודש שלפניו.",
             f"{f['appointments']} תורים — {{change}}% פחות מהחודש שלפניו.")
    if f["first_timers"]:
        good.append(f"{f['first_timers']} לקוחות חדשים הגיעו בפעם הראשונה.")
    if f["no_shows"] >= 3:
        improve.append(f"{f['no_shows']} לקוחות לא הגיעו לתור — כדאי לבקש מקדמה או להוסיף תזכורת.")

    if f["goal"] <= 0:
        focus = "המטרה לחודש החדש: להגדיר יעד הכנסות — ככה אוכל להגיד לך כל יום אם אתה בקצב."
    elif f["revenue"] >= f["goal"]:
        focus = "המטרה לחודש החדש: לשמור על מה שעבד — ואולי להעלות את היעד קצת."
    elif f["lapsed"] >= 3:
        focus = f"המטרה לחודש החדש: להחזיר את {f['lapsed']} הלקוחות שלא הגיעו מזמן, ולמלא את השעות הריקות."
    else:
        focus = "המטרה לחודש החדש: למלא את השעות הריקות ביומן — זה הדרך הכי מהירה להגיע ליעד."
    return {"good": good, "improve": improve, "focus": focus}


# The same summaries in English (the owner, 2026-10-20: the whole system in English) — rebuilt from the saved
# numbers when an English reader opens it; the Hebrew one may have been reworded by the AI, this one is the plain text.
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
             "November", "December"]


def week_lines_en(f: dict) -> dict | None:
    if not (f["revenue"] or f["revenue_before"] or f["appointments"] or f["appointments_before"]):
        return None
    good: list[str] = []
    improve: list[str] = []
    _compare(good, improve, f["revenue"], f["revenue_before"],
             f"Revenue last week: {_ils(f['revenue'])} — {{change}}% more than the week before.",
             f"Revenue last week: {_ils(f['revenue'])} — {{change}}% less than the week before.")
    _compare(good, improve, f["appointments"], f["appointments_before"],
             f"{f['appointments']} appointments — {{change}}% more than the week before.",
             f"{f['appointments']} appointments — {{change}}% less than the week before.")
    if f["first_timers"]:
        good.append("One new client came for the first time." if f["first_timers"] == 1
                    else f"{f['first_timers']} new clients came for the first time.")
    if f["no_shows"] >= 2:
        improve.append(f"{f['no_shows']} clients didn't show up — a deposit or another reminder before the appointment will help.")
    elif f["appointments"] >= 5 and not f["no_shows"]:
        good.append("No client missed an appointment this week.")
    behind = f["goal"] > 0 and f["goal_days_elapsed"] >= 3 and f["goal_projected"] < f["goal"] * 0.95
    if f["goal"] > 0 and f["goal_days_elapsed"] >= 3:
        pct = round(f["goal_projected"] / f["goal"] * 100)
        if behind:
            improve.append(f"At this pace the month will close at about {pct}% of the goal — {_ils(f['goal_missing'])} short.")
        else:
            good.append(f"You're on pace for this month's goal — about {pct}% of it.")
    if f["fill_ahead"] < 40:
        improve.append(f"This week is only {f['fill_ahead']}% full.")
    if f["fill_ahead"] < 40:
        focus = "This week's goal: fill the calendar — a short message to regular clients, or an offer for the empty hours."
    elif behind and f["avg_appointment"] > 0:
        focus = (f"This week's goal: about {math.ceil(f['goal_missing'] / f['avg_appointment'])} more appointments by "
                 "the end of the month to reach the goal.")
    elif f["lapsed"] >= 3:
        focus = f"This week's goal: bring back clients who haven't come in a while — there are {f['lapsed']}."
    else:
        focus = "This week's goal: keep the pace — you're on the right track."
    return {"good": good, "improve": improve, "focus": focus}


def month_lines_en(f: dict) -> dict | None:
    if not (f["revenue"] or f["revenue_before"] or f["appointments"]):
        return None
    name = MONTHS_EN[f["month"] - 1]
    good: list[str] = []
    improve: list[str] = []
    if f["goal"] > 0:
        pct = round(f["revenue"] / f["goal"] * 100)
        if f["revenue"] >= f["goal"]:
            good.append(f"You reached {name}'s goal: {_ils(f['revenue'])} of {_ils(f['goal'])} — {pct}%.")
        else:
            improve.append(f"{name} closed at {_ils(f['revenue'])} — {pct}% of the goal. {_ils(f['goal'] - f['revenue'])} short.")
    _compare(good, improve, f["revenue"], f["revenue_before"],
             f"Revenue in {name}: {_ils(f['revenue'])} — {{change}}% more than the month before.",
             f"Revenue in {name}: {_ils(f['revenue'])} — {{change}}% less than the month before.")
    if f["revenue_year_ago"]:
        _compare(good, improve, f["revenue"], f["revenue_year_ago"],
                 f"Against {name} last year: {{change}}% more.", f"Against {name} last year: {{change}}% less.")
    _compare(good, improve, f["appointments"], f["appointments_before"],
             f"{f['appointments']} appointments — {{change}}% more than the month before.",
             f"{f['appointments']} appointments — {{change}}% less than the month before.")
    if f["first_timers"]:
        good.append(f"{f['first_timers']} new clients came for the first time.")
    if f["no_shows"] >= 3:
        improve.append(f"{f['no_shows']} clients didn't show up — worth asking for a deposit or adding a reminder.")
    if f["goal"] <= 0:
        focus = "The goal for the new month: set a revenue goal — then I can tell you every day whether you're on pace."
    elif f["revenue"] >= f["goal"]:
        focus = "The goal for the new month: keep what worked — and maybe raise the goal a little."
    elif f["lapsed"] >= 3:
        focus = (f"The goal for the new month: bring back the {f['lapsed']} clients who haven't come in a while, "
                 "and fill the empty hours.")
    else:
        focus = "The goal for the new month: fill the empty hours in the calendar — the fastest way to reach the goal."
    return {"good": good, "improve": improve, "focus": focus}


_NUM = re.compile(r"\d[\d,.]*")


def _numbers(lines: dict) -> list[str]:
    text = " ".join(lines["good"] + lines["improve"] + [lines["focus"]])
    return sorted(n.rstrip(".,") for n in _NUM.findall(text))


def warmer(lines: dict, kind: str) -> tuple[dict, bool]:
    """The same lines, said more warmly by the AI — only if every number stayed exactly as it was (else as they were)."""
    from app.services.ai_client import complete_json
    prompt = (
        "את ויקי, העוזרת העסקית האישית של בעל עסק קטן בישראל. לפנייך " + ("הסיכום השבועי" if kind == "weekly" else "סיכום החודש")
        + " שלו, ב-JSON. נסחי כל שורה מחדש בעברית חמה, פשוטה וקצרה, בלשון נקבה, פונה אליו ישירות. "
        "אסור לשנות, להוסיף או להוריד אף מספר, אחוז או סכום, ואסור להוסיף עובדות. אותו מספר שורות בכל רשימה. "
        "החזירי רק JSON באותו מבנה: {\"good\": [...], \"improve\": [...], \"focus\": \"...\"}.\n"
        + json.dumps(lines, ensure_ascii=False))
    out = complete_json(prompt, max_tokens=700)
    try:
        said = {"good": [str(x).strip() for x in out["good"]], "improve": [str(x).strip() for x in out["improve"]],
                "focus": str(out["focus"]).strip()}
    except (TypeError, KeyError):
        return lines, False
    same_shape = len(said["good"]) == len(lines["good"]) and len(said["improve"]) == len(lines["improve"]) and said["focus"]
    if not same_shape or _numbers(said) != _numbers(lines) or not all(re.search("[א-ת]", x) for x in said["good"] + said["improve"] + [said["focus"]]):
        return lines, False
    return said, True


def _active_studios(db: Session, now: datetime) -> list:
    from app.core.features import has_module
    from app.models.studio import Studio
    rows = db.scalars(select(Studio).where(Studio.is_active.is_(True), Studio.is_platform.is_(False),
                                           Studio.deletion_requested_at.is_(None))).all()
    return [s for s in rows if (s.plan_expires_at is None or s.plan_expires_at > now) and has_module(db, s.id, "ai_assistant")]


def _save_and_tell(db: Session, studio_id, kind: str, period: str, lines: dict, facts: dict, by_ai: bool) -> None:
    from app.crud.push import enqueue_push_to_studio_admins
    from app.models.notification import Notification
    from app.models.viki_summary import VikiSummary
    db.add(VikiSummary(studio_id=studio_id, kind=kind, period=period, good=json.dumps(lines["good"], ensure_ascii=False),
                       improve=json.dumps(lines["improve"], ensure_ascii=False), focus=lines["focus"],
                       facts=json.dumps(facts, ensure_ascii=False, default=float), by_ai=by_ai))
    title = "ויקי: הסיכום השבועי שלך מוכן" if kind == "weekly" else "ויקי: סיכום החודש מוכן"
    body = "מה הלך טוב, מה לשפר — והמטרה " + ("לשבוע" if kind == "weekly" else "לחודש החדש")
    key = f"viki_summary:{kind}:{period}"
    db.add(Notification(studio_id=studio_id, type="viki_summary", title=title, body=body, action_url="/dashboard#viki", dedup_key=key))
    db.commit()
    try:
        enqueue_push_to_studio_admins(db, studio_id, title=title, body=body, deep_link="/dashboard#viki", reminder_type="viki_summary")
    except Exception as e:
        log.warning("viki summary push failed for %s: %s", studio_id, e)


def sweep(db: Session, now: datetime | None = None, use_ai: bool = True) -> int:
    """Hourly: from 9:00 on Sunday — last week's summary; from 9:00 on the 1st — last month's. Once per business and
    period; a business with nothing to say yet gets none."""
    from app.models.viki_summary import VikiSummary
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(IL)
    if local.hour < HOUR:
        return 0
    today = local.date()
    jobs: list[tuple[str, str]] = []
    if (today.weekday() + 1) % 7 == 0:                          # Sunday
        jobs.append(("weekly", (today - timedelta(days=7)).isoformat()))
    if today.day == 1:
        last = today - timedelta(days=1)
        jobs.append(("monthly", f"{last:%Y-%m}"))
    if not jobs:
        return 0
    made = 0
    for studio in _active_studios(db, now):
        for kind, period in jobs:
            if db.scalar(select(VikiSummary.id).where(VikiSummary.studio_id == studio.id, VikiSummary.kind == kind,
                                                      VikiSummary.period == period)):
                continue
            try:
                if kind == "weekly":
                    facts = week_facts(db, studio.id, date.fromisoformat(period))
                    lines = week_lines(facts)
                else:
                    y, m = map(int, period.split("-"))
                    facts = month_facts(db, studio.id, y, m)
                    lines = month_lines(facts)
                if lines is None:
                    continue
                lines, by_ai = warmer(lines, kind) if use_ai else (lines, False)
                _save_and_tell(db, studio.id, kind, period, lines, facts, by_ai)
                made += 1
            except Exception as e:
                db.rollback()
                log.exception("viki summary %s %s failed for %s: %s", kind, period, studio.id, e)
    return made


def _ltr(text: str) -> str:
    """A date range kept left to right inside a Hebrew line ("11/10–17/10" showed as "17/10–11/10")."""
    return f"\u2066{text}\u2069"


def latest(db: Session, studio_id, now: datetime | None = None, lang: str = "he") -> dict | None:
    """The summary on לוח בקרה: last week's (made on Sunday) or, in the month's first week, last month's — worked out
    from the data every time it is shown (2026-10-24: "the week is only 4% full" stayed on after the owner filled the
    calendar). The period's numbers as they are now, the week ahead as it is now; the saved lines only when the numbers
    can't be read."""
    from app.models.viki_summary import VikiSummary
    now = now or datetime.now(timezone.utc)
    row = db.scalars(select(VikiSummary).where(VikiSummary.studio_id == studio_id,
                                               VikiSummary.created_at >= now - timedelta(days=7))
                     .order_by(VikiSummary.created_at.desc())).first()
    if row is None:
        return None
    en = lang == "en"
    try:
        if row.kind == "weekly":
            start = date.fromisoformat(row.period)
            facts = week_facts(db, studio_id, start)
            lines = (week_lines_en if en else week_lines)(facts)
            title = (f"The week of {start:%d/%m}–{start + timedelta(days=6):%d/%m}" if en else
                     f"הסיכום של שבוע {_ltr(f'{start:%d/%m}–{start + timedelta(days=6):%d/%m}')}")
        else:
            y, m = map(int, row.period.split("-"))
            facts = month_facts(db, studio_id, y, m)
            lines = (month_lines_en if en else month_lines)(facts)
            title = f"{MONTHS_EN[m - 1]} {y}" if en else f"סיכום {MONTHS[m - 1]} {y}"
    except Exception as e:                               # the numbers can't be read now — what was saved
        log.warning("viki summary live facts failed for %s: %s", studio_id, e)
        db.rollback()
        lines, title = None, ""
    if lines:
        return {"kind": row.kind, "period": row.period, "title": title, **lines}
    if row.kind == "weekly":
        start = date.fromisoformat(row.period)
        title = f"הסיכום של שבוע {_ltr(f'{start:%d/%m}–{start + timedelta(days=6):%d/%m}')}"
    else:
        y, m = map(int, row.period.split("-"))
        title = f"סיכום {MONTHS[m - 1]} {y}"
    return {"kind": row.kind, "period": row.period, "title": title, "good": json.loads(row.good),
            "improve": json.loads(row.improve), "focus": row.focus}


def ahead(db: Session, studio_id, now: datetime | None = None, lang: str = "he") -> dict | None:
    """From Thursday to Saturday: next week and the one after, as the calendar stands now — how full, how many
    appointments, how many still wait for a deposit (the facts; the nudge to fill a week is ויקי's suggestion, with its
    button) (the owner, 2026-10-24: "towards the end of the week she should
    tell me about next week, or the week after"). None on the other days, or with nothing booked and nothing to say."""
    from app.api.dashboard_routes import calendar_fill
    from app.models.appointment import Appointment
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(IL).date()
    sunday_based = (today.weekday() + 1) % 7                 # 0 = Sunday … 6 = Saturday
    if sunday_based < 4:                                     # Sunday–Wednesday: the week has just begun
        return None
    en = lang == "en"
    next_sunday = today + timedelta(days=7 - sunday_based)
    lines = []
    for i, start in enumerate((next_sunday, next_sunday + timedelta(days=7))):
        end = start + timedelta(days=7)
        fill = calendar_fill(db, studio_id, start, end)
        waiting = db.scalar(select(func.count(Appointment.id)).where(
            Appointment.studio_id == studio_id, Appointment.status == "scheduled",
            Appointment.starts_at >= _utc(start), Appointment.starts_at < _utc(end),
            Appointment.deposit_amount_cents > 0, Appointment.payment_verified_at.is_(None))) or 0
        span = f"{start:%d/%m}–{end - timedelta(days=1):%d/%m}"
        if en:
            line = (f"{'Next week' if i == 0 else 'The week after'} ({span}): {fill['count']} appointments, "
                    f"the calendar is {fill['percent']}% full.")
            if waiting:
                line += f" {waiting} still waiting for a deposit."
        else:
            line = (f"{'השבוע הבא' if i == 0 else 'השבוע שאחריו'} ({_ltr(span)}): {fill['count']} תורים, "
                    f"היומן מלא ב-{fill['percent']}%.")
            if waiting:
                line += f" {waiting} עוד מחכים למקדמה."
        lines.append(line)
    return {"title": "The weeks ahead" if en else "השבועות הבאים", "lines": lines}
