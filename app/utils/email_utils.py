import os
import logging
import smtplib
import ssl
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


def _resend_send(from_email: str, to_email: str, subject: str, html_content: str) -> bool:
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
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
        logger.error(f"[email] Resend failed: {e}")
        return False


def _smtp_send(host: str, port: int, user: str, password: str, from_email: str, to_email: str, subject: str, html_content: str) -> bool:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    context = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=context, timeout=15) as server:
            server.login(user, password)
            server.sendmail(from_email, to_email, msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(user, password)
            server.sendmail(from_email, to_email, msg.as_string())

    logger.info(f"[email] sent to {to_email} via SMTP ({host}:{port})")
    return True


def send_email_sync(
    host: str = "",
    port: int = 587,
    user: str = "",
    password: str = "",
    from_email: str = "",
    to_email: str = "",
    subject: str = "",
    html_content: str = "",
    **kwargs,
) -> bool:
    # Try Resend first if API key is available
    if os.getenv("RESEND_API_KEY"):
        result = _resend_send(from_email or user, to_email, subject, html_content)
        if result:
            return True

    # Fall back to SMTP
    if host and user and password:
        return _smtp_send(host, port, user, password, from_email or user, to_email, subject, html_content)

    logger.error("[email] No email provider configured (set RESEND_API_KEY or SMTP credentials)")
    return False


async def send_email(
    host: str = "",
    port: int = 587,
    user: str = "",
    password: str = "",
    from_email: str = "",
    to_email: str = "",
    subject: str = "",
    html_content: str = "",
    **kwargs,
) -> bool:
    return send_email_sync(
        host=host, port=port, user=user, password=password,
        from_email=from_email, to_email=to_email,
        subject=subject, html_content=html_content,
    )
