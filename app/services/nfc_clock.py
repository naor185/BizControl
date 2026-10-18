"""
The attendance clock (owner, 2026-10-13/16). A barcode printed at a business's door — or an NFC sticker — holds the link
{site}/clock/{code}. A worker scans it (or touches it) with their own phone, signed in to their own account — that's who
they are; the code is the proof they're at the door. One scan clocks in, the next clocks out; the hours go to the pay
screen.

The clock is part of the plan (MODULE — pro, enterprise and the free month; not עסק קטן). Every worker and manager
clocks, whatever their pay: commission, hourly, a salary — the pay doesn't change, the hours are kept. The owner
doesn't. Without the barcode, they clock with the button in the header.

Only the superadmin turns the barcode on for a business and issues the code; he sends the owner the barcode and the
link. Then the owner — and a manager allowed the team — sees the barcode on ניהול צוות, to print, and can replace it
when it got out. While it's on, the people clock only at the door (the header button turns into a hint), and the owner
and the managers fix a forgotten or wrong time.
"""
from __future__ import annotations

import hmac
import secrets
from datetime import timedelta

from app.core.sites import BIZCONTROL_URL


MODULE = "attendance"


def included(db, studio_id) -> bool:
    """The business's plan has the attendance clock (start.py "attendance_module_v1")."""
    from app.core.features import has_module
    return has_module(db, studio_id, MODULE)


def clocks(db, studio_id, role: str | None) -> bool:
    """Whether this person clocks in and out: a worker or a manager, in a plan with the clock — not the owner."""
    return role not in ("owner", "superadmin") and included(db, studio_id)


EARLY_WINDOW = timedelta(hours=3)


def paid_from(db, studio_id, at):
    """A clock-in before the business's opening hour (settings → the day's start, calendar_start_hour) is paid from the
    opening hour — the owner, 2026-10-19: "a worker due at 8 who clocks in at 7 is paid from 8". The clock-in itself
    stays as it was. Only a clock-in up to EARLY_WINDOW before the opening: one in the night isn't early for the
    morning — it's a night's work, counted from the clock-in. None: from the clock-in (after the opening, earlier than
    the window, or the switch off)."""
    import pytz
    from datetime import datetime as _dt
    from app.models.studio_settings import StudioSettings
    settings = db.get(StudioSettings, studio_id)
    if settings is None or not getattr(settings, "clock_from_opening", True):
        return None
    tz = pytz.timezone(settings.timezone or "Asia/Jerusalem")
    try:
        hh, mm = (int(x) for x in (settings.calendar_start_hour or "08:00").split(":")[:2])
    except ValueError:
        return None
    local = at.astimezone(tz)
    opening = tz.localize(_dt(local.year, local.month, local.day, hh, mm))
    return opening if opening - EARLY_WINDOW <= at < opening else None


def on(settings) -> bool:
    return bool(settings is not None and getattr(settings, "nfc_clock_code", None))


def issue(settings) -> str:
    """A new code — the old sticker stops working."""
    settings.nfc_clock_code = secrets.token_urlsafe(12)
    return settings.nfc_clock_code


def link(settings) -> str | None:
    return f"{BIZCONTROL_URL}/clock/{settings.nfc_clock_code}" if on(settings) else None


def matches(settings, code: str) -> bool:
    return on(settings) and hmac.compare_digest(str(settings.nfc_clock_code), str(code or "").strip())
