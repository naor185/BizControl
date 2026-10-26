"""ויקי's summaries (the owner's vision, 2026-10-10/16): the week on Sunday from 9:00, the month on the 1st — what went
well, what to improve, the goal ahead — from the system's own numbers; the AI may only say them more warmly, never
change a number; once per business and period; the bell says it's ready without amounts. Local test database; nothing
is sent."""
from datetime import date, datetime, time, timedelta, timezone

import pytz
from sqlalchemy import select

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.notification import Notification
from app.models.pos_transaction import PosTransaction
from app.models.studio import Studio
from app.models.viki_summary import VikiSummary
from app.services import viki_summary
from tests.conftest import register_and_login

IL = pytz.timezone("Asia/Jerusalem")


def _at(d: date, hh: int) -> datetime:
    return IL.localize(datetime.combine(d, time(hh))).astimezone(timezone.utc)


def _sunday() -> date:
    today = datetime.now(IL).date()
    return today - timedelta(days=(today.weekday() + 1) % 7)


def test_the_weekly_summary_from_the_numbers_once(client, db_session):
    h = register_and_login(client, "sum-shop", "owner@sum-shop.com")
    studio = db_session.scalar(select(Studio).where(Studio.slug == "sum-shop"))
    studio.subscription_plan = "pro"                 # ויקי is in every plan sold ("כלי AI"), not the old free one
    db_session.commit()
    owner_id = client.get("/api/auth/me", headers=h).json()["id"]
    sunday = _sunday()
    last, before = sunday - timedelta(days=7), sunday - timedelta(days=14)
    db_session.add(PosTransaction(studio_id=studio.id, total_cents=100000, created_at=_at(last + timedelta(days=1), 12)))
    db_session.add(PosTransaction(studio_id=studio.id, total_cents=50000, created_at=_at(before + timedelta(days=1), 12)))
    for i, day in enumerate((last + timedelta(days=1), last + timedelta(days=2), last + timedelta(days=3), before + timedelta(days=2))):
        c = Client(studio_id=studio.id, full_name=f"לקוחה {i}", phone=f"05000001{i:02d}")
        db_session.add(c)
        db_session.flush()
        db_session.add(Appointment(studio_id=studio.id, client_id=c.id, artist_id=owner_id, title="קעקוע", status="done",
                                   starts_at=_at(day, 11), ends_at=_at(day, 12)))
    db_session.commit()

    assert viki_summary.sweep(db_session, now=_at(sunday, 8), use_ai=False) == 0           # before 9:00
    assert viki_summary.sweep(db_session, now=_at(sunday + timedelta(days=1), 10), use_ai=False) == 0   # not Sunday
    assert viki_summary.sweep(db_session, now=_at(sunday, 10), use_ai=False) >= 1
    assert viki_summary.sweep(db_session, now=_at(sunday, 11), use_ai=False) == 0          # once

    row = db_session.scalar(select(VikiSummary).where(VikiSummary.studio_id == studio.id, VikiSummary.kind == "weekly"))
    assert row.period == last.isoformat()
    shown = viki_summary.latest(db_session, studio.id)
    # every percentage with its numbers (the owner, 2026-10-24: "not only percentages — 6 against how many")
    assert shown["good"][:3] == ["ההכנסות בשבוע שעבר: ₪1,000, לעומת ₪500 בשבוע שלפניו — 100% יותר.",
                                 "3 תורים בשבוע שעבר, לעומת 1 בשבוע שלפניו — 200% יותר.",
                                 "3 לקוחות חדשים הגיעו בפעם הראשונה."]
    assert shown["focus"].startswith("המטרה השבוע:")
    [n] = db_session.scalars(select(Notification).where(Notification.studio_id == studio.id, Notification.type == "viki_summary")).all()
    assert n.title == "ויקי: הסיכום השבועי שלך מוכן" and "₪" not in n.body                 # the bell: no amounts

    r = client.get("/api/viki", headers=h).json()
    assert r["summary"]["kind"] == "weekly" and r["summary"]["good"] == shown["good"]
    en = client.get("/api/viki", headers={**h, "X-Lang": "en"}).json()["summary"]
    assert en["good"][0] == "Revenue last week: ₪1,000, against ₪500 the week before — 100% more." and en["title"].startswith("The week of")


