"""
Subscription expiry notices, and the daily sweep that moves subscriptions through
their time-based states.

A studio whose subscription is about to end (or just ended) is told everything that
follows from not renewing, in three places: an in-app notification (the bell), a push
to the owner/admins, and an email to the owner (copied to the platform admin). The
consequences listed are the real ones, see app/core/studio_access.py: the studio's
staff are locked out, its public site goes to the archive and it leaves BizFind
search, nothing is deleted, and it all comes back by itself on renewal.

Runs daily via APScheduler (main.py). Each notice is sent once per subscription end
date: a push job tagged with reminder_type is the marker that it went out.
"""
from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timezone, timedelta
from html import escape

import pytz
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.crud.push import enqueue_push_to_studio_admins
from app.models.message_job import MessageJob
from app.models.module import Plan
from app.models.notification import Notification
from app.models.studio import Studio
from app.models.subscription import Subscription
from app.models.user import User

logger = logging.getLogger(__name__)

# Days past current_period_end before each automatic transition fires.
# past_due→grace_period: still no payment a week after the failed renewal.
# grace_period→suspended: two weeks total with no payment — access blocked.
# canceled→expired / trial→expired: access ends right at period_end, no grace.
GRACE_PERIOD_AFTER_DAYS = 7
SUSPEND_AFTER_DAYS = 14

# Warning stages, in days before the end. Only the smallest stage that applies is sent, so a
# missed day or a fresh deploy never produces a burst of "7 days", "3 days" and "1 day" at once.
WARN_STAGES = (7, 3, 1)
# The "your access has ended" notice is still sent if the end passed up to this many days ago.
ENDED_WINDOW_DAYS = 3

PLATFORM_ADMIN_EMAIL = os.getenv("PLATFORM_ADMIN_EMAIL", "ncbilutattoo@gmail.com")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://biz-control.com")
# How a studio asks to renew today — the same details the /suspended page shows.
RENEWAL_WHATSAPP = "052-8518805"
RENEWAL_EMAIL = "ncbilutattoo@gmail.com"

_ISRAEL = pytz.timezone("Asia/Jerusalem")

# What not renewing means. Every line is enforced in code (studio_access.py, plan_enforcement.py):
# tense differs between the warning and the "already ended" notice, the facts are the same.
_CONSEQUENCES_FUTURE = (
    "המערכת — יומן, לקוחות, תשלומים והגדרות — תיחסם, ותוצג רק הודעה על סיום המנוי.",
    "אתר העסק יעבור לארכיון: דף הנחיתה, הזמנת תורים אונליין, רשימת ההמתנה, ההצטרפות למועדון וחנות כרטיסי המתנה "
    "יפסיקו לקבל לקוחות. מי שיכנס יראה שהעסק אינו זמין להזמנות.",
    "העסק יוסתר מהחיפוש ב-BizFind.",
    "שום דבר לא נמחק: הלקוחות, היומן, ההיסטוריה והתשלומים נשמרים.",
    "אחרי החידוש הכול חוזר לפעול מעצמו — הכניסה למערכת, האתר וקביעת התורים.",
)
_CONSEQUENCES_NOW = (
    "המערכת — יומן, לקוחות, תשלומים והגדרות — חסומה, ומוצגת רק הודעה על סיום המנוי.",
    "אתר העסק בארכיון: דף הנחיתה, הזמנת תורים אונליין, רשימת ההמתנה, ההצטרפות למועדון וחנות כרטיסי המתנה "
    "אינם מקבלים לקוחות. מי שנכנס רואה שהעסק אינו זמין להזמנות.",
    "העסק מוסתר מהחיפוש ב-BizFind.",
    "שום דבר לא נמחק: הלקוחות, היומן, ההיסטוריה והתשלומים נשמרים.",
    "ברגע שהמנוי יחודש הכול חוזר לפעול מעצמו — הכניסה למערכת, האתר וקביעת התורים.",
)


# ── When does access end, and which notice is due ────────────────────────────

def _access_end(studio: Studio, sub: Subscription | None) -> datetime | None:
    """The moment the studio's access stops: the earliest date the system enforces.
    plan_expires_at is enforced for everyone (auth_deps); a trial and a canceled
    subscription are also expired by the daily sweep on their own dates."""
    dates = [studio.plan_expires_at]
    if sub is not None:
        if sub.status == "trial":
            dates.append(sub.trial_ends_at)
        elif sub.status == "canceled":
            dates.append(sub.current_period_end)
    dates = [d for d in dates if d is not None]
    return min(dates) if dates else None


