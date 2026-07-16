"""
Gift Cards — create, send by email, redeem at POS, check balance.
"""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone, date, timedelta
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
    db: Session,
    recipient_email: str,
    recipient_name: str,
    sender_name: str,
    studio_name: str,
    amount_ils: float,
    code: str,
    message: Optional[str],
    expires_at: Optional[date],
    voucher_url: Optional[str] = None,
) -> None:
    """Send a beautiful HTML gift card email via the centralized Email Center."""
    import logging
    log = logging.getLogger(__name__)

    expiry_str = expires_at.strftime("%d/%m/%Y") if expires_at else "ללא תפוגה"
    msg_block = f"<p style='color:#64748b;font-size:15px;line-height:1.6;margin:16px 0;'>\"{message}\"</p>" if message else ""
    voucher_block = (
        f"<div style='text-align:center;margin:24px 0;'><img src='{voucher_url}' alt='שובר מתנה' style='max-width:100%;border-radius:16px;'/></div>"
        if voucher_url and voucher_url.startswith("http") else ""
    )

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
      {voucher_block}
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

    try:
        from app.services.email_center import send_email as _ec_send_email
        _ec_send_email(
            db, to_email=recipient_email, subject=subject, html_content=html,
            from_name=studio_name, email_type="system", template_key="gift_card",
        )
    except Exception as e:
        log.warning(f"[GiftCard] Email Center send failed: {e}")


# ── Voucher image ─────────────────────────────────────────────────────────────

def _h(text: str) -> str:
    """Reshape Hebrew (RTL) text for correct left-to-right glyph drawing order."""
    if not text:
        return ""
    try:
        from bidi.algorithm import get_display
        return get_display(str(text))
    except Exception:
        return str(text)


def _build_gift_card_voucher_png(
    studio_name: str,
    recipient_name: str,
    amount_ils: float,
    code: str,
    personal_message: Optional[str],
    expires_at: Optional[date],
    bonus_ils: float = 0,
) -> bytes:
    """Draw a portrait-free landscape gift-card voucher as a PNG (not a PDF) so
    it previews inline as a photo on WhatsApp instead of a document icon."""
    import io
    from PIL import Image, ImageDraw, ImageFont
    from app.api.invoice_routes import _find_font_path

    W, H = 1200, 750
    top = (124, 58, 237)     # #7c3aed
    bottom = (76, 29, 149)   # #4c1d95

    img = Image.new("RGB", (W, H), top)
    draw = ImageDraw.Draw(img)
    for y in range(H):
        ratio = y / H
        r = int(top[0] + (bottom[0] - top[0]) * ratio)
        g = int(top[1] + (bottom[1] - top[1]) * ratio)
        b = int(top[2] + (bottom[2] - top[2]) * ratio)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    reg_path = _find_font_path(bold=False)
    bold_path = _find_font_path(bold=True) or reg_path

    def font(size: int, bold: bool = False):
        path = bold_path if bold else reg_path
        if path:
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
        return ImageFont.load_default()

    def center_text(y: int, text: str, f, fill):
        t = _h(text)
        bbox = draw.textbbox((0, 0), t, font=f)
        w = bbox[2] - bbox[0]
        draw.text(((W - w) / 2, y), t, font=f, fill=fill)

    center_text(60, "כרטיס מתנה", font(56, bold=True), (255, 255, 255))
    center_text(140, studio_name, font(30), (196, 181, 253))

    # White card panel
    pad = 60
    panel_top = 220
    draw.rounded_rectangle([pad, panel_top, W - pad, H - pad], radius=28, fill=(255, 255, 255))

    center_text(panel_top + 40, f"עבור: {recipient_name}", font(34, bold=True), (30, 41, 59))
    center_text(panel_top + 100, f"₪{amount_ils:.0f}", font(84, bold=True), (124, 58, 237))
    if bonus_ils > 0:
        center_text(panel_top + 210, f"כולל בונוס של ₪{bonus_ils:.0f}!", font(20, bold=True), (16, 163, 74))
    else:
        center_text(panel_top + 210, "שווי הכרטיס", font(22), (109, 40, 217))

    if personal_message:
        # Simple word-wrap for the personal message
        f_msg = font(24)
        words = _h(personal_message).split(" ")
        lines, line = [], ""
        for w in words:
            trial = f"{line} {w}".strip()
            if draw.textbbox((0, 0), trial, font=f_msg)[2] > W - 2 * pad - 80:
                lines.append(line)
                line = w
            else:
                line = trial
        if line:
            lines.append(line)
        y = panel_top + 250
        for ln in lines[:3]:
            bbox = draw.textbbox((0, 0), ln, font=f_msg)
            draw.text(((W - (bbox[2] - bbox[0])) / 2, y), ln, font=f_msg, fill=(100, 116, 139))
            y += 32

    # Code box
    code_top = H - pad - 130
    draw.rounded_rectangle([pad + 40, code_top, W - pad - 40, code_top + 90], radius=16, fill=(30, 27, 75))
    code_display = code  # left-to-right by design, no bidi reshape needed
    f_code = font(38, bold=True)
    bbox = draw.textbbox((0, 0), code_display, font=f_code)
    draw.text(((W - (bbox[2] - bbox[0])) / 2, code_top + 25), code_display, font=f_code, fill=(255, 255, 255))

    expiry_str = expires_at.strftime("%d/%m/%Y") if expires_at else "ללא תפוגה"
    center_text(H - pad - 25, f"בתוקף עד {expiry_str}", font(20), (148, 163, 184))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _save_voucher_image(image_bytes: bytes, studio_id: str, db=None) -> Optional[str]:
    """Save the voucher PNG — Cloudinary if configured, otherwise local uploads/.
    Mirrors app/api/expense_routes.py's _save_receipt_image fallback pattern."""
    import logging
    log = logging.getLogger(__name__)
    public_id = f"voucher_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    try:
        from app.api.upload_routes import _cloudinary_upload
        cloud_url = _cloudinary_upload(image_bytes, folder=f"gift-vouchers/{studio_id}", public_id=public_id, db=db)
        if cloud_url:
            return cloud_url
    except Exception as e:
        log.debug("Cloudinary not available: %s", e)
    try:
        import os
        upload_dir = os.path.join("uploads", "gift-vouchers", studio_id)
        os.makedirs(upload_dir, exist_ok=True)
        fname = f"{public_id}.png"
        with open(os.path.join(upload_dir, fname), "wb") as fh:
            fh.write(image_bytes)
        return f"/uploads/gift-vouchers/{studio_id}/{fname}"
    except Exception as e:
        log.warning("Could not save voucher image: %s", e)
        return None


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