def test_the_monthly_summary_against_the_goal(client, db_session):
    h = register_and_login(client, "sum-month", "owner@sum-month.com")
    studio = db_session.scalar(select(Studio).where(Studio.slug == "sum-month"))
    studio.subscription_plan = "pro"                 # ויקי is in every plan sold ("כלי AI"), not the old free one
    db_session.commit()
    first = datetime.now(IL).date().replace(day=1)
    last_month = (first - timedelta(days=1)).replace(day=1)
    assert client.post(f"/api/goals/?year={last_month.year}&month={last_month.month}", headers=h,
                       json={"target_amount": 1000}).status_code == 200
    db_session.add(PosTransaction(studio_id=studio.id, total_cents=120000, created_at=_at(last_month + timedelta(days=4), 12)))
    db_session.commit()

    assert viki_summary.sweep(db_session, now=_at(first, 10), use_ai=False) >= 1
    row = db_session.scalar(select(VikiSummary).where(VikiSummary.studio_id == studio.id, VikiSummary.kind == "monthly"))
    assert row.period == f"{last_month:%Y-%m}"
    name = viki_summary.MONTHS[last_month.month - 1]
    assert f"הגעת ליעד של {name}: ₪1,200 מתוך ₪1,000 — 120%." in row.good
    assert row.focus.startswith("המטרה לחודש החדש: לשמור על מה שעבד")


def test_the_ai_may_only_say_it_more_warmly(monkeypatch):
    lines = {"good": ["ההכנסות בשבוע שעבר: ₪1,000 — 100% יותר מהשבוע שלפניו."], "improve": ["השבוע מלא רק ב-20%."],
             "focus": "המטרה השבוע: למלא את היומן."}
    import app.services.ai_client as ai
    monkeypatch.setattr(ai, "complete_json", lambda prompt, max_tokens=0: {
        "good": ["איזה שבוע! הכנסת ₪1,000 — 100% יותר מהשבוע שלפניו."], "improve": ["היומן מלא רק ב-20% השבוע."],
        "focus": "בואו נמלא את היומן השבוע!"})
    said, by_ai = viki_summary.warmer(lines, "weekly")
    assert by_ai and said["good"][0].startswith("איזה שבוע")
    monkeypatch.setattr(ai, "complete_json", lambda prompt, max_tokens=0: {
        "good": ["איזה שבוע! הכנסת ₪1,200."], "improve": ["היומן מלא רק ב-20% השבוע."], "focus": "קדימה!"})
    said, by_ai = viki_summary.warmer(lines, "weekly")                                     # a number changed — not taken
    assert not by_ai and said == lines
    monkeypatch.setattr(ai, "complete_json", lambda prompt, max_tokens=0: None)            # no AI — as they were
    assert viki_summary.warmer(lines, "weekly") == (lines, False)


def test_the_summary_in_english_from_the_same_numbers():
    """The owner, 2026-10-20: the whole system in English — the summary is rebuilt from the saved numbers."""
    f = {"revenue": 1000.0, "revenue_before": 500.0, "appointments": 3, "appointments_before": 1, "first_timers": 3,
         "no_shows": 0, "fill_ahead": 30, "fill_ahead_count": 4, "fill_ahead_booked_min": 690, "fill_ahead_work_min": 2400,
         "goal": 0.0, "goal_projected": 0.0, "goal_days_elapsed": 0, "goal_current": 0.0,
         "goal_missing": 0.0, "avg_appointment": 0.0, "lapsed": 0}
    lines = viki_summary.week_lines_en(f)
    assert lines["good"][:3] == ["Revenue last week: ₪1,000, against ₪500 the week before — 100% more.",
                                 "3 appointments last week, against 1 the week before — 200% more.",
                                 "3 new clients came for the first time."]
    assert lines["improve"] == ["This week is only 30% full: 4 appointments — 11.5 of 40 working hours booked."]
    assert lines["focus"].startswith("This week's goal:")
    he = viki_summary.week_lines(f)
    assert he["improve"] == ["השבוע מלא רק ב-30%: 4 תורים — 11.5 שעות תפוסות מתוך 40 שעות עבודה."]


def test_the_goal_line_says_the_amounts():
    """Behind the goal: how much so far, out of what, where the pace leads, and what's missing — not only a %."""
    f = {"revenue": 4898.0, "revenue_before": 21300.0, "appointments": 6, "appointments_before": 14, "first_timers": 0,
         "no_shows": 0, "fill_ahead": 60, "fill_ahead_count": 9, "fill_ahead_booked_min": 1500, "fill_ahead_work_min": 2400,
         "goal": 120000.0, "goal_projected": 87600.0, "goal_days_elapsed": 17, "goal_current": 86988.0,
         "goal_missing": 33012.0, "avg_appointment": 800.0, "lapsed": 0}
    he = viki_summary.week_lines(f)
    assert he["improve"] == [
        "ההכנסות בשבוע שעבר: ₪4,898, לעומת ₪21,300 בשבוע שלפניו — 77% פחות.",
        "6 תורים בשבוע שעבר, לעומת 14 בשבוע שלפניו — 57% פחות.",
        "עד עכשיו החודש: ₪86,988 מתוך יעד של ₪120,000. בקצב הנוכחי הוא ייסגר בערך ב-₪87,600 (73% מהיעד) — חסרים עוד ₪33,012."]


