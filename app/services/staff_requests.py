"""Workers' requests — the workers center's stage 3 (the owner, 2026-10-19: "swaps — the owner approves the swap …
vacations"). Two kinds:

- A shift swap: a worker asks a colleague to take one of their published shifts — or to trade it for one of the
  colleague's. The colleague hears of it and agrees (or not); then the owner (or a manager allowed the team) approves —
  and the schedule changes by itself; both hear of it.
- Time off — a vacation, a sick day, other: the worker asks for days; the owner approves — the worker's calendar is
  locked those days (a "הפסקה" lock per day: no appointment on it — services/calendar_blocks), and their shifts on those
  days are shown on the request for the owner to move.

The owner hears of a request waiting for them in the bell (Notification); the workers by a push, or a WhatsApp without
the app (services/team_tasks._to_worker)."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

TIME_OFF = {"vacation": "חופשה", "sick": "מחלה", "other": "היעדרות"}
MAX_DAYS = 31


class RequestError(ValueError):
    """Said to the user as is (Hebrew)."""


def _settings(db: Session, studio_id):
    from app.models.studio_settings import StudioSettings
    return db.get(StudioSettings, studio_id)


def shift_words(db: Session, studio_id, s) -> str:
    from app.services.schedule import DAY_WORDS, tz_of
    tz = tz_of(_settings(db, studio_id))
    a, b = s.starts_at.astimezone(tz), s.ends_at.astimezone(tz)
    return f"יום {DAY_WORDS[(a.weekday() + 1) % 7]} {a:%d/%m} {a:%H:%M}–{b:%H:%M}"


def _name(u) -> str:
    return (u.display_name or u.email) if u else ""


def _tell_owner(db: Session, studio_id, title: str, body: str, key: str) -> None:
    from app.models.notification import Notification
    if db.scalar(select(Notification.id).where(Notification.studio_id == studio_id, Notification.dedup_key == key)):
        return
    db.add(Notification(studio_id=studio_id, type="staff_request", title=title, body=body,
                        action_url="/team?tab=requests", dedup_key=key))
    db.commit()


def _tell_worker(db: Session, studio_id, user_id, title: str, body: str, kind: str, key: str) -> None:
    from app.models.user import User
    from app.services.team_tasks import _to_worker
    worker = db.get(User, user_id)
    if worker is not None and worker.is_active:
        _to_worker(db, studio_id, worker, title, body, kind, key, link="/my-shifts")


def _published_future_shift(db: Session, studio_id, shift_id, owner_id):
    from app.models.schedule import ScheduledShift
    from app.services.schedule import is_published, tz_of, week_of
    s = db.get(ScheduledShift, shift_id) if shift_id else None
    if s is None or s.studio_id != studio_id or s.user_id != owner_id:
        raise RequestError("המשמרת לא נמצאה")
    if s.starts_at <= datetime.now(timezone.utc):
        raise RequestError("המשמרת כבר התחילה")
    if is_published(db, studio_id, week_of(s.starts_at.astimezone(tz_of(_settings(db, studio_id))).date())) is None:
        raise RequestError("הסידור לשבוע הזה עוד לא פורסם")
    return s


def _overlaps(db: Session, studio_id, user_id, a, b, skip_ids=()) -> bool:
    from app.models.schedule import ScheduledShift
    q = select(ScheduledShift.id).where(ScheduledShift.studio_id == studio_id, ScheduledShift.user_id == user_id,
                                        ScheduledShift.starts_at < b, ScheduledShift.ends_at > a)
    for sid in skip_ids:
        if sid is not None:
            q = q.where(ScheduledShift.id != sid)
    return db.scalar(q.limit(1)) is not None


def ask_swap(db: Session, studio_id, user_id, shift_id, target_user_id, target_shift_id=None, note: str | None = None):
    from app.models.staff_request import StaffRequest
    from app.models.user import User
    mine = _published_future_shift(db, studio_id, shift_id, user_id)
    colleague = db.get(User, target_user_id) if target_user_id else None
    if colleague is None or colleague.studio_id != studio_id or not colleague.is_active or colleague.id == user_id:
        raise RequestError("בחרו עמית/ה מהצוות")
    theirs = _published_future_shift(db, studio_id, target_shift_id, colleague.id) if target_shift_id else None
    if _overlaps(db, studio_id, colleague.id, mine.starts_at, mine.ends_at, skip_ids=(theirs.id if theirs else None,)):
        raise RequestError(f"ל{_name(colleague)} כבר יש משמרת בשעות האלה")
    if db.scalar(select(StaffRequest.id).where(StaffRequest.shift_id == mine.id,
                                               StaffRequest.status.in_(("waiting_colleague", "waiting_owner"))).limit(1)):
        raise RequestError("כבר יש בקשת החלפה פתוחה על המשמרת הזו")
    me = db.get(User, user_id)
    summary = shift_words(db, studio_id, mine) + (f" ⇄ {shift_words(db, studio_id, theirs)}" if theirs else "")
    r = StaffRequest(studio_id=studio_id, user_id=user_id, kind="swap", status="waiting_colleague", shift_id=mine.id,
                     target_user_id=colleague.id, target_shift_id=theirs.id if theirs else None,
                     note=(note or "").strip()[:300] or None, summary=summary)
    db.add(r)
    db.commit()
    what = f"{_name(me)} מבקש/ת שתחליף/י אותו/ה ב{shift_words(db, studio_id, mine)}"
    if theirs:
        what += f", ובתמורה תקבל/י את {shift_words(db, studio_id, theirs)}"
    _tell_worker(db, studio_id, colleague.id, "בקשת החלפת משמרת", what, "swap_request", f"swap:{r.id}:ask")
    return r


def answer_swap(db: Session, studio_id, user_id, request_id, accept: bool):
    from app.models.staff_request import StaffRequest
    from app.models.user import User
    r = db.get(StaffRequest, request_id)
    if r is None or r.studio_id != studio_id or r.target_user_id != user_id or r.status != "waiting_colleague":
        raise RequestError("הבקשה לא נמצאה או שכבר נענתה")
    colleague, asker = db.get(User, user_id), db.get(User, r.user_id)
    if accept:
        r.status = "waiting_owner"
        db.commit()
        _tell_owner(db, studio_id, "החלפת משמרת מחכה לאישור",
                    f"{_name(asker)} ו{_name(colleague)}: {r.summary}", f"swap:{r.id}:owner")
    else:
        r.status, r.decided_at = "declined", datetime.now(timezone.utc)
        db.commit()
        _tell_worker(db, studio_id, r.user_id, "בקשת ההחלפה לא התקבלה",
                     f"{_name(colleague)} לא יכול/ה להחליף ב{r.summary}", "swap_answer", f"swap:{r.id}:declined")
    return r


def ask_time_off(db: Session, studio_id, user_id, kind: str, date_from: date, date_to: date, note: str | None = None):
    from app.models.staff_request import StaffRequest
    from app.models.user import User
    from app.services.schedule import tz_of
    if kind not in TIME_OFF:
        raise RequestError("סוג בקשה לא מוכר")
    today = datetime.now(tz_of(_settings(db, studio_id))).date()
    if date_to < date_from:
        raise RequestError("תאריך הסיום לפני תאריך ההתחלה")
    if date_from < today - timedelta(days=7):
        raise RequestError("אפשר לבקש עד שבוע אחורה")           # a sick day is often reported after it
    if (date_to - date_from).days + 1 > MAX_DAYS:
        raise RequestError(f"עד {MAX_DAYS} ימים בבקשה אחת")
    me = db.get(User, user_id)
    days = f"{date_from:%d/%m}" + (f"–{date_to:%d/%m}" if date_to != date_from else "")
    r = StaffRequest(studio_id=studio_id, user_id=user_id, kind=kind, status="waiting_owner", date_from=date_from,
                     date_to=date_to, note=(note or "").strip()[:300] or None, summary=f"{TIME_OFF[kind]} {days}")
    db.add(r)
    db.commit()
    _tell_owner(db, studio_id, f"בקשת {TIME_OFF[kind]}", f"{_name(me)}: {days}" + (f" — {r.note}" if r.note else ""),
                f"off:{r.id}:owner")
    return r


def shifts_during(db: Session, studio_id, user_id, date_from: date, date_to: date) -> list:
    from app.models.schedule import ScheduledShift
    from app.services.schedule import tz_of
    tz = tz_of(_settings(db, studio_id))
    a = tz.localize(datetime(date_from.year, date_from.month, date_from.day))
    b = tz.localize(datetime(date_to.year, date_to.month, date_to.day)) + timedelta(days=1)
    return db.scalars(select(ScheduledShift).where(ScheduledShift.studio_id == studio_id, ScheduledShift.user_id == user_id,
                                                   ScheduledShift.starts_at >= a, ScheduledShift.starts_at < b)
                      .order_by(ScheduledShift.starts_at)).all()


def decide(db: Session, studio_id, by_id, request_id, approve: bool, note: str | None = None):
    """The owner's (or a manager's) answer. A swap: the shifts change hands; time off: the days are locked."""
    from app.models.schedule import ScheduledShift
    from app.models.staff_request import StaffRequest
    from app.models.task import Task
    from app.models.user import User
    r = db.get(StaffRequest, request_id)
    if r is None or r.studio_id != studio_id or r.status != "waiting_owner":
        raise RequestError("הבקשה לא נמצאה או שכבר טופלה")
    now = datetime.now(timezone.utc)
    if approve and r.kind == "swap":
        mine = db.get(ScheduledShift, r.shift_id) if r.shift_id else None
        theirs = db.get(ScheduledShift, r.target_shift_id) if r.target_shift_id else None
        if mine is None or mine.user_id != r.user_id or (r.target_shift_id and (theirs is None or theirs.user_id != r.target_user_id)):
            raise RequestError("המשמרות השתנו מאז הבקשה — אי אפשר לאשר אותה כמו שהיא")
        if _overlaps(db, studio_id, r.target_user_id, mine.starts_at, mine.ends_at, skip_ids=(theirs.id if theirs else None,)) \
                or (theirs and _overlaps(db, studio_id, r.user_id, theirs.starts_at, theirs.ends_at, skip_ids=(mine.id,))):
            raise RequestError("ההחלפה יוצרת שתי משמרות באותו זמן — בדקו את הסידור")
        mine.user_id, mine.updated_at = r.target_user_id, now
        if theirs:
            theirs.user_id, theirs.updated_at = r.user_id, now
    if approve and r.kind in TIME_OFF:
        asker = db.get(User, r.user_id)
        ids = []
        day = r.date_from
        while day <= r.date_to:
            t = Task(studio_id=studio_id, title=f"{TIME_OFF[r.kind]} — {_name(asker)}", task_date=day, start_time="00:00",
                     end_time="23:59", assignee_id=r.user_id, kind="break", blocks_booking=True,
                     notes=f"אושר במרכז העובדים{(': ' + r.note) if r.note else ''}")
            db.add(t)
            db.flush()
            ids.append(str(t.id))
            day += timedelta(days=1)
        r.lock_task_ids = json.dumps(ids)
    r.status = "approved" if approve else "rejected"
    r.decided_by, r.decided_at, r.decision_note = by_id, now, (note or "").strip()[:300] or None
    db.commit()
    word = "אושרה" if approve else "לא אושרה"
    tail = f" — {r.decision_note}" if r.decision_note else ""
    _tell_worker(db, studio_id, r.user_id, f"הבקשה שלך {word}", f"{r.summary}{tail}", "request_decided", f"req:{r.id}:{r.status}")
    if r.kind == "swap" and r.target_user_id:
        _tell_worker(db, studio_id, r.target_user_id, f"ההחלפה {word}", f"{r.summary}{tail}", "request_decided",
                     f"req:{r.id}:{r.status}:colleague")
    return r


def cancel(db: Session, studio_id, user_id, request_id):
    from app.models.staff_request import StaffRequest
    r = db.get(StaffRequest, request_id)
    if r is None or r.studio_id != studio_id or r.user_id != user_id or r.status not in ("waiting_colleague", "waiting_owner"):
        raise RequestError("אפשר לבטל רק בקשה שעוד מחכה")
    r.status, r.decided_at = "canceled", datetime.now(timezone.utc)
    db.commit()
    return r
