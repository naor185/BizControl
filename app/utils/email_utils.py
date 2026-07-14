import os
import logging
import requests

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailSendError(RuntimeError):
    """Raised with the actual provider error detail instead of a bare bool,
    so callers can surface the real cause (e.g. unverified sender domain,
    invalid key) instead of a generic failure message."""


def _resend_send(api_key: str, from_email: str, to_email: str, subject: str, html_content: str) -> bool:
    try:
        resp = requests.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"from": from_email, "to": [to_email], "subject": subject, "html": html_content},
            timeout=15,
        )
        if resp.status_code >= 400:
            logger.error(f"[email] Resend error {resp.status_code}: {resp.text}")
            raise EmailSendError(f"Resend {resp.status_code}: {resp.text[:300]}")
        logger.info(f"[email] sent to {to_email} via Resend")
        return True
    except EmailSendError:
        raise
    except Exception as e:
        logger.error(f"[email] Resend request failed: {e}")
        raise EmailSendError(str(e)) from e


def send_email_sync(
    api_key: str = "",
    from_email: str = "",
    to_email: str = "",
    subject: str = "",
    html_content: str = "",
    **kwargs,
) -> bool:
    """Returns True on success; raises EmailSendError (with the real provider
    detail) on failure instead of silently returning False."""
    key = api_key or os.getenv("RESEND_API_KEY", "")
    if not key:
        logger.error("[email] No Resend API key configured")
        raise EmailSendError("No Resend API key configured")
    return _resend_send(key, from_email, to_email, subject, html_content)


async def send_email(
    api_key: str = "",
    from_email: str = "",
    to_email: str = "",
    subject: str = "",
    html_content: str = "",
    **kwargs,
) -> bool:
    return send_email_sync(api_key=api_key, from_email=from_email, to_email=to_email, subject=subject, html_content=html_content)