def test_a_refund_is_money_out_and_the_summary_follows_the_calendar(client, db_session):
    """The owner, 2026-10-24: ויקי said ₪5,898 for a ₪4,898 week (a refunded deposit counted as income), and "the week
    is only 4% full" stayed on after the calendar was filled. The summary is worked out every time it is shown."""
    from app.models.payment import Payment
    h = register_and_login(client, "live-shop", "owner@live-shop.com")
    studio = db_session.scalar(select(Studio).where(Studio.slug == "live-shop"))
    studio.subscription_plan = "pro"
    owner_id = client.get("/api/auth/me", headers=h).json()["id"]
    sunday = _sunday()
    last = sunday - timedelta(days=7)
    c = Client(studio_id=studio.id, full_name="דנה", phone="0500000999")
    db_session.add(c)
    db_session.flush()
    appt = Appointment(studio_id=studio.id, client_id=c.id, artist_id=owner_id, title="קעקוע", status="done",
                       starts_at=_at(last + timedelta(days=2), 11), ends_at=_at(last + timedelta(days=2), 12))
    db_session.add(appt)
    db_session.flush()
    for amount, kind in ((50000, "payment"), (50000, "deposit"), (50000, "refund")):        # ₪500 in, ₪500 back
        db_session.add(Payment(studio_id=studio.id, client_id=c.id, appointment_id=appt.id, amount_cents=amount,
                               currency="ILS", type=kind, status="paid", method="bit",
                               created_at=_at(last + timedelta(days=1), 12)))
    db_session.commit()
    assert viki_summary.week_facts(db_session, studio.id, last)["revenue"] == 500.0
    assert viki_summary.sweep(db_session, now=_at(sunday, 10), use_ai=False) >= 1
    before = viki_summary.week_facts(db_session, studio.id, last)["fill_ahead"]
    for d in range(1, 5):                                     # the owner fills this week after the summary was made
        db_session.add(Appointment(studio_id=studio.id, client_id=c.id, artist_id=owner_id, title="קעקוע",
                                   starts_at=_at(sunday + timedelta(days=d), 9), ends_at=_at(sunday + timedelta(days=d), 21)))
    db_session.commit()
    shown = viki_summary.latest(db_session, studio.id, now=_at(sunday, 11))
    after = viki_summary.week_facts(db_session, studio.id, last)["fill_ahead"]
    assert after > before and not any(f"מלא רק ב-{before}%" in line for line in shown["improve"])
    assert "\u2066" in shown["title"]                        # the date range stays left to right in Hebrew


def test_from_thursday_the_weeks_ahead(client, db_session):
    h = register_and_login(client, "ahead-shop", "owner@ahead-shop.com")
    studio = db_session.scalar(select(Studio).where(Studio.slug == "ahead-shop"))
    owner_id = client.get("/api/auth/me", headers=h).json()["id"]
    sunday = _sunday()
    c = Client(studio_id=studio.id, full_name="דנה", phone="0500000998")
    db_session.add(c)
    db_session.flush()
    nxt = sunday + timedelta(days=7)
    db_session.add(Appointment(studio_id=studio.id, client_id=c.id, artist_id=owner_id, title="קעקוע",
                               starts_at=_at(nxt + timedelta(days=1), 10), ends_at=_at(nxt + timedelta(days=1), 12),
                               deposit_amount_cents=20000))
    db_session.commit()
    assert viki_summary.ahead(db_session, studio.id, now=_at(sunday + timedelta(days=2), 10)) is None     # Tuesday
    got = viki_summary.ahead(db_session, studio.id, now=_at(sunday + timedelta(days=4), 10))             # Thursday
    assert got["title"] == "השבועות הבאים" and got["lines"][0].startswith("השבוע הבא")
    assert "תור אחד — 2 שעות תפוסות מתוך" in got["lines"][0] and "תור אחד עוד מחכה למקדמה" in got["lines"][0]
    assert "אין עדיין תורים" in got["lines"][1]
    en = viki_summary.ahead(db_session, studio.id, now=_at(sunday + timedelta(days=5), 10), lang="en")
    assert en["lines"][0].startswith("Next week") and en["lines"][1].startswith("The week after")
    assert "1 appointment — 2 of" in en["lines"][0]