def _renews_automatically(sub: Subscription | None) -> bool:
    """A live card subscription renews by itself and the payment provider keeps the dates fresh,
    so there is nothing to warn about."""
    return bool(
        sub is not None
        and sub.status == "active"
        and sub.provider_subscription_id
        and sub.auto_renew
        and not sub.cancel_at_period_end
    )


def _pick_stage(end: datetime, now: datetime) -> str | None:
    if end <= now:
        return "ended" if now - end <= timedelta(days=ENDED_WINDOW_DAYS) else None
    remaining = end - now
    for days in sorted(WARN_STAGES):
        if remaining <= timedelta(days=days):
            return f"exp_{days}d"
    return None


def _already_sent(db: Session, studio_id, stage: str, end: datetime) -> bool:
    """Once per subscription end date. A warning belongs to the cycle that ends at `end`
    (it can only have been sent within the last max-stage days before it); 'ended' is
    sent after the end. Renewing moves `end`, which starts a fresh cycle."""
    since = end if stage == "ended" else end - timedelta(days=max(WARN_STAGES) + 1)
    return db.scalar(
        select(MessageJob.id).where(
            MessageJob.studio_id == studio_id,
            MessageJob.channel == "push",
            MessageJob.reminder_type == f"plan_{stage}",
            MessageJob.created_at >= since,
        ).limit(1)
    ) is not None


# ── Wording ──────────────────────────────────────────────────────────────────

def _days_text(days: int) -> str:
    return "יום אחד" if days == 1 else f"{days} ימים"


def _headline(stage: str, days_left: int, is_trial: bool) -> str:
    if stage == "ended":
        return "תקופת הניסיון הסתיימה — האתר הועבר לארכיון" if is_trial else "המנוי הסתיים — האתר הועבר לארכיון"
    what = "תקופת הניסיון מסתיימת" if is_trial else "המנוי יפוג"
    return f"{what} בעוד {_days_text(days_left)}"


def _short_body(stage: str, end_text: str) -> str:
    """Bell + push text: the consequences in one paragraph, the full list is in the email."""
    if stage == "ended":
        return (
            "המערכת חסומה, אתר העסק בארכיון והלקוחות לא יכולים לקבוע תור. הנתונים נשמרים והכול חוזר ברגע שמחדשים. "
            f"לחידוש: WhatsApp {RENEWAL_WHATSAPP}."
        )
    return (
        f"עד {end_text}. אם לא תחדשו: המערכת תיחסם, אתר העסק (הזמנת תורים, דף נחיתה, BizFind) יעבור לארכיון "
        "והלקוחות לא יוכלו לקבוע תור. הנתונים נשמרים והכול חוזר ברגע שמחדשים. "
        f"לחידוש: WhatsApp {RENEWAL_WHATSAPP}."
    )


def _studio_email_html(studio_name: str, plan_label: str, headline: str, stage: str, end_text: str) -> str:
    ended = stage == "ended"
    accent = "#b42318" if (ended or stage == "exp_1d") else "#b54708"
    lead = (
        f"האתר והמערכת של <strong>{escape(studio_name)}</strong> (תוכנית: {escape(plan_label)}) אינם פעילים מאז {end_text}. זה מה שקורה עכשיו:"
        if ended else
        f"המנוי של <strong>{escape(studio_name)}</strong> (תוכנית: {escape(plan_label)}) מסתיים ב-{end_text}. אם לא תחדשו עד אז, זה מה שיקרה:"
    )
    items = "".join(
        f'<li style="margin: 0 0 10px;">{escape(line)}</li>'
        for line in (_CONSEQUENCES_NOW if ended else _CONSEQUENCES_FUTURE)
    )
    return f"""
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;
         border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; color: #111;">
      <div style="background: #111; padding: 22px 30px;">
        <span style="color: #fff; font-size: 22px; font-weight: bold;">BizControl</span>
      </div>
      <div style="padding: 30px; background: #fafafa;">
        <h2 style="margin: 0 0 14px; color: {accent}; font-size: 21px;">{escape(headline)}</h2>
        <p style="color: #444; line-height: 1.7; margin: 0 0 16px;">שלום,<br>{lead}</p>
        <ul style="color: #333; line-height: 1.7; padding: 0 20px 0 0; margin: 0 0 22px;">{items}</ul>
        <div style="margin: 0 0 22px; padding: 14px 18px; border-radius: 8px;
             background: {accent}14; border-right: 4px solid {accent};">
          <strong>{'כדי להחזיר הכול לפעולה — מחדשים את המנוי:' if ended else 'כדי להמשיך ללא הפרעה — מחדשים את המנוי לפני שהוא מסתיים:'}</strong>
          <div style="margin-top: 6px; color: #444;">
            WhatsApp: {RENEWAL_WHATSAPP}<br>
            אימייל: <a href="mailto:{RENEWAL_EMAIL}" style="color: #111;">{RENEWAL_EMAIL}</a>
          </div>
        </div>
        <a href="{FRONTEND_URL}/overview?billing=plans"
           style="display: inline-block; background: #111; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: bold;">
          לצפייה במסלולים ובמנוי שלכם
        </a>
      </div>
      <div style="padding: 14px 30px; background: #f3f4f6; text-align: center; color: #9ca3af; font-size: 12px;">
        BizControl — מערכת ניהול עסק
      </div>
    </div>
    """


