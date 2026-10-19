"""The month's hours and pay, for the business's accountant (the owner, 2026-10-19: "the hours and the dates of a worker
paid by the hour go out to the accountant"). An e-mail to the accountant's address (invoice settings) with:
- the team's pay report (PDF — pdf_service.generate_payroll_pdf, the same as "PDF לכולם" on the pay screen);
- every shift of the month in an Excel-ready file (CSV, UTF-8): worker, pay type, date, in, out, counted from (a
  clock-in before the opening hour — services/nfc_clock.paid_from), hours, the shift's pay.
A summary from the system, not an official payslip — tax, national insurance and pension are the accountant's.

Sent by hand from the pay screen, or by itself on the 1st of the month for the month before
(studio_settings.payroll_to_accountant_auto; payroll_sent_month — once a month, a missed day caught up)."""
from __future__ import annotations

import base64
import csv
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytz
from sqlalchemy import select, text
from sqlalchemy.orm import Session

PAY_WORDS = {"hourly": "שעתי", "commission": "עמלה", "global": "משכורת גלובלית", "none": "ללא"}
IL = pytz.timezone("Asia/Jerusalem")


def _tz(db: Session, studio_id):
    from app.models.studio_settings import StudioSettings
    settings = db.get(StudioSettings, studio_id)
    return pytz.timezone(settings.timezone if settings and settings.timezone else "Asia/Jerusalem")


def month_range(db: Session, studio_id, year: int, month: int) -> tuple[datetime, datetime]:
    """The month in the business's own time — the first's midnight to the last second of the last day."""
    tz = _tz(db, studio_id)
    start = tz.localize(datetime(year, month, 1))
    nxt = tz.localize(datetime(year + (month == 12), month % 12 + 1, 1))
    return start, nxt - timedelta(seconds=1)


def accountant_email(db: Session, studio_id) -> str | None:
    row = db.execute(text("SELECT accountant_email FROM invoice_settings WHERE studio_id = :sid"),
                     {"sid": str(studio_id)}).fetchone()
    return (row[0] or "").strip() or None if row else None


def shift_rows(db: Session, studio_id, start: datetime, end: datetime, user_id=None) -> list[dict]:
    """The shifts that ended, in the business's time: date, in, out, counted from, hours (from when they count), pay."""
    from app.models.user import User
    from app.models.work_session import WorkSession
    from app.repositories.staff_repository import paid_start, worked_seconds
    tz = _tz(db, studio_id)
    q = (select(WorkSession, User).join(User, User.id == WorkSession.user_id)
         .where(WorkSession.studio_id == studio_id, WorkSession.start_time >= start, WorkSession.start_time <= end,
                WorkSession.end_time.is_not(None))
         .order_by(User.display_name, WorkSession.start_time))
    if user_id is not None:
        q = q.where(WorkSession.user_id == user_id)
    out = []
    for w, u in db.execute(q).all():
        counted = paid_start(w)
        out.append({
            "user_id": u.id, "name": u.display_name or u.email, "pay_type": u.pay_type,
            "date": w.start_time.astimezone(tz).strftime("%d/%m/%Y"),
            "start": w.start_time.astimezone(tz).strftime("%H:%M"), "end": w.end_time.astimezone(tz).strftime("%H:%M"),
            "counted_from": counted.astimezone(tz).strftime("%H:%M") if w.paid_from else "",
            "break": w.break_minutes or 0,
            "hours": round(worked_seconds(w) / 3600, 2),
            "pay": float(w.session_pay or 0),
        })
    return out


def shifts_csv(rows: list[dict]) -> bytes:
    buf = io.StringIO()
    out = csv.writer(buf)
    out.writerow(["עובד/ת", "סוג שכר", "תאריך", "כניסה", "יציאה", "נספר מ-", "הפסקות (דק׳)", "שעות", "שכר המשמרת (₪)"])
    for r in rows:
        out.writerow([r["name"], PAY_WORDS.get(r["pay_type"], r["pay_type"]), r["date"], r["start"], r["end"],
                      r["counted_from"], r.get("break", 0), f"{r['hours']:.2f}", f"{r['pay']:.2f}"])
    return ("﻿" + buf.getvalue()).encode("utf-8")       # the BOM: Excel opens Hebrew right


