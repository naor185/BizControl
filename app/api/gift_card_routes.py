"""
Gift Cards — create, send by email, redeem at POS, check balance.
"""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext

router = APIRouter(prefix="/gift-cards", tags=["GiftCards"])
public_router = APIRouter(prefix="/public/gift-cards", tags=["GiftCardsPublic"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _gen_code() -> str:
    """Generate a human-friendly 12-char code: XXXX-XXXX-XXXX."""
    chars = string.ascii_uppercase + string.digits
    raw = "".join(secrets.choice(chars) for _ in range(12))
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"


def _send_gift_card_email(
    recipient_email: str,
    recipient_name: str,
    sender_name: str,
    studio_name: str,
    amount_ils: float,
    code: str,
    message: Optional[str],
    expires_at: Optional[date],
) -> None:
    """Send a beautiful HTML gift card email."""
    import os, logging
    log = logging.getLogger(__name__)

    sendgrid_key = os.getenv("SENDGRID_API_KEY")
    smtp_host = os.getenv("SMTP_HOST")

    expiry_str = expires_at.strftime("%d/%m/%Y") if expires_at else "ללא תפוגה"
    msg_block = f"<p style='color:#64748b;font-size:15px;line-height:1.6;margin:16px 0;'>\"{message}\"</p>" if message else ""

    html = f"""
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#7c3aed,#4c1d95);padding:40px 32px;text-align:center;">
      <div style="font-size:48px;margin-bottom:8px;">🎁</div>
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:900;">כרטיס מתנה</h1>
      <p style="color:#c4b5fd;margin:8px 0 0;font-size:15px;">{studio_name}</p>
    </div>
    <!-- Body -->
    <div style="padding:32px;">
      <p style="font-size:16px;color:#334155;margin:0 0 8px;">שלום {recipient_name},</p>
      <p style="font-size:15px;color:#64748b;line-height:1.6;margin:0 0 24px;">
        {sender_name} שלח/ה לך כרטיס מתנה ל-{studio_name}!
      </p>
      {msg_block}
      <!-- Amount -->
      <div style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:2px solid #7c3aed;border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
        <div style="font-size:42px;font-weight:900;color:#7c3aed;">₪{amount_ils:.0f}</div>
        <div style="color:#6d28d9;font-size:14px;margin-top:4px;">שווי הכרטיס</div>
      </div>
      <!-- Code -->
      <div style="background:#1e1b4b;border-radius:14px;padding:20px;text-align:center;margin:24px 0;">
        <div style="color:#a78bfa;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">קוד המימוש שלך</div>
        <div style="color:#fff;font-size:28px;font-weight:900;letter-spacing:4px;font-family:monospace;">{code}</div>
      </div>
      <p style="font-size:13px;color:#94a3b8;text-align:center;">תוקף: {expiry_str}</p>
      <hr style="border:none;border-top:1px solid #f1f5f9;margin:24px 0;">
      <p style="font-size:13px;color:#64748b;text-align:center;">
        הצג/י את הקוד בעסק בזמן התשלום לניכוי האוטומטי מהסכום.
      </p>
    </div>
  </div>
</body>
</html>
"""

    subject = f"🎁 קיבלת כרטיס מתנה ל-{studio_name} בשווי ₪{amount_ils:.0f}"

    if sendgrid_key:
        try:
            import sendgrid as sg_lib
            from sendgrid.helpers.mail import Mail, Email, To, Content
            sg = sg_lib.SendGridAPIClient(api_key=sendgrid_key)
            mail = Mail(
                from_email=Email(os.getenv("SENDGRID_FROM_EMAIL", "noreply@bizcontrol.io"), studio_name),
                to_emails=To(recipient_email, recipient_name),
                subject=subject,
                html_content=Content("text/html", html),
            )
            sg.send(mail)
            return
        except Exception as e:
            log.warning(f"SendGrid failed: {e}")

    if smtp_host:
        try:
            import smtplib
            from email.mime.multipart import MIMEMultipart
            from email.mime.text import MIMEText
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = os.getenv("SMTP_FROM", "noreply@bizcontrol.io")
            msg["To"] = recipient_email
            msg.attach(MIMEText(html, "html", "utf-8"))
            port = int(os.getenv("SMTP_PORT", "587"))
            with smtplib.SMTP(smtp_host, port) as srv:
                srv.starttls()
                user = os.getenv("SMTP_USER", "")
                pwd = os.getenv("SMTP_PASS", "")
                if user: srv.login(user, pwd)
                srv.send_message(msg)
            return
        except Exception as e:
            log.warning(f"SMTP failed: {e}")

    log.info(f"[GiftCard] Code {code} → {recipient_email} (no mailer configured)")


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateGiftCardIn(BaseModel):
    amount_cents: int
    recipient_name: str
    recipient_email: Optional[str] = None
    recipient_phone: Optional[str] = None
    personal_message: Optional[str] = None
    expires_at: Optional[date] = None

class RedeemIn(BaseModel):
    code: str
    amount_cents: int
    client_id: Optional[str] = None
    pos_transaction_id: Optional[str] = None
    notes: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
def create_gift_card(
    body: CreateGiftCardIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    if body.amount_cents < 100:
        raise HTTPException(400, "סכום מינימלי: ₪1")

    # Get studio name
    studio = db.execute(
        text("SELECT name FROM studios WHERE id = :sid"),
        {"sid": str(ctx.studio_id)}
    ).fetchone()
    studio_name = studio[0] if studio else "הסטודיו"

    code = _gen_code()
    # Ensure uniqueness (retry on collision)
    for _ in range(5):
        existing = db.execute(text("SELECT id FROM gift_cards WHERE code = :c"), {"c": code}).fetchone()
        if not existing:
            break
        code = _gen_code()

    card_id = str(uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO gift_cards
                (id, studio_id, code, amount_cents, balance_cents,
                 recipient_name, recipient_email, recipient_phone,
                 sender_name, personal_message, status, expires_at, created_by)
            VALUES
                (:id, :sid, :code, :amount, :balance,
                 :rname, :remail, :rphone,
                 :sname, :msg, 'active', :exp, :uid)
        """),
        {
            "id": card_id, "sid": str(ctx.studio_id), "code": code,
            "amount": body.amount_cents, "balance": body.amount_cents,
            "rname": body.recipient_name.strip(),
            "remail": body.recipient_email, "rphone": body.recipient_phone,
            "sname": studio_name, "msg": body.personal_message,
            "exp": body.expires_at, "uid": str(ctx.user_id),
        }
    )
    db.commit()

    # Send email if provided
    if body.recipient_email:
        try:
            _send_gift_card_email(
                recipient_email=body.recipient_email,
                recipient_name=body.recipient_name,
                sender_name=studio_name,
                studio_name=studio_name,
                amount_ils=body.amount_cents / 100,
                code=code,
                message=body.personal_message,
                expires_at=body.expires_at,
            )
        except Exception:
            pass  # Don't fail on email error

    row = db.execute(text("SELECT * FROM gift_cards WHERE id = :id"), {"id": card_id}).fetchone()
    return _card_to_dict(row)


@router.get("")
def list_gift_cards(
    status: Optional[str] = None,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    where = "studio_id = :sid"
    params: dict = {"sid": str(ctx.studio_id)}
    if status:
        where += " AND status = :status"
        params["status"] = status

    rows = db.execute(
        text(f"SELECT * FROM gift_cards WHERE {where} ORDER BY created_at DESC LIMIT 100"),
        params
    ).fetchall()
    return [_card_to_dict(r) for r in rows]


@router.get("/{card_id}")
def get_gift_card(
    card_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text("SELECT * FROM gift_cards WHERE id = :id AND studio_id = :sid"),
        {"id": card_id, "sid": str(ctx.studio_id)}
    ).fetchone()
    if not row:
        raise HTTPException(404, "כרטיס לא נמצא")

    txns = db.execute(
        text("SELECT * FROM gift_card_transactions WHERE gift_card_id = :id ORDER BY created_at DESC"),
        {"id": card_id}
    ).fetchall()

    d = _card_to_dict(row)
    d["transactions"] = [dict(t._mapping) for t in txns]
    return d


@router.post("/{card_id}/cancel")
def cancel_gift_card(
    card_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text("SELECT status FROM gift_cards WHERE id = :id AND studio_id = :sid"),
        {"id": card_id, "sid": str(ctx.studio_id)}
    ).fetchone()
    if not row:
        raise HTTPException(404, "כרטיס לא נמצא")
    if row[0] == "used":
        raise HTTPException(400, "לא ניתן לבטל כרטיס שנוצל במלואו")

    db.execute(
        text("UPDATE gift_cards SET status='canceled' WHERE id=:id"),
        {"id": card_id}
    )
    db.commit()
    return {"ok": True}


@router.post("/redeem")
def redeem_gift_card(
    body: RedeemIn,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Redeem (partially or fully) a gift card. Returns new balance."""
    code = body.code.strip().upper().replace(" ", "")
    row = db.execute(
        text("SELECT * FROM gift_cards WHERE code = :code AND studio_id = :sid"),
        {"code": code, "sid": str(ctx.studio_id)}
    ).fetchone()

    if not row:
        raise HTTPException(404, "קוד לא תקין")

    card = dict(row._mapping)

    if card["status"] == "canceled":
        raise HTTPException(400, "כרטיס זה בוטל")
    if card["status"] == "used":
        raise HTTPException(400, "כרטיס זה כבר נוצל במלואו")
    if card["expires_at"] and date.today() > card["expires_at"]:
        raise HTTPException(400, "תוקף כרטיס זה פג")

    balance_before = card["balance_cents"]
    if balance_before <= 0:
        raise HTTPException(400, "אין יתרה בכרטיס")

    deduct = min(body.amount_cents, balance_before)
    balance_after = balance_before - deduct
    new_status = "used" if balance_after == 0 else "active"

    db.execute(
        text("""
            UPDATE gift_cards SET balance_cents=:bal, status=:st, last_used_at=NOW()
            WHERE id=:id
        """),
        {"bal": balance_after, "st": new_status, "id": str(card["id"])}
    )
    db.execute(
        text("""
            INSERT INTO gift_card_transactions
                (id, gift_card_id, studio_id, amount_cents,
                 balance_before_cents, balance_after_cents,
                 redeemed_by_client_id, pos_transaction_id, notes)
            VALUES (:id, :cid, :sid, :amt, :bef, :aft, :cli, :pos, :notes)
        """),
        {
            "id": str(uuid.uuid4()), "cid": str(card["id"]),
            "sid": str(ctx.studio_id), "amt": deduct,
            "bef": balance_before, "aft": balance_after,
            "cli": body.client_id, "pos": body.pos_transaction_id,
            "notes": body.notes,
        }
    )
    db.commit()

    return {
        "ok": True,
        "code": code,
        "deducted_cents": deduct,
        "deducted_ils": round(deduct / 100, 2),
        "balance_before_ils": round(balance_before / 100, 2),
        "balance_after_ils": round(balance_after / 100, 2),
        "status": new_status,
        "recipient_name": card.get("recipient_name"),
    }


# ── Public: check balance ─────────────────────────────────────────────────────

@public_router.get("/{code}")
def public_check_balance(code: str, db: Session = Depends(get_db)):
    """Public endpoint — customer checks their gift card balance."""
    clean = code.strip().upper().replace(" ", "")
    row = db.execute(
        text("""
            SELECT gc.code, gc.balance_cents, gc.amount_cents, gc.status,
                   gc.expires_at, gc.recipient_name, s.name AS studio_name
            FROM gift_cards gc
            JOIN studios s ON s.id = gc.studio_id
            WHERE gc.code = :code
        """),
        {"code": clean}
    ).fetchone()

    if not row:
        raise HTTPException(404, "קוד לא תקין")

    expired = row[3] != "canceled" and row[4] and date.today() > row[4]

    return {
        "code": row[0],
        "balance_ils": round(row[1] / 100, 2),
        "original_amount_ils": round(row[2] / 100, 2),
        "status": "expired" if expired else row[3],
        "expires_at": row[4].isoformat() if row[4] else None,
        "recipient_name": row[5],
        "studio_name": row[6],
    }


# ── Helper ────────────────────────────────────────────────────────────────────

def _card_to_dict(row) -> dict:
    d = dict(row._mapping)
    d["amount_ils"] = round((d.get("amount_cents") or 0) / 100, 2)
    d["balance_ils"] = round((d.get("balance_cents") or 0) / 100, 2)
    d["used_ils"] = round(((d.get("amount_cents") or 0) - (d.get("balance_cents") or 0)) / 100, 2)
    d["pct_used"] = round(d["used_ils"] / d["amount_ils"] * 100) if d["amount_ils"] > 0 else 0
    expires = d.get("expires_at")
    if expires and isinstance(expires, date):
        d["is_expired"] = date.today() > expires
        d["expires_at"] = expires.isoformat()
    else:
        d["is_expired"] = False
    return d
