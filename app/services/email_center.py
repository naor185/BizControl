"""
BizControl Email Center — centralized email service.

All emails are sent FROM BizControl's infrastructure:
  From:     Studio Name via BizControl <notifications@biz-control.com>
  Reply-To: studio@example.com  (studio's configured address)

Config is loaded from DB (email_system_settings) — no code changes needed
to swap provider / domain / email addresses.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

# ── Settings helpers ──────────────────────────────────────────────────────────

_DEFAULTS = {
    "provider": "resend",
    "api_key": None,
    "domain": "biz-control.com",
    "system_email": "noreply@biz-control.com",
    "notification_email": "notifications@biz-control.com",
    "support_email": "support@biz-control.com",
    "reply_email_default": "support@biz-control.com",
    "email_sending_enabled": True,
    "marketing_emails_enabled": True,
    "appointment_emails_enabled": True,
    "invoice_emails_enabled": True,
}


def get_system_settings(db: Session) -> dict:
    try:
        row = db.execute(text("SELECT * FROM email_system_settings LIMIT 1")).fetchone()
        if row:
            d = dict(row._mapping)
            # Fall back to defaults for any None values
            for k, v in _DEFAULTS.items():
                if d.get(k) is None:
                    d[k] = v
            return d
    except Exception as e:
        log.warning("[email_center] could not load settings: %s", e)
    return dict(_DEFAULTS)


def get_studio_email_settings(db: Session, studio_id: str) -> dict:
    try:
        row = db.execute(
            text("SELECT * FROM studio_email_settings WHERE studio_id = :sid"),
            {"sid": str(studio_id)}
        ).fetchone()
        return dict(row._mapping) if row else {}
    except Exception:
        return {}


# ── Logging helper ────────────────────────────────────────────────────────────

def _log(
    db: Session,
    *,
    recipient: str,
    subject: str,
    template_key: str,
    status: str,
    studio_id: Optional[str] = None,
    client_id: Optional[str] = None,
    provider_message_id: Optional[str] = None,
    error: Optional[str] = None,
):
    try:
        db.execute(
            text("""
                INSERT INTO email_logs
                    (studio_id, client_id, recipient_email, subject, template_key,
                     status, provider_message_id, error_message)
                VALUES (:sid, :cid, :email, :subj, :tkey, :status, :pmid, :err)
            """),
            {
                "sid": studio_id, "cid": client_id,
                "email": recipient, "subj": subject, "tkey": template_key,
                "status": status, "pmid": provider_message_id, "err": error,
            }
        )
        db.commit()
    except Exception as e:
        log.error("[email_center] logging failed: %s", e)


# ── Provider implementations ──────────────────────────────────────────────────

def _send_resend(api_key: str, from_addr: str, to: str, subject: str, html: str, reply_to: str) -> str:
    import httpx
    payload: dict = {
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if reply_to:
        payload["reply_to"] = reply_to
    r = httpx.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("id", "")


def _send_mailgun(api_key: str, domain: str, from_addr: str, to: str, subject: str, html: str, reply_to: str) -> str:
    import httpx
    data: dict = {
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if reply_to:
        data["h:Reply-To"] = reply_to
    r = httpx.post(
        f"https://api.mailgun.net/v3/{domain}/messages",
        auth=("api", api_key),
        data=data,
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("id", "")


def _send_ses(api_key: str, from_addr: str, to: str, subject: str, html: str, reply_to: str) -> str:
    raise NotImplementedError("Amazon SES support coming soon")


# ── Main send function ────────────────────────────────────────────────────────

def send_email(
    db: Session,
    *,
    to_email: str,
    subject: str,
    html_content: str,
    from_name: str = "BizControl",
    reply_to: Optional[str] = None,
    studio_id: Optional[str] = None,
    client_id: Optional[str] = None,
    template_key: str = "custom",
    email_type: str = "system",  # system | appointment | marketing | invoice
) -> bool:
    """
    Send an email via BizControl's centralized email infrastructure.

    From:     {from_name} via BizControl <notification_email>
    Reply-To: studio reply_to → system default
    """
    settings = get_system_settings(db)

    if not settings.get("email_sending_enabled", True):
        log.info("[email_center] email sending disabled globally")
        return False

    type_flags = {
        "appointment": "appointment_emails_enabled",
        "marketing":   "marketing_emails_enabled",
        "invoice":     "invoice_emails_enabled",
    }
    if email_type in type_flags and not settings.get(type_flags[email_type], True):
        log.info("[email_center] %s emails disabled", email_type)
        return False

    api_key = settings.get("api_key") or ""
    if not api_key:
        log.warning("[email_center] no API key configured — email not sent")
        _log(db, recipient=to_email, subject=subject, template_key=template_key,
             status="failed", studio_id=studio_id, client_id=client_id,
             error="No API key configured")
        return False

    # Build From address
    notification_email = settings.get("notification_email", "notifications@biz-control.com")
    from_addr = f"{from_name} via BizControl <{notification_email}>"

    # Resolve Reply-To
    if not reply_to and studio_id:
        s = get_studio_email_settings(db, studio_id)
        reply_to = s.get("reply_to_email") or ""
    if not reply_to:
        reply_to = settings.get("reply_email_default", "support@biz-control.com")

    provider = settings.get("provider", "resend")
    domain   = settings.get("domain", "biz-control.com")

    try:
        if provider == "resend":
            msg_id = _send_resend(api_key, from_addr, to_email, subject, html_content, reply_to)
        elif provider == "mailgun":
            msg_id = _send_mailgun(api_key, domain, from_addr, to_email, subject, html_content, reply_to)
        elif provider == "ses":
            msg_id = _send_ses(api_key, from_addr, to_email, subject, html_content, reply_to)
        else:
            raise ValueError(f"Unknown provider: {provider}")

        _log(db, recipient=to_email, subject=subject, template_key=template_key,
             status="sent", studio_id=studio_id, client_id=client_id,
             provider_message_id=msg_id)
        log.info("[email_center] sent %s → %s (provider=%s, id=%s)", template_key, to_email, provider, msg_id)
        return True

    except Exception as e:
        log.error("[email_center] send failed: %s", e)
        _log(db, recipient=to_email, subject=subject, template_key=template_key,
             status="failed", studio_id=studio_id, client_id=client_id,
             error=str(e))
        return False
