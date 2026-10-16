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

from app.core.sites import BIZCONTROL_URL


MODULE = "attendance"


def included(db, studio_id) -> bool:
    """The business's plan has the attendance clock (start.py "attendance_module_v1")."""
    from app.core.features import has_module
    return has_module(db, studio_id, MODULE)


def clocks(db, studio_id, role: str | None) -> bool:
    """Whether this person clocks in and out: a worker or a manager, in a plan with the clock — not the owner."""
    return role not in ("owner", "superadmin") and included(db, studio_id)


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
