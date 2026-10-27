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


def _h(minutes: float) -> str:
    """Hours, to the half hour: 14, 14.5."""
    return f"{round(minutes / 30) / 2:g}"


def fill_words(count: int, booked_min: float, work_min: float, en: bool = False) -> str:
    """How full a week is, in numbers and not only a percentage (the owner, 2026-10-24): "9 תורים — 14 שעות תפוסות
    מתוך 38 שעות עבודה"."""
    if en:
        if not count:
            return f"no appointments yet — {_h(work_min)} working hours free"
        return f"{count} appointment{'' if count == 1 else 's'} — {_h(booked_min)} of {_h(work_min)} working hours booked"
    if not count:
        return f"אין עדיין תורים — {_h(work_min)} שעות עבודה פנויות"
    return f"{'תור אחד' if count == 1 else f'{count} תורים'} — {_h(booked_min)} שעות תפוסות מתוך {_h(work_min)} שעות עבודה"


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
    ahead_fill = calendar_fill(db, studio_id, end, end + timedelta(days=7))
    return {
        "revenue": _revenue(db, studio_id, week_start, end), "revenue_before": _revenue(db, studio_id, prev, week_start),
        "appointments": _appointments(db, studio_id, week_start, end),
        "appointments_before": _appointments(db, studio_id, prev, week_start),
        "first_timers": _first_timers(db, studio_id, week_start, end),
        "no_shows": _appointments(db, studio_id, week_start, end, status="no_show"),
        "fill_ahead": ahead_fill["percent"], "fill_ahead_count": ahead_fill["count"],
        "fill_ahead_booked_min": ahead_fill["booked_minutes"], "fill_ahead_work_min": ahead_fill["total_minutes"],
        "goal": target, "goal_projected": projected, "goal_days_elapsed": prog["days_elapsed"],
        "goal_current": float(prog["current_revenue"]),
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
    # every percentage with the numbers it comes from (the owner, 2026-10-24: "not only percentages — 6 against how many")
    was = f"לעומת {_ils(f['revenue_before'])} בשבוע שלפניו"
    _compare(good, improve, f["revenue"], f["revenue_before"],
             f"ההכנסות בשבוע שעבר: {_ils(f['revenue'])}, {was} — {{change}}% יותר.",
             f"ההכנסות בשבוע שעבר: {_ils(f['revenue'])}, {was} — {{change}}% פחות.")
    was = f"לעומת {f['appointments_before']} בשבוע שלפניו"
    _compare(good, improve, f["appointments"], f["appointments_before"],
             f"{f['appointments']} תורים בשבוע שעבר, {was} — {{change}}% יותר.",
             f"{f['appointments']} תורים בשבוע שעבר, {was} — {{change}}% פחות.")
    if f["first_timers"]:
        good.append("לקוח חדש אחד הגיע בפעם הראשונה." if f["first_timers"] == 1 else f"{f['first_timers']} לקוחות חדשים הגיעו בפעם הראשונה.")
    if f["no_shows"] >= 2:
        improve.append(f"{f['no_shows']} לקוחות לא הגיעו לתור — מקדמה או תזכורת נוספת לפני התור יעזרו.")
    elif f["appointments"] >= 5 and not f["no_shows"]:
        good.append("אף לקוח לא הבריז בשבוע שעבר.")              # the summary is of last week, not this one
    behind = f["goal"] > 0 and f["goal_days_elapsed"] >= 3 and f["goal_projected"] < f["goal"] * 0.95
    if f["goal"] > 0 and f["goal_days_elapsed"] >= 3:
        pct = round(f["goal_projected"] / f["goal"] * 100)
        if behind:
            improve.append(f"עד עכשיו החודש: {_ils(f['goal_current'])} מתוך יעד של {_ils(f['goal'])}. בקצב הנוכחי הוא ייסגר "
                           f"בערך ב-{_ils(f['goal_projected'])} ({pct}% מהיעד) — חסרים עוד {_ils(f['goal_missing'])}.")
        else:
            good.append(f"אתה בקצב ליעד החודש: עד עכשיו {_ils(f['goal_current'])}, ובקצב הזה הוא ייסגר בערך "
                        f"ב-{_ils(f['goal_projected'])} מתוך {_ils(f['goal'])} ({pct}%).")
    if f["fill_ahead"] < 40:
        improve.append(f"השבוע מלא רק ב-{f['fill_ahead']}%: "
                       f"{fill_words(f['fill_ahead_count'], f['fill_ahead_booked_min'], f['fill_ahead_work_min'])}.")

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
    prev = MONTHS[(f["month"] - 2) % 12]
    good: list[str] = []
    improve: list[str] = []
    if f["goal"] > 0:
        pct = round(f["revenue"] / f["goal"] * 100)
        if f["revenue"] >= f["goal"]:
            good.append(f"הגעת ליעד של {name}: {_ils(f['revenue'])} מתוך {_ils(f['goal'])} — {pct}%.")
        else:
            improve.append(f"{name} נסגר ב-{_ils(f['revenue'])} — {pct}% מהיעד. חסרו {_ils(f['goal'] - f['revenue'])}.")
    was = f"לעומת {_ils(f['revenue_before'])} ב{prev}"
    _compare(good, improve, f["revenue"], f["revenue_before"],
             f"ההכנסות ב{name}: {_ils(f['revenue'])}, {was} — {{change}}% יותר.",
             f"ההכנסות ב{name}: {_ils(f['revenue'])}, {was} — {{change}}% פחות.")
    if f["revenue_year_ago"]:
        was = f"ב{name} בשנה שעברה: {_ils(f['revenue_year_ago'])}"
        _compare(good, improve, f["revenue"], f["revenue_year_ago"],
                 f"{was} — השנה {{change}}% יותר.", f"{was} — השנה {{change}}% פחות.")
    was = f"לעומת {f['appointments_before']} ב{prev}"
    _compare(good, improve, f["appointments"], f["appointments_before"],
             f"{f['appointments']} תורים ב{name}, {was} — {{change}}% יותר.",
             f"{f['appointments']} תורים ב{name}, {was} — {{change}}% פחות.")
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
    was = f"against {_ils(f['revenue_before'])} the week before"
    _compare(good, improve, f["revenue"], f["revenue_before"],
             f"Revenue last week: {_ils(f['revenue'])}, {was} — {{change}}% more.",
             f"Revenue last week: {_ils(f['revenue'])}, {was} — {{change}}% less.")
    was = f"against {f['appointments_before']} the week before"
    _compare(good, improve, f["appointments"], f["appointments_before"],
             f"{f['appointments']} appointments last week, {was} — {{change}}% more.",
             f"{f['appointments']} appointments last week, {was} — {{change}}% less.")
    if f["first_timers"]:
        good.append("One new client came for the first time." if f["first_timers"] == 1
                    else f"{f['first_timers']} new clients came for the first time.")
    if f["no_shows"] >= 2:
        improve.append(f"{f['no_shows']} clients didn't show up — a deposit or another reminder before the appointment will help.")
    elif f["appointments"] >= 5 and not f["no_shows"]:
        good.append("No client missed an appointment last week.")
    behind = f["goal"] > 0 and f["goal_days_elapsed"] >= 3 and f["goal_projected"] < f["goal"] * 0.95
    if f["goal"] > 0 and f["goal_days_elapsed"] >= 3:
        pct = round(f["goal_projected"] / f["goal"] * 100)
        if behind:
            improve.append(f"So far this month: {_ils(f['goal_current'])} of a {_ils(f['goal'])} goal. At this pace it will "
                           f"close at about {_ils(f['goal_projected'])} ({pct}% of the goal) — {_ils(f['goal_missing'])} still to go.")
        else:
            good.append(f"You're on pace for this month's goal: {_ils(f['goal_current'])} so far, and at this pace about "
                        f"{_ils(f['goal_projected'])} of {_ils(f['goal'])} ({pct}%).")
    if f["fill_ahead"] < 40:
        improve.append(f"This week is only {f['fill_ahead']}% full: "
                       f"{fill_words(f['fill_ahead_count'], f['fill_ahead_booked_min'], f['fill_ahead_work_min'], en=True)}.")
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
    prev = MONTHS_EN[(f["month"] - 2) % 12]
    good: list[str] = []
    improve: list[str] = []
    if f["goal"] > 0:
        pct = round(f["revenue"] / f["goal"] * 100)
        if f["revenue"] >= f["goal"]:
            good.append(f"You reached {name}'s goal: {_ils(f['revenue'])} of {_ils(f['goal'])} — {pct}%.")
        else:
            improve.append(f"{name} closed at {_ils(f['revenue'])} — {pct}% of the goal. {_ils(f['goal'] - f['revenue'])} short.")
    was = f"against {_ils(f['revenue_before'])} in {prev}"
    _compare(good, improve, f["revenue"], f["revenue_before"],
             f"Revenue in {name}: {_ils(f['revenue'])}, {was} — {{change}}% more.",
             f"Revenue in {name}: {_ils(f['revenue'])}, {was} — {{change}}% less.")
    if f["revenue_year_ago"]:
        was = f"{name} last year: {_ils(f['revenue_year_ago'])}"
        _compare(good, improve, f["revenue"], f["revenue_year_ago"],
                 f"{was} — this year {{change}}% more.", f"{was} — this year {{change}}% less.")
    was = f"against {f['appointments_before']} in {prev}"
    _compare(good, improve, f["appointments"], f["appointments_before"],
             f"{f['appointments']} appointments in {name}, {was} — {{change}}% more.",
             f"{f['appointments']} appointments in {name}, {was} — {{change}}% less.")
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
        words = fill_words(fill["count"], fill["booked_minutes"], fill["total_minutes"], en=en)
        if en:
            line = f"{'Next week' if i == 0 else 'The week after'} ({span}): {words} ({fill['percent']}% full)."
            if waiting:
                line += f" {waiting} still waiting for a deposit."
        else:
            line = f"{'השבוע הבא' if i == 0 else 'השבוע שאחריו'} ({_ltr(span)}): {words} (היומן מלא ב-{fill['percent']}%)."
            if waiting:
                line += " תור אחד עוד מחכה למקדמה." if waiting == 1 else f" {waiting} תורים עוד מחכים למקדמה."
        lines.append(line)
    return {"title": "The weeks ahead" if en else "השבועות הבאים", "lines": lines}


def _appts(n: int, en: bool) -> str:
    if en:
        return f"{n} appointment{'' if n == 1 else 's'}"
    return "תור אחד" if n == 1 else f"{n} תורים"


def _days(n: int, en: bool) -> str:
    if en:
        return f"{n} working day{'' if n == 1 else 's'}"
    return "יום עבודה אחד" if n == 1 else f"{n} ימי עבודה"


def this_week(db: Session, studio_id, now: datetime | None = None, lang: str = "he") -> dict | None:
    """The week we're in (the owner, 2026-10-27: "focus on what was done and what will be done this week — and a bit
    towards next week"): what came in so far and from how many appointments, against the same point last week; what's
    still in the calendar this week and the hours still free; this week's step towards the month's goal, gradually
    (what's left, per working day, and what that means for the days left this week); and, Sunday to Wednesday, next
    week (from Thursday "השבועות הבאים" says it). Worked out from the data every time it's shown. None while the week
    has nothing in it. Lines: {kind: done | ahead | goal | next, text}."""
    from app.api.dashboard_routes import calendar_fill
    from app.models.appointment import Appointment
    from app.repositories.goal_repository import GoalRepository
    now = now or datetime.now(timezone.utc)
    en = lang == "en"
    today = now.astimezone(IL).date()
    day_no = (today.weekday() + 1) % 7                       # 0 = Sunday … 6 = Saturday
    sunday = today - timedelta(days=day_no)
    next_sunday = sunday + timedelta(days=7)
    tomorrow = today + timedelta(days=1)

    so_far = _revenue(db, studio_id, sunday, tomorrow)
    last_point = _revenue(db, studio_id, sunday - timedelta(days=7), tomorrow - timedelta(days=7))
    done = db.scalar(select(func.count(Appointment.id)).where(
        Appointment.studio_id == studio_id, Appointment.status.notin_(("canceled", "no_show")),
        Appointment.starts_at >= _utc(sunday), Appointment.starts_at < now)) or 0
    left_n, left_sec = db.execute(select(
        func.count(Appointment.id),
        func.coalesce(func.sum(func.extract("epoch", Appointment.ends_at - Appointment.starts_at)), 0)).where(
        Appointment.studio_id == studio_id, Appointment.status == "scheduled",
        Appointment.starts_at >= now, Appointment.starts_at < _utc(next_sunday))).one()
    rest = calendar_fill(db, studio_id, tomorrow, next_sunday) if tomorrow < next_sunday else None
    if not (so_far or done or left_n):
        return None
    lines: list[dict] = []

    # what was done
    if en:
        text = f"So far this week: {_ils(so_far)} came in" + (f" from {_appts(done, en)}" if done else "")
        text += f", against {_ils(last_point)} by the same day last week." if last_point else "."
    else:
        text = f"עד עכשיו השבוע: {_ils(so_far)} הכנסות" + ((" מתור אחד" if done == 1 else f" מ-{done} תורים") if done else "")
        text += f", לעומת {_ils(last_point)} עד אותו יום בשבוע שעבר." if last_point else "."
    lines.append({"kind": "done", "text": text})

    # what's still ahead this week
    free = max(0, rest["total_minutes"] - rest["booked_minutes"]) if rest else 0
    if left_n:
        hours = _h(float(left_sec) / 60)
        if en:
            text = f"Still this week: {_appts(left_n, en)} — {hours} hours" + (f", and {_h(free)} hours still free in the days left." if free else ".")
        else:
            text = f"עוד השבוע: {_appts(left_n, en)} — {hours} שעות" + (f", ועוד {_h(free)} שעות פנויות בימים שנשארו." if free else ".")
        lines.append({"kind": "ahead", "text": text})
    elif free:
        lines.append({"kind": "ahead", "text": f"No more appointments this week — {_h(free)} working hours free in the days left." if en
                      else f"אין עוד תורים השבוע — {_h(free)} שעות עבודה פנויות בימים שנשארו."})

    # this week's step towards the month's goal — what's left, spread over the working days left
    prog = GoalRepository(db).get_progress(studio_id, today.year, today.month)
    target, current = float(prog["target_amount"]), float(prog["current_revenue"])
    if target > 0 and current >= target:
        lines.append({"kind": "goal", "text": f"You passed this month's goal: {_ils(current)} of {_ils(target)}." if en
                      else f"עברת את יעד החודש: {_ils(current)} מתוך {_ils(target)}."})
    elif target > 0 and prog["days_remaining"] > 0:
        left = target - current
        per_day = left / prog["days_remaining"]
        worked_today = any(r["day"] == today.day and float(r["amount"]) > 0 for r in prog["daily_revenue"])
        # the working days left this week in this month — today too until money came in today (as the goal counts)
        rest_of_week = [sunday + timedelta(days=i) for i in range(day_no, 7)]
        week_days = sum(1 for d in rest_of_week if d.month == today.month and (d.weekday() + 1) % 7 in prog["work_days"]
                        and (d > today or not worked_today))
        all_this_week = week_days >= prog["days_remaining"]       # the month ends this week — one step, not two
        if en:
            text = (f"Towards this month's goal ({_ils(target)}): {_ils(left)} to go in {_days(prog['days_remaining'], en)}"
                    + (" (all of them this week)" if all_this_week else "") + f" — about {_ils(per_day)} a day")
            text += f", so {_ils(per_day * week_days)} in the days left this week." if week_days and not all_this_week else "."
        else:
            text = (f"לקראת יעד החודש ({_ils(target)}): נשארו {_ils(left)} ב-{_days(prog['days_remaining'], en)}"
                    + (" (כולם השבוע)" if all_this_week else "") + f" — בערך {_ils(per_day)} ליום")
            text += f", כלומר {_ils(per_day * week_days)} בימים שנשארו השבוע." if week_days and not all_this_week else "."
        lines.append({"kind": "goal", "text": text})

    # a bit towards next week — Sunday to Wednesday (from Thursday "השבועות הבאים" says it)
    if day_no < 4:
        nxt = calendar_fill(db, studio_id, next_sunday, next_sunday + timedelta(days=7))
        span = f"{next_sunday:%d/%m}–{next_sunday + timedelta(days=6):%d/%m}"
        words = fill_words(nxt["count"], nxt["booked_minutes"], nxt["total_minutes"], en=en)
        lines.append({"kind": "next", "text": f"Next week ({span}): {words} ({nxt['percent']}% full)." if en
                      else f"ולקראת השבוע הבא ({_ltr(span)}): {words} (היומן מלא ב-{nxt['percent']}%)."})

    span = f"{sunday:%d/%m}–{sunday + timedelta(days=6):%d/%m}"
    return {"title": f"This week ({span})" if en else f"השבוע הזה ({_ltr(span)})", "lines": lines}
