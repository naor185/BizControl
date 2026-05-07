import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging

logger = logging.getLogger(__name__)

def send_email_sync(host: str, port: int, user: str, password: str,
                    from_email: str, to_email: str, subject: str, html_content: str) -> bool:
    if not all([host, port, user, password, from_email, to_email]):
        logger.error("Missing SMTP config")
        return False
    try:
        msg = MIMEMultipart()
        msg['From'] = from_email
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(html_content, 'html', 'utf-8'))
        server = smtplib.SMTP(host, port)
        server.starttls()
        server.login(user, password)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False

async def send_email(
    host: str,
    port: int,
    user: str,
    password: str,
    from_email: str,
    to_email: str,
    subject: str,
    html_content: str
) -> bool:
    """
    Sends an email using the provided SMTP credentials.
    Supports Gmail App Passwords.
    """
    if not all([host, port, user, password, from_email, to_email]):
        logger.error("Missing required SMTP configuration for sending email.")
        return False
        
    try:
        msg = MIMEMultipart()
        msg['From'] = from_email
        msg['To'] = to_email
        msg['Subject'] = subject

        msg.attach(MIMEText(html_content, 'html', 'utf-8'))

        server = smtplib.SMTP(host, port)
        server.starttls()
        server.login(user, password)
        server.send_message(msg)
        server.quit()
        
        logger.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {str(e)}")
        # Raise the exception so the API endpoint can return the actual error message to the user
        raise e
