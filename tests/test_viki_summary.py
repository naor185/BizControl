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
    assert shown["good"][:3] == ["ההכנסות בשבוע שעבר: ₪1,000 — 100% יותר מהשבוע שלפניו.",
                                 "3 תורים — 200% יותר מהשבוע שלפניו.",
                                 "3 לקוחות חדשים הגיעו בפעם הראשונה."]
    assert shown["focus"].startswith("המטרה השבוע:")
    [n] = db_session.scalars(select(Notification).where(Notification.studio_id == studio.id, Notification.type == "viki_summary")).all()
    assert n.title == "ויקי: הסיכום השבועי שלך מוכן" and "₪" not in n.body                 # the bell: no amounts

    r = client.get("/api/viki", headers=h).json()
    assert r["summary"]["kind"] == "weekly" and r["summary"]["good"] == shown["good"]


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
