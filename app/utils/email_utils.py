import os
import logging
import requests

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def _resend_send(from_email: str, to_email: str, subject: str, html_content: str) -> bool:
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        logger.error("[email] RESEND_API_KEY not set")
        return False
    try:
        resp = requests.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"from": from_email, "to": [to_email], "subject": subject, "html": html_content},
            timeout=15,
        )
        if resp.status_code >= 400:
            logger.error(f"[email] Resend error {resp.status_code}: {resp.text}")
            return False
        logger.info(f"[email] sent to {to_email} via Resend")
        return True
    except Exception as e:
        logger.error(f"[email] failed to send to {to_email}: {e}")
        return False


def send_email_sync(**kwargs) -> bool:
    """Send email via Resend API. Accepts legacy SMTP kwargs and ignores them."""
    return _resend_send(
        from_email=kwargs.get("from_email", ""),
        to_email=kwargs.get("to_email", ""),
        subject=kwargs.get("subject", ""),
        html_content=kwargs.get("html_content", ""),
    )


async def send_email(**kwargs) -> bool:
    """Async wrapper around send_email_sync."""
    return send_email_sync(**kwargs)
