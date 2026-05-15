import os
import logging
import requests

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


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
            return False
        logger.info(f"[email] sent to {to_email} via Resend")
        return True
    except Exception as e:
        logger.error(f"[email] Resend request failed: {e}")
        return False


def send_email_sync(
    api_key: str = "",
    from_email: str = "",
    to_email: str = "",
    subject: str = "",
    html_content: str = "",
    **kwargs,
) -> bool:
    key = api_key or os.getenv("RESEND_API_KEY", "")
    if not key:
        logger.error("[email] No Resend API key configured")
        return False
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