def _admin_email_html(studio: Studio, owner_email: str, plan_label: str, headline: str, end_text: str) -> str:
    rows = (
        ("עסק", studio.name), ("כתובת (slug)", studio.slug), ("בעלים", owner_email),
        ("תוכנית", plan_label), ("מועד סיום", end_text),
    )
    body = "".join(
        f'<tr><td style="padding: 6px 0; color: #555; width: 110px;">{label}</td><td><strong>{escape(str(value))}</strong></td></tr>'
        for label, value in rows
    )
    return f"""
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;
         border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; color: #111;">
      <h3 style="margin: 0 0 16px;">{escape(headline)}</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">{body}</table>
      <p style="margin-top: 16px; font-size: 13px; color: #6b7280;">
        לחידוש: פאנל הניהול ← טאב סטודיואים ← הארך. ההארכה מחזירה את הגישה למערכת ופותחת מחדש גם את האתר.
      </p>
    </div>
    """


# ── Sending ──────────────────────────────────────────────────────────────────

def _notify_studio(
    db: Session, studio: Studio, sub: Subscription | None, stage: str, end: datetime, now: datetime, is_trial: bool,
) -> None:
    """Bell + push + email for one studio and one stage. Never raises."""
    owner = db.scalar(
        select(User).where(User.studio_id == studio.id, User.role == "owner", User.is_active == True)  # noqa: E712
    )
    if not owner:
        return  # nobody to tell; the push marker below would not exist either

    plan = db.get(Plan, sub.plan_id if sub else studio.subscription_plan)
    plan_label = plan.display_name if plan else (studio.subscription_plan or "")
    days_left = max(1, math.ceil((end - now).total_seconds() / 86400)) if end > now else 0
    end_text = end.astimezone(_ISRAEL).strftime("%d.%m.%Y")
    headline = _headline(stage, days_left, is_trial)
    short = _short_body(stage, end_text)

    if stage != "ended":
        # A locked-out studio can't open the app, so the bell is only for the warnings.
        try:
            db.add(Notification(
                studio_id=studio.id, type=f"plan_{stage}", title=headline, body=short,
                action_url="/overview?billing=plans",
            ))
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning("plan notice (bell) failed for %s: %s", studio.slug, e)

    # The push job is also the "already sent" marker, so it is created even if the email below fails.
    try:
        enqueue_push_to_studio_admins(
            db, studio.id, title=headline, body=short,
            deep_link="/suspended?reason=expired" if stage == "ended" else "/overview?billing=plans",
            reminder_type=f"plan_{stage}",
        )
    except Exception as e:
        db.rollback()
        logger.warning("plan notice (push) failed for %s: %s", studio.slug, e)

    try:
        from app.services.email_center import send_email
        send_email(
            db, to_email=owner.email, subject=f"BizControl — {headline}",
            html_content=_studio_email_html(studio.name, plan_label, headline, stage, end_text),
            studio_id=str(studio.id), template_key="plan_expiry", email_type="system", reply_to=RENEWAL_EMAIL,
        )
        send_email(
            db, to_email=PLATFORM_ADMIN_EMAIL, subject=f"[BizControl] {studio.name} — {headline}",
            html_content=_admin_email_html(studio, owner.email, plan_label, headline, end_text),
            studio_id=str(studio.id), template_key="plan_expiry_admin", email_type="system", reply_to=RENEWAL_EMAIL,
        )
    except Exception as e:
        logger.error("plan notice (email) failed for %s: %s", studio.slug, e)

    logger.info("plan notice %s sent for %s (ends %s)", stage, studio.slug, end_text)


def notify_access_ended(db: Session, studio: Studio | None, sub: Subscription, end: datetime | None, was_trial: bool) -> None:
    """For the transitions below: a studio just moved to expired/suspended, so tell it once (a no-op if the
    notice already went out for this end date). `end` and `was_trial` are read before the status flips,
    because once it is 'expired' the trial/period dates no longer say when access ended."""
    if studio is None or studio.is_platform or not studio.is_active or end is None:
        return
    if _already_sent(db, studio.id, "ended", end):
        return
    _notify_studio(db, studio, sub, "ended", end, datetime.now(timezone.utc), was_trial)


