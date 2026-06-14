"""
Email Center Routes

Superadmin:
  GET/PUT /api/email-center/system         — global settings
  GET     /api/email-center/logs           — all logs (paginated)
  GET     /api/email-center/stats          — platform-wide stats
  POST    /api/email-center/test           — send a test email

Studio (owner/admin):
  GET/PUT /api/email-center/studio         — studio reply-to + signature
  GET     /api/email-center/studio/logs    — studio's own email log
  GET     /api/email-center/studio/stats   — studio's own stats
"""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.services.email_center import get_system_settings, send_email

router = APIRouter(prefix="/email-center", tags=["EmailCenter"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class SystemSettingsIn(BaseModel):
    provider: str = "resend"
    api_key: Optional[str] = None
    domain: Optional[str] = None
    system_email: Optional[str] = None
    notification_email: Optional[str] = None
    support_email: Optional[str] = None
    reply_email_default: Optional[str] = None
    email_sending_enabled: bool = True
    marketing_emails_enabled: bool = True
    appointment_emails_enabled: bool = True
    invoice_emails_enabled: bool = True


class StudioEmailSettingsIn(BaseModel):
    reply_to_email: Optional[str] = None
    business_signature: Optional[str] = None


class TestEmailIn(BaseModel):
    to_email: str
    studio_id: Optional[str] = None


# ── Superadmin helpers ────────────────────────────────────────────────────────

def _require_superadmin(ctx: AuthContext):
    if ctx.role != "superadmin":
        raise HTTPException(403, "נדרשת הרשאת סופר-אדמין")


# ── Superadmin: System Settings ───────────────────────────────────────────────

@router.get("/system")
def get_system(ctx: AuthContext = Depends(require_studio_ctx), db: Session = Depends(get_db)):
    _require_superadmin(ctx)
    s = get_system_settings(db)
    # Mask API key
    if s.get("api_key"):
        s["api_key_masked"] = s["api_key"][:8] + "..." + s["api_key"][-4:]
    else:
        s["api_key_masked"] = None
    return s


@router.put("/system")
def update_system(
    body: SystemSettingsIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    _require_superadmin(ctx)

    if body.provider not in ("resend", "mailgun", "ses"):
        raise HTTPException(400, "ספק לא נתמך")

    current = get_system_settings(db)
    # Don't overwrite api_key if not provided
    api_key = body.api_key if body.api_key and not body.api_key.startswith("re_...") else current.get("api_key")

    db.execute(
        text("""
            UPDATE email_system_settings SET
                provider               = :provider,
                api_key                = :api_key,
                domain                 = :domain,
                system_email           = :system_email,
                notification_email     = :notification_email,
                support_email          = :support_email,
                reply_email_default    = :reply_email_default,
                email_sending_enabled       = :email_sending_enabled,
                marketing_emails_enabled    = :marketing_emails_enabled,
                appointment_emails_enabled  = :appointment_emails_enabled,
                invoice_emails_enabled      = :invoice_emails_enabled,
                updated_at             = NOW()
            WHERE id = 1
        """),
        {
            "provider":                    body.provider,
            "api_key":                     api_key,
            "domain":                      body.domain or current.get("domain"),
            "system_email":                body.system_email or current.get("system_email"),
            "notification_email":          body.notification_email or current.get("notification_email"),
            "support_email":               body.support_email or current.get("support_email"),
            "reply_email_default":         body.reply_email_default or current.get("reply_email_default"),
            "email_sending_enabled":       body.email_sending_enabled,
            "marketing_emails_enabled":    body.marketing_emails_enabled,
            "appointment_emails_enabled":  body.appointment_emails_enabled,
            "invoice_emails_enabled":      body.invoice_emails_enabled,
        }
    )
    db.commit()
    return {"ok": True}


# ── Superadmin: Test Send ─────────────────────────────────────────────────────

@router.post("/test")
def send_test_email(
    body: TestEmailIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    _require_superadmin(ctx)

    from app.utils.email_templates import _email_base
    html = _email_base(
        "בדיקת מייל — BizControl",
        """
        <p style="font-size:16px; color:#1a1a2e; font-weight:bold;">✅ מייל הבדיקה הגיע בהצלחה!</p>
        <p style="color:#64748b;">אם קיבלת הודעה זו, מערכת המייל המרכזית של BizControl פועלת כהלכה.</p>
        <table style="margin-top:16px; font-size:13px; color:#475569;">
          <tr><td style="padding:4px 12px 4px 0; font-weight:600;">ספק:</td><td>%(provider)s</td></tr>
          <tr><td style="padding:4px 12px 4px 0; font-weight:600;">נשלח אל:</td><td>%(to)s</td></tr>
        </table>
        """ % {"provider": get_system_settings(db).get("provider", "?"), "to": body.to_email}
    )

    ok = send_email(
        db,
        to_email=body.to_email,
        subject="🧪 בדיקת מייל — BizControl Email Center",
        html_content=html,
        from_name="BizControl",
        template_key="test_email",
        email_type="system",
    )
    if not ok:
        raise HTTPException(502, "שליחת מייל נכשלה — בדוק הגדרות ספק ומפתח API")
    return {"ok": True, "sent_to": body.to_email}


# ── Superadmin: Logs ──────────────────────────────────────────────────────────

@router.get("/logs")
def get_all_logs(
    limit: int = 100,
    offset: int = 0,
    studio_id: Optional[str] = None,
    status: Optional[str] = None,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    _require_superadmin(ctx)

    where = ["1=1"]
    params: dict = {"limit": limit, "offset": offset}
    if studio_id:
        where.append("l.studio_id = :studio_id")
        params["studio_id"] = studio_id
    if status:
        where.append("l.status = :status")
        params["status"] = status

    rows = db.execute(
        text(f"""
            SELECT l.*, s.name as studio_name
            FROM email_logs l
            LEFT JOIN studios s ON s.id = l.studio_id
            WHERE {' AND '.join(where)}
            ORDER BY l.sent_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params
    ).fetchall()

    total = db.execute(
        text(f"""
            SELECT COUNT(*) FROM email_logs l
            WHERE {' AND '.join(where)}
        """),
        {k: v for k, v in params.items() if k not in ("limit", "offset")}
    ).scalar()

    return {
        "items": [dict(r._mapping) for r in rows],
        "total": total,
    }


# ── Superadmin: Stats ─────────────────────────────────────────────────────────

@router.get("/stats")
def get_platform_stats(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    _require_superadmin(ctx)

    total = db.execute(text("SELECT COUNT(*) FROM email_logs")).scalar() or 0
    sent  = db.execute(text("SELECT COUNT(*) FROM email_logs WHERE status='sent'")).scalar() or 0
    failed = db.execute(text("SELECT COUNT(*) FROM email_logs WHERE status='failed'")).scalar() or 0

    by_template = db.execute(text("""
        SELECT template_key, COUNT(*) as cnt
        FROM email_logs
        GROUP BY template_key
        ORDER BY cnt DESC LIMIT 20
    """)).fetchall()

    by_studio = db.execute(text("""
        SELECT s.name, COUNT(l.id) as cnt
        FROM email_logs l
        LEFT JOIN studios s ON s.id = l.studio_id
        GROUP BY s.name ORDER BY cnt DESC LIMIT 20
    """)).fetchall()

    by_month = db.execute(text("""
        SELECT TO_CHAR(sent_at, 'YYYY-MM') as month, COUNT(*) as cnt
        FROM email_logs
        GROUP BY month ORDER BY month DESC LIMIT 12
    """)).fetchall()

    return {
        "total": total,
        "sent": sent,
        "failed": failed,
        "success_rate": round(sent / total * 100, 1) if total else 0,
        "by_template": [dict(r._mapping) for r in by_template],
        "by_studio":   [dict(r._mapping) for r in by_studio],
        "by_month":    [dict(r._mapping) for r in by_month],
    }


# ── Studio: Email Settings ────────────────────────────────────────────────────

@router.get("/studio")
def get_studio_settings(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(403, "אין הרשאה")

    row = db.execute(
        text("SELECT * FROM studio_email_settings WHERE studio_id = :sid"),
        {"sid": ctx.studio_id}
    ).fetchone()
    return dict(row._mapping) if row else {"studio_id": str(ctx.studio_id), "reply_to_email": None, "business_signature": None}


@router.put("/studio")
def update_studio_settings(
    body: StudioEmailSettingsIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(403, "אין הרשאה")

    db.execute(
        text("""
            INSERT INTO studio_email_settings (studio_id, reply_to_email, business_signature, updated_at)
            VALUES (:sid, :rte, :sig, NOW())
            ON CONFLICT (studio_id) DO UPDATE SET
                reply_to_email     = EXCLUDED.reply_to_email,
                business_signature = EXCLUDED.business_signature,
                updated_at         = NOW()
        """),
        {"sid": ctx.studio_id, "rte": body.reply_to_email, "sig": body.business_signature}
    )
    db.commit()
    return {"ok": True}


# ── Studio: Own Logs ──────────────────────────────────────────────────────────

@router.get("/studio/logs")
def get_studio_logs(
    limit: int = 50,
    offset: int = 0,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(403, "אין הרשאה")

    rows = db.execute(
        text("""
            SELECT * FROM email_logs
            WHERE studio_id = :sid
            ORDER BY sent_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {"sid": ctx.studio_id, "limit": limit, "offset": offset}
    ).fetchall()

    total = db.execute(
        text("SELECT COUNT(*) FROM email_logs WHERE studio_id = :sid"),
        {"sid": ctx.studio_id}
    ).scalar()

    return {"items": [dict(r._mapping) for r in rows], "total": total}


# ── Studio: Own Stats ─────────────────────────────────────────────────────────

@router.get("/studio/stats")
def get_studio_stats(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if ctx.role not in ("owner", "admin", "superadmin"):
        raise HTTPException(403, "אין הרשאה")

    sid = str(ctx.studio_id)
    total  = db.execute(text("SELECT COUNT(*) FROM email_logs WHERE studio_id=:s"), {"s": sid}).scalar() or 0
    sent   = db.execute(text("SELECT COUNT(*) FROM email_logs WHERE studio_id=:s AND status='sent'"), {"s": sid}).scalar() or 0
    failed = db.execute(text("SELECT COUNT(*) FROM email_logs WHERE studio_id=:s AND status='failed'"), {"s": sid}).scalar() or 0

    by_template = db.execute(text("""
        SELECT template_key, COUNT(*) as cnt
        FROM email_logs WHERE studio_id=:s
        GROUP BY template_key ORDER BY cnt DESC LIMIT 10
    """), {"s": sid}).fetchall()

    return {
        "total": total, "sent": sent, "failed": failed,
        "success_rate": round(sent / total * 100, 1) if total else 0,
        "by_template": [dict(r._mapping) for r in by_template],
    }
