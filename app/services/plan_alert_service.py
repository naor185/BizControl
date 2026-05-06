"""
Sends expiry-warning emails to studio owners and the platform admin.
Runs daily via APScheduler. Fires once per day when a studio is
exactly 7 or 3 days from expiry (±12-hour window to handle scheduler drift).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.studio import Studio
from app.models.user import User
from app.utils.email_utils import send_email

logger = logging.getLogger(__name__)

PLATFORM_SMTP_HOST  = os.getenv("PLATFORM_SMTP_HOST", "")
PLATFORM_SMTP_PORT  = int(os.getenv("PLATFORM_SMTP_PORT", "587"))
PLATFORM_SMTP_USER  = os.getenv("PLATFORM_SMTP_USER", "")
PLATFORM_SMTP_PASS  = os.getenv("PLATFORM_SMTP_PASS", "")
PLATFORM_SMTP_FROM  = os.getenv("PLATFORM_SMTP_FROM", "BizControl <no-reply@bizcontrol.app>")
PLATFORM_ADMIN_EMAIL = os.getenv("PLATFORM_ADMIN_EMAIL", "ncbilutattoo@gmail.com")

WARN_DAYS = [7, 3]
WINDOW_HOURS = 12  # fire if within ±12h of the target day boundary


def _build_studio_html(studio_name: str, days: int, plan: str) -> str:
    urgency_color = "#ef4444" if days <= 3 else "#f59e0b"
    return f"""
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;
         border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; color: #111;">
      <div style="background: #111; padding: 24px 30px;">
        <span style="color: #fff; font-size: 22px; font-weight: bold;">BizControl</span>
      </div>
      <div style="padding: 32px 30px; background: #fafafa;">
        <h2 style="margin: 0 0 12px; color: {urgency_color};">
          {'⚠️' if days <= 3 else '📅'} המנוי שלך יפוג בעוד {days} ימים
        </h2>
        <p style="color: #555; line-height: 1.7;">
          שלום,<br>
          המנוי של הסטודיו <strong>{studio_name}</strong> (תוכנית: {plan}) עומד לפוג.<br>
          כדי להמשיך ליהנות מהמערכת ללא הפרעה, פנה לחידוש בהקדם.
        </p>
        <div style="margin: 24px 0; padding: 16px 20px; border-radius: 8px;
             background: {urgency_color}18; border-right: 4px solid {urgency_color};">
          <strong>נותרו {days} ימים בלבד לחידוש!</strong>
        </div>
        <p style="color: #555;">לחידוש מיידי פנה אלינו:</p>
        <a href="mailto:{PLATFORM_ADMIN_EMAIL}"
           style="display: inline-block; background: #111; color: #fff; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: bold;">
          צור קשר לחידוש
        </a>
      </div>
      <div style="padding: 16px 30px; background: #f3f4f6; text-align: center;
           color: #9ca3af; font-size: 12px;">
        BizControl — מערכת ניהול עסק חכמה
      </div>
    </div>
    """


def _build_admin_html(studio_name: str, slug: str, owner_email: str, days: int, plan: str) -> str:
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;
         border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; color: #111;">
      <h3 style="margin: 0 0 16px;">&#x1F514; Plan Expiry Alert — {days} days</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #555;">Studio</td><td><strong>{studio_name}</strong></td></tr>
        <tr><td style="padding: 6px 0; color: #555;">Slug</td><td>{slug}</td></tr>
        <tr><td style="padding: 6px 0; color: #555;">Owner</td><td>{owner_email}</td></tr>
        <tr><td style="padding: 6px 0; color: #555;">Plan</td><td>{plan}</td></tr>
        <tr><td style="padding: 6px 0; color: #555;">Days left</td><td><strong style="color: #ef4444;">{days}</strong></td></tr>
      </table>
      <p style="margin-top: 16px; font-size: 13px; color: #6b7280;">
        Renew via the admin panel → Studios tab → Extend plan.
      </p>
    </div>
    """


async def _send_alert(studio: Studio, owner_email: str, days: int) -> None:
    if not all([PLATFORM_SMTP_HOST, PLATFORM_SMTP_USER, PLATFORM_SMTP_PASS]):
        logger.warning("Platform SMTP not configured — skipping plan expiry email for %s", studio.slug)
        return

    # Email to studio owner
    try:
        await send_email(
            host=PLATFORM_SMTP_HOST,
            port=PLATFORM_SMTP_PORT,
            user=PLATFORM_SMTP_USER,
            password=PLATFORM_SMTP_PASS,
            from_email=PLATFORM_SMTP_FROM,
            to_email=owner_email,
            subject=f"BizControl — המנוי שלך יפוג בעוד {days} ימים",
            html_content=_build_studio_html(studio.name, days, studio.subscription_plan),
        )
        logger.info("Expiry alert (%dd) sent to %s", days, owner_email)
    except Exception as e:
        logger.error("Failed to send expiry alert to %s: %s", owner_email, e)

    # Copy to platform admin
    try:
        await send_email(
            host=PLATFORM_SMTP_HOST,
            port=PLATFORM_SMTP_PORT,
            user=PLATFORM_SMTP_USER,
            password=PLATFORM_SMTP_PASS,
            from_email=PLATFORM_SMTP_FROM,
            to_email=PLATFORM_ADMIN_EMAIL,
            subject=f"[BizControl Admin] {studio.name} expires in {days}d",
            html_content=_build_admin_html(studio.name, studio.slug, owner_email, days, studio.subscription_plan),
        )
    except Exception as e:
        logger.error("Failed to send admin copy: %s", e)


def sweep_plan_expiry_alerts(db: Session) -> None:
    """Called daily by APScheduler. Checks all studios for upcoming expiry."""
    now = datetime.now(timezone.utc)

    for warn_days in WARN_DAYS:
        window_start = now + timedelta(days=warn_days) - timedelta(hours=WINDOW_HOURS)
        window_end   = now + timedelta(days=warn_days) + timedelta(hours=WINDOW_HOURS)

        studios = db.scalars(
            select(Studio).where(
                Studio.is_platform == False,  # noqa: E712
                Studio.is_active == True,      # noqa: E712
                Studio.plan_expires_at >= window_start,
                Studio.plan_expires_at <= window_end,
            )
        ).all()

        for studio in studios:
            owner = db.scalar(
                select(User).where(
                    User.studio_id == studio.id,
                    User.role == "owner",
                    User.is_active == True,  # noqa: E712
                )
            )
            if not owner:
                continue

            import asyncio
            try:
                asyncio.get_event_loop().run_until_complete(
                    _send_alert(studio, owner.email, warn_days)
                )
            except RuntimeError:
                # Already inside an event loop (shouldn't happen in scheduler thread)
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    pool.submit(
                        lambda: asyncio.run(_send_alert(studio, owner.email, warn_days))
                    ).result()