def sweep_plan_expiry_alerts(db: Session) -> None:
    """Called daily by APScheduler. Sends the warning (7/3/1 days before) or the "ended" notice
    to every studio that is due one and has not had it yet."""
    now = datetime.now(timezone.utc)
    lo = now - timedelta(days=ENDED_WINDOW_DAYS + 1)
    hi = now + timedelta(days=max(WARN_STAGES) + 1)

    def in_range(col):
        return and_(col.isnot(None), col >= lo, col <= hi)

    rows = db.execute(
        select(Studio, Subscription)
        .outerjoin(Subscription, Subscription.studio_id == Studio.id)
        .where(
            Studio.is_platform == False,  # noqa: E712
            Studio.is_active == True,  # noqa: E712
            or_(in_range(Studio.plan_expires_at), in_range(Subscription.trial_ends_at), in_range(Subscription.current_period_end)),
        )
    ).all()

    sent = 0
    for studio, sub in rows:
        try:
            if _renews_automatically(sub):
                continue
            end = _access_end(studio, sub)
            if end is None:
                continue
            stage = _pick_stage(end, now)
            if stage is None or _already_sent(db, studio.id, stage, end):
                continue
            _notify_studio(db, studio, sub, stage, end, now, is_trial=bool(sub is not None and sub.status == "trial"))
            sent += 1
        except Exception as exc:
            db.rollback()
            logger.error("plan expiry notice failed for %s: %s", studio.slug, exc)
    if sent:
        logger.info("sweep_plan_expiry_alerts: %d notice(s) sent", sent)


def sweep_subscription_transitions(db: Session) -> None:
    """
    Called daily by APScheduler, alongside sweep_plan_expiry_alerts(). The
    only place that advances a subscription automatically with the passage
    of time (as opposed to a webhook/admin action): canceled→expired,
    trial→expired, past_due→grace_period, grace_period→suspended. Routes
    every transition through apply_subscription_event() (source='system')
    so it's logged the same way as any other status change.
    """
    from app.core.billing import apply_subscription_event

    now = datetime.now(timezone.utc)

    def transition(sub: Subscription, event_type: str, notify: bool) -> None:
        studio = db.get(Studio, sub.studio_id)
        end = _access_end(studio, sub) if studio is not None else None
        was_trial = sub.status == "trial"
        apply_subscription_event(db, sub.studio_id, event_type, source="system")
        if notify:
            try:
                notify_access_ended(db, studio, sub, end, was_trial)
            except Exception as exc:
                db.rollback()
                logger.error("access-ended notice failed for studio %s: %s", sub.studio_id, exc)

    # canceled (cancel_at_period_end already passed) → expired
    canceled = db.scalars(
        select(Subscription).where(
            Subscription.status == "canceled",
            Subscription.current_period_end.isnot(None),
            Subscription.current_period_end < now,
        )
    ).all()
    for sub in canceled:
        transition(sub, "expired", notify=True)

    # trial past trial_ends_at with no payment → expired
    trials = db.scalars(
        select(Subscription).where(
            Subscription.status == "trial",
            Subscription.trial_ends_at.isnot(None),
            Subscription.trial_ends_at < now,
        )
    ).all()
    for sub in trials:
        transition(sub, "expired", notify=True)

    # past_due for too long → grace_period
    stuck_past_due = db.scalars(
        select(Subscription).where(
            Subscription.status == "past_due",
            Subscription.current_period_end.isnot(None),
            Subscription.current_period_end < now - timedelta(days=GRACE_PERIOD_AFTER_DAYS),
        )
    ).all()
    for sub in stuck_past_due:
        transition(sub, "grace_period_started", notify=False)

    # grace_period for too long → suspended
    stuck_grace = db.scalars(
        select(Subscription).where(
            Subscription.status == "grace_period",
            Subscription.current_period_end.isnot(None),
            Subscription.current_period_end < now - timedelta(days=SUSPEND_AFTER_DAYS),
        )
    ).all()
    for sub in stuck_grace:
        transition(sub, "suspended", notify=True)

    if canceled or trials or stuck_past_due or stuck_grace:
        logger.info(
            "sweep_subscription_transitions: expired=%d(canceled)+%d(trial) grace_period=%d suspended=%d",
            len(canceled), len(trials), len(stuck_past_due), len(stuck_grace),
        )
