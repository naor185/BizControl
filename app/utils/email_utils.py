import logging
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger(__name__)


def _smtp_send(host: str, port: int, user: str, password: str, from_email: str, to_email: str, subject: str, html_content: str) -> bool:
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_email
        msg["To"] = to_email
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo()
            server.starttls(context=context)
            server.login(user, password)
            server.sendmail(from_email, to_email, msg.as_string())

        logger.info(f"[email] sent to {to_email} via SMTP ({host})")
        return True
    except Exception as e:
        logger.error(f"[email] SMTP failed to {to_email}: {e}")
        raise


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
    if host and user and password:
        return _smtp_send(host, port, user, password, from_email or user, to_email, subject, html_content)
    logger.error("[email] No SMTP credentials provided")
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
