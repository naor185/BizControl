"""
Addresses the server hands out, each from one place:
- BIZFIND_URL — every link a message or an e-mail sends to BizFind (a booking, the waitlist, verifying an e-mail).
  Set BIZFIND_URL on the server when BizFind moves to a new domain; until then it is find.biz-control.com (the web
  app reads the same address from NEXT_PUBLIC_BIZFIND_URL, web/src/lib/config.ts).
- logo_address() — the business's logo on every page.
"""
import os

BIZFIND_URL = (os.getenv("BIZFIND_URL") or "https://find.biz-control.com").rstrip("/")


def logo_address(logo_url: str | None, logo_filename: str | None) -> str | None:
    """The business's logo as every page shows it. The owner's upload always lands in studio_settings.logo_filename — a
    full address when it went to the cloud, else a file on this server (/uploads/…, completed by the page like the cover
    photo); studios.logo_url is set only on a cloud upload, so reading it alone left a logo saved on this server
    (Nctattoo's) off BizFind."""
    if logo_filename:
        return logo_filename if logo_filename.startswith("http") else f"/uploads/{logo_filename}"
    return logo_url
