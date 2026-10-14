"""The business's own data in one Excel file — its clients and its appointments (owner, 2026-10-14: "a business that
moves to another system takes its clients"; Excel is what every system imports).

Two sheets, right to left: "לקוחות" (the active clients — a deleted one stays deleted) and "תורים" (every appointment,
past and coming), times on the business's own clock, what was paid from the payments themselves (refunds taken off).
Not in it, on purpose: health declarations, signatures, treatment photos — medical and personal, they stay here.
Owner only, with his PIN, written in the activity log (api/data_export_routes.py)."""
from __future__ import annotations

import io
from collections import defaultdict

import pytz
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.appointment import Appointment
from app.models.client import Client
from app.models.payment import Payment
from app.models.studio_settings import StudioSettings
from app.models.user import User
from app.services.marketing import receives_marketing

STATUS = {"scheduled": "מתוכנן", "done": "הושלם", "canceled": "בוטל", "no_show": "לא הגיע"}
_HEAD = Font(bold=True, color="FFFFFF")
_FILL = PatternFill("solid", fgColor="1A1A2E")


def _sheet(ws, headers: list[str], rows: list[list], widths: list[int]) -> None:
    ws.sheet_view.rightToLeft = True
    ws.append(headers)
    for cell in ws[1]:
        cell.font, cell.fill, cell.alignment = _HEAD, _FILL, Alignment(horizontal="center")
    for row in rows:
        ws.append(row)
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(ord("A") + i)].width = w
    ws.freeze_panes = "A2"


def build(db: Session, studio_id) -> tuple[bytes, int, int]:
    """(the file, how many clients, how many appointments)"""
    settings = db.get(StudioSettings, studio_id)
    tz = pytz.timezone(settings.timezone if settings and settings.timezone else "Asia/Jerusalem")
    local = lambda dt: dt.astimezone(tz) if dt else None

    paid_by_appt: dict = defaultdict(int)
    paid_by_client: dict = defaultdict(int)
    for appt_id, client_id, kind, cents in db.execute(
            select(Payment.appointment_id, Payment.client_id, Payment.type, Payment.amount_cents)
            .where(Payment.studio_id == studio_id, Payment.status == "paid")).all():
        signed = -(cents or 0) if kind == "refund" else (cents or 0)
        if appt_id:
            paid_by_appt[appt_id] += signed
        if client_id:
            paid_by_client[client_id] += signed

    appts = db.scalars(select(Appointment).where(Appointment.studio_id == studio_id).order_by(Appointment.starts_at)).all()
    clients = {c.id: c for c in db.scalars(select(Client).where(Client.studio_id == studio_id)).all()}
    staff = {u.id: (u.display_name or u.email) for u in db.scalars(select(User).where(User.studio_id == studio_id)).all()}
    from app.models.service import Service
    services = {s.id: s.name for s in db.scalars(select(Service).where(Service.studio_id == studio_id)).all()}

    visits: dict = defaultdict(int)
    last_visit: dict = {}
    for a in appts:
        if a.status in ("done", "scheduled") and a.client_id:
            visits[a.client_id] += 1
            if a.status == "done":
                last_visit[a.client_id] = a.starts_at

    wb = Workbook()
    active = sorted((c for c in clients.values() if c.is_active), key=lambda c: (c.full_name or ""))
    _sheet(wb.active, ["שם מלא", "טלפון", "אימייל", "תאריך לידה", "הערות", "נקודות", "חבר מועדון", "מאשר דיוור",
                       "תורים", "ביקור אחרון", "ביטולים", "לא הגיע", "שולם (₪)", "לקוח מאז"],
           [[c.full_name, c.phone or "", c.email or "", c.birth_date.strftime("%d/%m/%Y") if c.birth_date else "",
             c.notes or "", c.loyalty_points or 0, "כן" if c.is_club_member else "לא",
             "כן" if receives_marketing(c) else "לא",          # the one marketing rule (services/marketing.py)
             visits.get(c.id, 0), local(last_visit[c.id]).strftime("%d/%m/%Y") if c.id in last_visit else "",
             c.cancellation_count or 0, c.no_show_count or 0, paid_by_client.get(c.id, 0) / 100,
             local(c.created_at).strftime("%d/%m/%Y") if c.created_at else ""] for c in active],
           [22, 15, 26, 13, 34, 9, 11, 11, 8, 13, 9, 9, 11, 12])
    wb.active.title = "לקוחות"

    rows = []
    for a in appts:
        c = clients.get(a.client_id)
        start, end = local(a.starts_at), local(a.ends_at)
        rows.append([start.strftime("%d/%m/%Y"), start.strftime("%H:%M"), end.strftime("%H:%M") if end else "",
                     c.full_name if c else "", (c.phone or "") if c else "", a.title or "",
                     services.get(a.service_id, "") if a.service_id else "", staff.get(a.artist_id, ""),
                     STATUS.get(a.status, a.status), (a.total_price_cents or 0) / 100, (a.deposit_amount_cents or 0) / 100,
                     paid_by_appt.get(a.id, 0) / 100, a.notes or ""])
    _sheet(wb.create_sheet("תורים"), ["תאריך", "שעה", "עד", "לקוח", "טלפון", "תור", "שירות", "איש צוות", "סטטוס",
                                       "מחיר (₪)", "מקדמה (₪)", "שולם (₪)", "הערות"],
           rows, [12, 7, 7, 22, 15, 24, 20, 16, 10, 10, 10, 10, 34])

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue(), len(active), len(appts)
