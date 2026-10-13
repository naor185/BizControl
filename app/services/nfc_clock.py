"""
The NFC attendance clock (owner, 2026-10-13). One sticker at a business's door holds the link {site}/clock/{code}.
A worker touches it with their own phone, signed in to their own account — that's who they are; the sticker's code is
the proof they're at the door. One touch clocks in, the next clocks out; the hours go to the pay screen.
Only the superadmin turns it on for a business and issues (or replaces) the code — he writes it on the sticker and
sends it. The business sees "on" and nothing more; while it's on, its people clock in and out only at the sticker
(the clock button in the header turns into a hint), and the owner and the managers fix a forgotten or wrong time.
"""
from __future__ import annotations

import hmac
import secrets

from app.core.sites import BIZCONTROL_URL


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