class PublicGiftCardOrderIn(BaseModel):
    amount_cents: int
    recipient_name: str
    recipient_phone: Optional[str] = None
    personal_message: Optional[str] = None
    buyer_name: str
    buyer_email: Optional[str] = None
    buyer_phone: str
    deliver_to: str = "buyer"  # "buyer" | "recipient"


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
                db,
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


@router.post("/{card_id}/approve-payment")
def approve_gift_card_payment(
    card_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Staff confirms a Bit payment was received for a public gift-card order
    — activates the card and delivers the code + voucher image by email and
    WhatsApp to the buyer or the recipient (per the order's deliver_to)."""
    import logging
    log = logging.getLogger(__name__)

    row = db.execute(
        text("SELECT * FROM gift_cards WHERE id = :id AND studio_id = :sid"),
        {"id": card_id, "sid": str(ctx.studio_id)}
    ).fetchone()
    if not row:
        raise HTTPException(404, "כרטיס לא נמצא")
    card = dict(row._mapping)
    if card["status"] != "pending_payment":
        raise HTTPException(400, "כרטיס זה אינו ממתין לאישור תשלום")

    db.execute(text("UPDATE gift_cards SET status='active' WHERE id=:id"), {"id": card_id})
    db.commit()

    if card.get("deliver_to") == "recipient":
        target_name = card.get("recipient_name")
        target_email = card.get("recipient_email")
        target_phone = card.get("recipient_phone")
    else:
        target_name = card.get("buyer_name")
        target_email = card.get("buyer_email")
        target_phone = card.get("buyer_phone")

    studio_row = db.execute(text("SELECT name FROM studios WHERE id = :sid"), {"sid": str(ctx.studio_id)}).fetchone()
    studio_name = studio_row[0] if studio_row else "הסטודיו"

    voucher_url = None
    try:
        png_bytes = _build_gift_card_voucher_png(
            studio_name=studio_name,
            recipient_name=card.get("recipient_name") or "",
            amount_ils=card["amount_cents"] / 100,
            code=card["code"],
            personal_message=card.get("personal_message"),
            expires_at=card.get("expires_at"),
            bonus_ils=(card.get("bonus_cents") or 0) / 100,
        )
        voucher_url = _save_voucher_image(png_bytes, str(ctx.studio_id), db=db)
    except Exception:
        log.exception("[GiftCard] voucher image build/save failed for %s", card_id)

    if target_email:
        try:
            _send_gift_card_email(
                db,
                recipient_email=target_email,
                recipient_name=target_name or "",
                sender_name=studio_name,
                studio_name=studio_name,
                amount_ils=card["amount_cents"] / 100,
                code=card["code"],
                message=card.get("personal_message"),
                expires_at=card.get("expires_at"),
                voucher_url=voucher_url,
            )
        except Exception:
            log.exception("[GiftCard] confirmation email failed for %s", card_id)

    if target_phone:
        try:
            from sqlalchemy import select as _select
            from app.models.client import Client
            from app.models.message_job import MessageJob

            client = db.scalar(_select(Client).where(
                Client.studio_id == ctx.studio_id, Client.phone == target_phone,
            ))
            if not client and target_email:
                client = db.scalar(_select(Client).where(
                    Client.studio_id == ctx.studio_id, Client.email == target_email,
                ))
            if not client:
                client = Client(
                    id=uuid.uuid4(),
                    studio_id=ctx.studio_id,
                    full_name=target_name or "לקוח",
                    phone=target_phone,
                    email=target_email,
                    notes="נרשם דרך רכישת כרטיס מתנה",
                )
                db.add(client)
                db.flush()

            bonus_line = f"\n🎉 כולל בונוס של ₪{card['bonus_cents'] / 100:.0f}!" if card.get("bonus_cents") else ""
            wa_body = (
                f"🎁 כרטיס המתנה שלך ל-{studio_name} מוכן!\n"
                f"שווי: ₪{card['amount_cents'] / 100:.0f}{bonus_line}\n"
                f"קוד המימוש: {card['code']}"
            )
            db.add(MessageJob(
                studio_id=ctx.studio_id,
                client_id=client.id,
                channel="whatsapp",
                to_phone=target_phone,
                body=wa_body,
                media_url=voucher_url,
                scheduled_at=datetime.now(timezone.utc),
                status="pending",
                reminder_type="gift_card_voucher",
            ))
            db.commit()
        except Exception:
            log.exception("[GiftCard] failed to queue WhatsApp voucher for %s", card_id)

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

    if card["status"] != "active":
        raise HTTPException(400, "כרטיס זה אינו זמין למימוש")
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


# ── Public: gift-card shop (self-service purchase page) ───────────────────────

@public_router.get("/shop/{studio_id}")
def public_gift_card_shop_info(studio_id: str, db: Session = Depends(get_db)):
    """Public — branding + payment instructions for the purchase landing page.
    Logo can live in one of three places depending on which upload path was
    used historically (Cloudinary vs local-disk fallback) — studios.logo_url
    and marketplace_profiles.logo_url are both absolute URLs when set;
    studio_settings.logo_filename is a bare filename under /uploads/ that the
    frontend must prefix itself. Try them in that priority order."""
    row = db.execute(
        text("""
            SELECT s.name, COALESCE(s.logo_url, mp.logo_url) AS logo_url, ss.logo_filename,
                   ss.bit_link, ss.paybox_link,
                   ss.gift_card_min_amount_cents, ss.gift_card_max_amount_cents
            FROM studios s
            LEFT JOIN studio_settings ss ON ss.studio_id = s.id
            LEFT JOIN marketplace_profiles mp ON mp.studio_id = s.id
            WHERE s.id = :sid AND s.is_active = true
        """),
        {"sid": studio_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "עסק לא נמצא")
    return {
        "studio_name": row[0],
        "logo_url": row[1],
        "logo_filename": row[2],
        "bit_link": row[3],
        "paybox_link": row[4],
        "min_amount_cents": row[5] if row[5] is not None else 100,
        "max_amount_cents": row[6] if row[6] is not None else 0,
    }


@public_router.post("/order/{studio_id}", status_code=201)
def public_create_gift_card_order(studio_id: str, body: PublicGiftCardOrderIn, db: Session = Depends(get_db)):
    """Public — customer places a gift-card order. Card is created as
    'pending_payment' and is NOT redeemable until staff confirms the Bit
    payment via POST /gift-cards/{id}/approve-payment."""
    if body.deliver_to not in ("buyer", "recipient"):
        raise HTTPException(400, "ערך לא חוקי ל-deliver_to")
    if not body.recipient_name.strip():
        raise HTTPException(400, "שם הנמען נדרש")
    if not body.buyer_name.strip() or not body.buyer_phone.strip():
        raise HTTPException(400, "שם וטלפון הקונה נדרשים")

    studio = db.execute(
        text("SELECT name FROM studios WHERE id = :sid AND is_active = true"),
        {"sid": studio_id}
    ).fetchone()
    if not studio:
        raise HTTPException(404, "עסק לא נמצא")
    studio_name = studio[0]

    settings_row = db.execute(
        text("""
            SELECT gift_card_bonus_enabled, gift_card_bonus_threshold_cents, gift_card_bonus_percent,
                   gift_card_min_amount_cents, gift_card_max_amount_cents
            FROM studio_settings WHERE studio_id = :sid
        """),
        {"sid": studio_id}
    ).fetchone()
    min_cents = (settings_row[3] if settings_row and settings_row[3] is not None else 100)
    max_cents = (settings_row[4] if settings_row and settings_row[4] is not None else 0)

    if body.amount_cents < min_cents:
        raise HTTPException(400, f"סכום מינימלי לכרטיס מתנה אצל {studio_name}: ₪{min_cents/100:.0f}")
    if max_cents > 0 and body.amount_cents > max_cents:
        raise HTTPException(400, f"סכום מקסימלי לכרטיס מתנה אצל {studio_name}: ₪{max_cents/100:.0f}")

    buyer_phone = body.buyer_phone.strip()

    # Duplicate-submit guard — same buyer, still-pending order in the last 10 minutes
    ten_min_ago = datetime.now(timezone.utc) - timedelta(minutes=10)
    dup = db.execute(
        text("""
            SELECT id FROM gift_cards
            WHERE studio_id = :sid AND buyer_phone = :phone AND status = 'pending_payment'
              AND created_at >= :since
            ORDER BY created_at DESC LIMIT 1
        """),
        {"sid": studio_id, "phone": buyer_phone, "since": ten_min_ago}
    ).fetchone()
    if dup:
        return {"ok": True, "amount_ils": round(body.amount_cents / 100, 2)}

    # Studio-configured bonus: e.g. "orders over ₪500 get 10% extra value"
    bonus_cents = 0
    if settings_row and settings_row[0] and body.amount_cents >= (settings_row[1] or 0):
        bonus_cents = round(body.amount_cents * (settings_row[2] or 0) / 100)
    face_value_cents = body.amount_cents + bonus_cents

    code = _gen_code()
    for _ in range(5):
        existing = db.execute(text("SELECT id FROM gift_cards WHERE code = :c"), {"c": code}).fetchone()
        if not existing:
            break
        code = _gen_code()

    expires = date.today() + timedelta(days=365)
    card_id = str(uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO gift_cards
                (id, studio_id, code, amount_cents, balance_cents, bonus_cents,
                 recipient_name, recipient_phone,
                 sender_name, personal_message, status, expires_at,
                 buyer_name, buyer_email, buyer_phone, deliver_to)
            VALUES
                (:id, :sid, :code, :amount, :balance, :bonus,
                 :rname, :rphone,
                 :sname, :msg, 'pending_payment', :exp,
                 :bname, :bemail, :bphone, :deliver)
        """),
        {
            "id": card_id, "sid": studio_id, "code": code,
            "amount": face_value_cents, "balance": face_value_cents, "bonus": bonus_cents,
            "rname": body.recipient_name.strip(), "rphone": body.recipient_phone,
            "sname": studio_name, "msg": body.personal_message, "exp": expires,
            "bname": body.buyer_name.strip(), "bemail": body.buyer_email,
            "bphone": buyer_phone, "deliver": body.deliver_to,
        }
    )
    db.commit()
    return {
        "ok": True,
        "amount_ils": round(body.amount_cents / 100, 2),
        "bonus_ils": round(bonus_cents / 100, 2),
    }


# ── Helper ────────────────────────────────────────────────────────────────────

def _card_to_dict(row) -> dict:
    d = dict(row._mapping)
    d["amount_ils"] = round((d.get("amount_cents") or 0) / 100, 2)
    d["balance_ils"] = round((d.get("balance_cents") or 0) / 100, 2)
    d["bonus_ils"] = round((d.get("bonus_cents") or 0) / 100, 2)
    d["used_ils"] = round(((d.get("amount_cents") or 0) - (d.get("balance_cents") or 0)) / 100, 2)
    d["pct_used"] = round(d["used_ils"] / d["amount_ils"] * 100) if d["amount_ils"] > 0 else 0
    expires = d.get("expires_at")
    if expires and isinstance(expires, date):
        d["is_expired"] = date.today() > expires
        d["expires_at"] = expires.isoformat()
    else:
        d["is_expired"] = False
    return d