def send(db: Session, studio_id, year: int, month: int) -> dict:
    """The month to the accountant. ValueError (in Hebrew) when there's no address."""
    from app.models.studio import Studio
    from app.repositories.staff_repository import StaffRepository
    from app.services.email_center import send_email
    from app.services.pdf_service import generate_payroll_pdf

    to = accountant_email(db, studio_id)
    if not to:
        raise ValueError("לא הוגדר מייל של רואה החשבון — מגדירים אותו בחשבוניות ← הגדרות")
    start, end = month_range(db, studio_id, year, month)
    items = StaffRepository(db).get_user_payroll_summary(studio_id, start, end)
    rows = shift_rows(db, studio_id, start, end)
    studio = db.get(Studio, studio_id)
    name = studio.name if studio else ""
    grand = float(sum((i["total_pay"] for i in items), Decimal("0.00")))
    label = f"{month:02d}/{year}"

    pdf = generate_payroll_pdf(items=[dict(i) for i in items], grand_total=grand, period_start=start, period_end=end,
                               studio_name=name)
    lines = "".join(
        f"<tr><td style='padding:8px 10px;border-bottom:1px solid #eee'>{i['display_name']}</td>"
        f"<td style='padding:8px 10px;border-bottom:1px solid #eee'>{PAY_WORDS.get(i['pay_type'], i['pay_type'])}</td>"
        f"<td style='padding:8px 10px;border-bottom:1px solid #eee;text-align:left'>{float(i['total_hours']):.2f}</td>"
        f"<td style='padding:8px 10px;border-bottom:1px solid #eee;text-align:left'>₪{float(i['total_pay']):,.2f}</td></tr>"
        for i in items)
    html = f"""<html dir="rtl" lang="he"><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;direction:rtl;color:#1a1a2e">
<div style="max-width:700px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 4px">שעות ושכר {label} — {name}</h2>
  <p style="color:#64748b;font-size:13px;margin:0 0 12px">מצורפים: דוח השכר של הצוות (PDF), וכל המשמרות של החודש בקובץ לאקסל —
  תאריך, כניסה, יציאה ושעות לכל עובד/ת.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead><tr style="background:#1a1a2e;color:#fff"><th style="padding:8px 10px;text-align:right">עובד/ת</th>
    <th style="padding:8px 10px;text-align:right">סוג שכר</th><th style="padding:8px 10px;text-align:left">שעות</th>
    <th style="padding:8px 10px;text-align:left">לתשלום</th></tr></thead>
    <tbody>{lines}</tbody>
    <tfoot><tr style="font-weight:700;background:#f8fafc"><td colspan="3" style="padding:8px 10px">סה״כ</td>
    <td style="padding:8px 10px;text-align:left">₪{grand:,.2f}</td></tr></tfoot>
  </table>
  <p style="color:#94a3b8;font-size:11px;margin-top:16px">סיכום מהמערכת, לא תלוש רשמי — ללא ניכויי מס, ביטוח לאומי ופנסיה.
  נשלח מ-BizControl.</p>
</div></body></html>"""
    ok = send_email(
        db, to_email=to, subject=f"שעות ושכר {label} | {name}", html_content=html, from_name=name or "BizControl",
        studio_id=str(studio_id), template_key="payroll_report", email_type="invoice",
        attachments=[
            {"filename": f"payroll_{year}_{month:02d}.pdf", "content_base64": base64.b64encode(pdf).decode("ascii")},
            {"filename": f"shifts_{year}_{month:02d}.csv", "content_base64": base64.b64encode(shifts_csv(rows)).decode("ascii")},
        ],
    )
    if not ok:
        raise ValueError("השליחה נכשלה — נסו שוב בעוד כמה דקות")
    return {"to": to, "workers": len(items), "shifts": len(rows), "month": label}


def sweep_monthly(db: Session, now: datetime | None = None) -> int:
    """From the 1st of a month: the month before to the accountant, for the businesses that asked for it — once."""
    from app.models.studio_settings import StudioSettings
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(IL).date()
    prev = (today.replace(day=1) - timedelta(days=1))
    key = f"{prev.year}-{prev.month:02d}"
    sent = 0
    for s in db.scalars(select(StudioSettings).where(StudioSettings.payroll_to_accountant_auto.is_(True))).all():
        if s.payroll_sent_month == key:
            continue
        try:
            send(db, s.studio_id, prev.year, prev.month)
        except ValueError:
            continue                                          # no address yet — tried again tomorrow
        s.payroll_sent_month = key
        db.commit()
        sent += 1
    return sent
