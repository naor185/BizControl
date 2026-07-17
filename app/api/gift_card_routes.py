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
from app.core.permissions import require_roles, Perms

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
  <div style="max-width:520px;margin:32px auto;background:linear-gradient(160deg,#161616,#0a0a0a);border:1px solid #c9a227;border-radius:24px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.4);">
    <!-- Header -->
    <div style="padding:40px 32px 24px;text-align:center;border-bottom:1px solid rgba(201,162,39,.25);">
      <div style="font-size:48px;margin-bottom:8px;">🎁</div>
      <h1 style="color:#e9c766;margin:0;font-size:26px;font-weight:900;">כרטיס מתנה</h1>
      <p style="color:#c7bfa8;margin:8px 0 0;font-size:15px;">{studio_name}</p>
    </div>
    <!-- Body -->
    <div style="padding:32px;">
      <p style="font-size:16px;color:#f3ede0;margin:0 0 8px;">איזה כיף, {recipient_name}! קיבלת מתנה 🎁</p>
      <p style="font-size:15px;color:#c7bfa8;line-height:1.6;margin:0 0 24px;">
        {sender_name} שלח/ה לך כרטיס מתנה ל-{studio_name}!
      </p>
      {msg_block}
      {voucher_block}
      <!-- Amount -->
      <div style="background:rgba(233,199,102,.06);border:2px solid #c9a227;border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
        <div style="font-size:42px;font-weight:900;color:#e9c766;">₪{amount_ils:.0f}</div>
        <div style="color:#c7bfa8;font-size:14px;margin-top:4px;">שווי הכרטיס</div>
      </div>
      <!-- Code -->
      <div style="background:linear-gradient(135deg,#e9c766,#a3791f);border-radius:14px;padding:20px;text-align:center;margin:24px 0;">
        <div style="color:#3a2e0a;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">קוד המימוש שלך</div>
        <div style="color:#141414;font-size:28px;font-weight:900;letter-spacing:4px;font-family:monospace;">{code}</div>
      </div>
      <p style="font-size:13px;color:#8a8270;text-align:center;">תוקף: {expiry_str}</p>
      <hr style="border:none;border-top:1px solid rgba(201,162,39,.2);margin:24px 0;">
      <p style="font-size:13px;color:#8a8270;text-align:center;">
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


def _fetch_studio_logo(logo_url: Optional[str], logo_filename: Optional[str]):
    """Load the studio's logo as a PIL RGBA image, trying the absolute-URL
    column first and falling back to the local /uploads/ file. Returns None
    (never raises) if no logo is configured or it can't be loaded."""
    import io
    import os
    import urllib.request
    from PIL import Image

    try:
        if logo_url and logo_url.startswith("http"):
            with urllib.request.urlopen(logo_url, timeout=4) as resp:
                return Image.open(io.BytesIO(resp.read())).convert("RGBA")
        if logo_filename:
            path = os.path.join("uploads", logo_filename)
            if os.path.exists(path):
                return Image.open(path).convert("RGBA")
    except Exception:
        pass
    return None


_VOUCHER_THEMES = {
    "black_gold": {
        "bg_top": (26, 26, 26), "bg_bottom": (5, 5, 5),
        "outer_border": (201, 162, 39),
        "banner_title": (233, 199, 102), "banner_sub": (243, 237, 224),
        "panel_fill": (22, 22, 22), "panel_border": (201, 162, 39),
        "panel_text": (243, 237, 224), "panel_muted": (199, 191, 168),
        "accent": (233, 199, 102),
        "code_fill": (233, 199, 102), "code_text": (20, 20, 20),
        "bonus_text": (110, 209, 158),
    },
    "purple_classic": {
        "bg_top": (124, 58, 237), "bg_bottom": (76, 29, 149),
        "outer_border": None,
        "banner_title": (255, 255, 255), "banner_sub": (196, 181, 253),
        "panel_fill": (255, 255, 255), "panel_border": None,
        "panel_text": (30, 41, 59), "panel_muted": (100, 116, 139),
        "accent": (124, 58, 237),
        "code_fill": (30, 27, 75), "code_text": (255, 255, 255),
        "bonus_text": (16, 163, 74),
    },
    "cream_rose": {
        "bg_top": (250, 240, 236), "bg_bottom": (235, 214, 206),
        "outer_border": (183, 110, 121),
        "banner_title": (120, 70, 75), "banner_sub": (150, 110, 105),
        "panel_fill": (255, 251, 249), "panel_border": (216, 180, 172),
        "panel_text": (74, 58, 55), "panel_muted": (150, 125, 118),
        "accent": (183, 110, 121),
        "code_fill": (183, 110, 121), "code_text": (255, 255, 255),
        "bonus_text": (150, 120, 40),
    },
}

VOUCHER_THEME_LABELS = {
    "black_gold": "שחור-זהב (VIP)",
    "purple_classic": "סגול קלאסי",
    "cream_rose": "שמנת-רוזגולד",
}


def _build_gift_card_voucher_png(
    studio_name: str,
    recipient_name: str,
    amount_ils: float,
    code: str,
    personal_message: Optional[str],
    expires_at: Optional[date],
    bonus_ils: float = 0,
    logo_image=None,
    theme: str = "black_gold",
) -> bytes:
    """Draw a portrait-free landscape gift-card voucher as a PNG (not a PDF) so
    it previews inline as a photo on WhatsApp instead of a document icon.
    `theme` picks one of _VOUCHER_THEMES — studio-configurable in settings."""
    import io
    from PIL import Image, ImageDraw, ImageFont
    from app.api.invoice_routes import _find_font_path

    th = _VOUCHER_THEMES.get(theme) or _VOUCHER_THEMES["black_gold"]
    W, H = 1200, 750

    img = Image.new("RGB", (W, H), th["bg_top"])
    draw = ImageDraw.Draw(img)
    for y in range(H):
        ratio = y / H
        r = int(th["bg_top"][0] + (th["bg_bottom"][0] - th["bg_top"][0]) * ratio)
        g = int(th["bg_top"][1] + (th["bg_bottom"][1] - th["bg_top"][1]) * ratio)
        b = int(th["bg_top"][2] + (th["bg_bottom"][2] - th["bg_top"][2]) * ratio)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    if th["outer_border"]:
        draw.rounded_rectangle([10, 10, W - 10, H - 10], radius=24, outline=th["outer_border"], width=4)

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

    title_y = 44
    if logo_image is not None:
        try:
            logo_h = 90
            ratio = logo_h / logo_image.height
            logo_w = int(logo_image.width * ratio)
            logo_resized = logo_image.resize((logo_w, logo_h))
            img.paste(logo_resized, ((W - logo_w) // 2, title_y), logo_resized)
            title_y += logo_h + 24
        except Exception:
            pass

    center_text(title_y, "כרטיס מתנה", font(50, bold=True), th["banner_title"])
    center_text(title_y + 68, studio_name, font(26), th["banner_sub"])

    # Inner content panel
    pad = 60
    panel_top = title_y + 128
    if th["panel_border"]:
        draw.rounded_rectangle([pad, panel_top, W - pad, H - pad], radius=24, fill=th["panel_fill"], outline=th["panel_border"], width=2)
    else:
        draw.rounded_rectangle([pad, panel_top, W - pad, H - pad], radius=24, fill=th["panel_fill"])

    center_text(panel_top + 36, f"איזה כיף, {recipient_name}! קיבלת מתנה 🎁", font(32, bold=True), th["panel_text"])
    center_text(panel_top + 96, f"₪{amount_ils:.0f}", font(80, bold=True), th["accent"])
    if bonus_ils > 0:
        center_text(panel_top + 200, f"כולל בונוס של ₪{bonus_ils:.0f}!", font(20, bold=True), th["bonus_text"])
    else:
        center_text(panel_top + 200, "שווי הכרטיס", font(22), th["panel_muted"])

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
        y = panel_top + 240
        for ln in lines[:3]:
            bbox = draw.textbbox((0, 0), ln, font=f_msg)
            draw.text(((W - (bbox[2] - bbox[0])) / 2, y), ln, font=f_msg, fill=th["panel_muted"])
            y += 32

    # Code box
    code_top = H - pad - 130
    draw.rounded_rectangle([pad + 40, code_top, W - pad - 40, code_top + 90], radius=16, fill=th["code_fill"])
    code_display = code  # left-to-right by design, no bidi reshape needed
    f_code = font(38, bold=True)
    bbox = draw.textbbox((0, 0), code_display, font=f_code)
    draw.text(((W - (bbox[2] - bbox[0])) / 2, code_top + 25), code_display, font=f_code, fill=th["code_text"])

    expiry_str = expires_at.strftime("%d/%m/%Y") if expires_at else "ללא תפוגה"
    center_text(H - pad - 25, f"בתוקף עד {expiry_str}", font(20), th["panel_muted"])

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


def _create_gift_card_invoice(db: Session, studio_id, card_id: str, code: str, client, paid_cents: int) -> str:
    """Create a receipt/tax-invoice for the amount a customer actually paid for
    a gift card (excluding any studio-funded bonus — that part isn't real
    revenue). Mirrors app.crud.payment._auto_create_invoice, adapted for gift
    cards which have no appointment."""
    settings_row = db.execute(
        text("SELECT * FROM invoice_settings WHERE studio_id = :sid"),
        {"sid": str(studio_id)},
    ).fetchone()
    settings = dict(settings_row._mapping) if settings_row else {}
    biz_type = settings.get("business_type", "osek_patur")

    studio_row = db.execute(
        text("SELECT name, logo_url FROM studios WHERE id = :sid"),
        {"sid": str(studio_id)},
    ).fetchone()
    studio_name = studio_row[0] if studio_row else ""
    studio_logo = studio_row[1] if studio_row else None

    # osek_patur → receipt; murshe/chevra_baam → invoice_tax_receipt
    doc_type = "receipt" if biz_type == "osek_patur" else "invoice_tax_receipt"

    result = db.execute(
        text("""
            INSERT INTO invoice_series (studio_id, doc_type, next_number)
            VALUES (:sid, :dt, 1001)
            ON CONFLICT (studio_id, doc_type)
            DO UPDATE SET next_number = invoice_series.next_number + 1
            RETURNING next_number - 1
        """),
        {"sid": str(studio_id), "dt": doc_type},
    ).fetchone()
    db.commit()
    doc_number = result[0]

    vat_rate = float(settings.get("vat_rate") or 18.0)
    if biz_type == "osek_patur":
        subtotal_cents = paid_cents
        vat_amount_cents = 0
        total_cents = paid_cents
    else:
        subtotal_cents = int(round(paid_cents / (1 + vat_rate / 100)))
        vat_amount_cents = paid_cents - subtotal_cents
        total_cents = paid_cents

    invoice_id = str(uuid.uuid4())
    db.execute(
        text("""
            INSERT INTO invoices (
                id, studio_id, doc_type, doc_number, status,
                client_id, client_name, client_phone,
                business_name, business_type, business_number,
                business_address, business_city, business_phone, business_email, business_logo_url,
                subtotal_cents, vat_rate, vat_amount_cents, total_cents, tip_cents,
                payment_method, source, source_id, appointment_id,
                issued_by_id, issued_at
            ) VALUES (
                :id, :sid, :dt, :dn, 'issued',
                :cid, :cname, :cphone,
                :bname, :btype, :bnum,
                :baddr, :bcity, :bphone, :bemail, :blogo,
                :sub, :vr, :vat, :total, 0,
                'other', 'gift_card', :src_id, NULL,
                NULL, NOW()
            )
        """),
        {
            "id": invoice_id, "sid": str(studio_id), "dt": doc_type, "dn": doc_number,
            "cid": str(client.id), "cname": client.full_name, "cphone": client.phone,
            "bname": settings.get("business_name") or studio_name,
            "btype": biz_type,
            "bnum": settings.get("business_number"),
            "baddr": settings.get("business_address"),
            "bcity": settings.get("business_city"),
            "bphone": settings.get("business_phone"),
            "bemail": settings.get("business_email"),
            "blogo": settings.get("logo_url") or studio_logo,
            "sub": subtotal_cents, "vr": vat_rate, "vat": vat_amount_cents, "total": total_cents,
            "src_id": card_id,
        },
    )
    db.execute(
        text("""
            INSERT INTO invoice_items
                (id, invoice_id, description, quantity, unit_price_cents, total_price_cents, sort_order)
            VALUES (:id, :inv, :desc, 1, :up, :tp, 0)
        """),
        {
            "id": str(uuid.uuid4()), "inv": invoice_id,
            "desc": f"כרטיס מתנה - {code}",
            "up": subtotal_cents, "tp": subtotal_cents,
        },
    )
    db.commit()
    return invoice_id


def _enqueue_gift_card_receipt_link(db: Session, studio_id, invoice_id: str, client) -> None:
    """Enqueue a WhatsApp/email message with the public receipt link for a
    gift-card purchase. Mirrors app.crud.payment._enqueue_receipt_link."""
    import os as _os
    from sqlalchemy import select as _select
    from app.models.message_job import MessageJob

    if getattr(client, "whatsapp_opted_out", False):
        return

    already = db.scalar(
        _select(MessageJob).where(
            MessageJob.reminder_type == "gift_card_receipt_link",
            MessageJob.body.like(f"%{invoice_id}%"),
        )
    )
    if already:
        return

    frontend_url = _os.getenv("FRONTEND_URL", "https://bizcontrol-seven.vercel.app").rstrip("/")
    receipt_url = f"{frontend_url}/receipt/{invoice_id}"
    now = datetime.now(timezone.utc)

    if client.phone:
        db.add(MessageJob(
            studio_id=studio_id,
            client_id=client.id,
            channel="whatsapp",
            to_phone=client.phone,
            body=f"🧾 הקבלה שלך עבור כרטיס המתנה:\n{receipt_url}",
            scheduled_at=now,
            status="pending",
            reminder_type="gift_card_receipt_link",
        ))

    if getattr(client, "email", None):
        from app.services.email_center import studio_email_allowed as _email_ok
        if _email_ok(db, studio_id, "email_receipt_enabled"):
            from app.utils.email_templates import _email_base
            email_html = (
                f"<p>שלום <strong>{client.full_name or ''}</strong>,</p>"
                f"<p>תודה על הרכישה! 🙏<br>הקבלה שלך עבור כרטיס המתנה מוכנה.</p>"
                f"<p style='margin:24px 0;'>"
                f"<a href='{receipt_url}' style='display:inline-block;background:#141414;color:#e9c766;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;'>🧾 צפה בקבלה</a>"
                f"</p>"
            )
            db.add(MessageJob(
                studio_id=studio_id,
                client_id=client.id,
                channel="email",
                to_phone=client.email,
                subject="🧾 הקבלה שלך עבור כרטיס המתנה",
                body=_email_base("הקבלה שלך מוכנה 🧾", email_html),
                scheduled_at=now,
                status="pending",
                reminder_type="gift_card_receipt_link_email",
            ))

    db.commit()


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

class ApprovePaymentIn(BaseModel):
    send_receipt: bool = True

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
    settings_row = db.execute(
        text("""
            SELECT gift_card_min_amount_cents, gift_card_max_amount_cents
            FROM studio_settings WHERE studio_id = :sid
        """),
        {"sid": str(ctx.studio_id)}
    ).fetchone()
    min_cents = (settings_row[0] if settings_row and settings_row[0] is not None else 100)
    max_cents = (settings_row[1] if settings_row and settings_row[1] is not None else 0)

    if body.amount_cents < min_cents:
        raise HTTPException(400, f"סכום מינימלי לכרטיס מתנה: ₪{min_cents/100:.0f}")
    if max_cents > 0 and body.amount_cents > max_cents:
        raise HTTPException(400, f"סכום מקסימלי לכרטיס מתנה: ₪{max_cents/100:.0f}")

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


@router.get("/preview-voucher")
def preview_gift_card_voucher(
    theme: Optional[str] = None,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Render a sample voucher with dummy data so a studio owner can see what
    a theme looks like (with their own logo) before choosing it in settings."""
    import base64

    if theme and theme not in _VOUCHER_THEMES:
        raise HTTPException(400, "עיצוב לא תקין")

    studio_row = db.execute(
        text("""
            SELECT s.name, COALESCE(s.logo_url, mp.logo_url) AS logo_url, ss.logo_filename, ss.gift_voucher_theme
            FROM studios s
            LEFT JOIN studio_settings ss ON ss.studio_id = s.id
            LEFT JOIN marketplace_profiles mp ON mp.studio_id = s.id
            WHERE s.id = :sid
        """),
        {"sid": str(ctx.studio_id)}
    ).fetchone()
    studio_name = studio_row[0] if studio_row else "הסטודיו שלי"
    logo_image = _fetch_studio_logo(studio_row[1] if studio_row else None, studio_row[2] if studio_row else None)
    chosen_theme = theme or (studio_row[3] if studio_row else None) or "black_gold"

    png_bytes = _build_gift_card_voucher_png(
        studio_name=studio_name,
        recipient_name="ישראל ישראלי",
        amount_ils=250,
        code="SAMP-LE12-3456",
        personal_message="מזל טוב ותודה שאת/ה חלק מהמשפחה שלנו!",
        expires_at=date.today() + timedelta(days=365),
        bonus_ils=25,
        logo_image=logo_image,
        theme=chosen_theme,
    )
    return {"image_b64": base64.b64encode(png_bytes).decode("ascii")}


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


@router.delete("/{card_id}", status_code=204, dependencies=[Depends(require_roles(Perms.OWNER, Perms.ADMIN))])
def delete_gift_card(
    card_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Permanently remove a gift card and its redemption history — e.g. to
    clean up a test purchase. Unlike /cancel (a soft status flip that keeps
    the row forever), this is a hard delete."""
    row = db.execute(
        text("SELECT id FROM gift_cards WHERE id = :id AND studio_id = :sid"),
        {"id": card_id, "sid": str(ctx.studio_id)}
    ).fetchone()
    if not row:
        raise HTTPException(404, "כרטיס לא נמצא")

    db.execute(text("DELETE FROM gift_card_transactions WHERE gift_card_id = :id"), {"id": card_id})
    db.execute(text("DELETE FROM gift_cards WHERE id = :id"), {"id": card_id})
    db.commit()
    return None


@router.post("/{card_id}/approve-payment")
def approve_gift_card_payment(
    card_id: str,
    body: ApprovePaymentIn = ApprovePaymentIn(),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db),
):
    """Staff confirms a Bit payment was received for a public gift-card order
    — activates the card, records the actual amount paid as revenue (in the
    register and as a receipt/tax-invoice), and delivers the code + voucher
    image by email and WhatsApp to the buyer or the recipient (per the
    order's deliver_to)."""
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

    # Resolve/create the buyer as a client — the receipt is issued to whoever
    # actually paid, regardless of who the gift card is delivered to.
    from sqlalchemy import select as _select
    from app.models.client import Client

    buyer_phone = card.get("buyer_phone")
    buyer_email = card.get("buyer_email")
    buyer_name = card.get("buyer_name") or "לקוח"

    buyer_client = None
    if buyer_phone:
        buyer_client = db.scalar(_select(Client).where(Client.studio_id == ctx.studio_id, Client.phone == buyer_phone))
    if not buyer_client and buyer_email:
        buyer_client = db.scalar(_select(Client).where(Client.studio_id == ctx.studio_id, Client.email == buyer_email))
    if not buyer_client:
        buyer_client = Client(
            id=uuid.uuid4(),
            studio_id=ctx.studio_id,
            full_name=buyer_name,
            phone=buyer_phone,
            email=buyer_email,
            notes="נרשם דרך רכישת כרטיס מתנה",
        )
        db.add(buyer_client)
        db.flush()

    # Revenue — the actual cash received, excluding any studio-funded bonus.
    paid_cents = card["amount_cents"] - (card.get("bonus_cents") or 0)
    try:
        pos_txn_id = uuid.uuid4()
        db.execute(
            text("""
                INSERT INTO pos_transactions (id, studio_id, client_id, total_cents, method, status, notes)
                VALUES (:id, :sid, :cid, :total, 'other', 'paid', :notes)
            """),
            {
                "id": str(pos_txn_id), "sid": str(ctx.studio_id), "cid": str(buyer_client.id),
                "total": paid_cents, "notes": f"מכירת כרטיס מתנה {card['code']}",
            }
        )
        db.execute(
            text("""
                INSERT INTO pos_transaction_items (id, transaction_id, description, quantity, unit_price_cents, total_price_cents)
                VALUES (:id, :tid, :desc, 1, :price, :price)
            """),
            {
                "id": str(uuid.uuid4()), "tid": str(pos_txn_id),
                "desc": f"כרטיס מתנה - {card['code']}", "price": paid_cents,
            }
        )
        db.commit()
    except Exception:
        log.exception("[GiftCard] pos-transaction revenue record failed for %s", card_id)

    try:
        invoice_id = _create_gift_card_invoice(db, ctx.studio_id, card_id, card["code"], buyer_client, paid_cents)
        if body.send_receipt:
            _enqueue_gift_card_receipt_link(db, ctx.studio_id, invoice_id, buyer_client)
    except Exception:
        log.exception("[GiftCard] invoice/receipt creation failed for %s", card_id)

    if card.get("deliver_to") == "recipient":
        target_name = card.get("recipient_name")
        target_email = card.get("recipient_email")
        target_phone = card.get("recipient_phone")
    else:
        target_name = card.get("buyer_name")
        target_email = card.get("buyer_email")
        target_phone = card.get("buyer_phone")

    studio_row = db.execute(
        text("""
            SELECT s.name, COALESCE(s.logo_url, mp.logo_url) AS logo_url, ss.logo_filename, ss.gift_voucher_theme
            FROM studios s
            LEFT JOIN studio_settings ss ON ss.studio_id = s.id
            LEFT JOIN marketplace_profiles mp ON mp.studio_id = s.id
            WHERE s.id = :sid
        """),
        {"sid": str(ctx.studio_id)}
    ).fetchone()
    studio_name = studio_row[0] if studio_row else "הסטודיו"
    logo_image = _fetch_studio_logo(studio_row[1] if studio_row else None, studio_row[2] if studio_row else None)
    voucher_theme = (studio_row[3] if studio_row else None) or "black_gold"

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
            logo_image=logo_image,
            theme=voucher_theme,
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

    # When the gift itself goes straight to the recipient, the buyer never
    # sees the voucher — send them a separate thank-you confirmation instead.
    if card.get("deliver_to") == "recipient":
        try:
            from app.models.message_job import MessageJob
            recipient_display = card.get("recipient_name") or "הנמען/ת"
            thank_you_body = (
                f"🎁 תודה על הרכישה!\n"
                f"כרטיס המתנה שלך ל-{studio_name} בשווי ₪{card['amount_cents'] / 100:.0f} "
                f"נשלח בהצלחה ל-{recipient_display}."
            )
            if buyer_client.phone:
                db.add(MessageJob(
                    studio_id=ctx.studio_id,
                    client_id=buyer_client.id,
                    channel="whatsapp",
                    to_phone=buyer_client.phone,
                    body=thank_you_body,
                    scheduled_at=datetime.now(timezone.utc),
                    status="pending",
                    reminder_type="gift_card_buyer_thanks",
                ))
            if buyer_client.email:
                from app.utils.email_templates import _email_base
                email_html = (
                    f"<p>שלום <strong>{buyer_client.full_name or ''}</strong>,</p>"
                    f"<p>תודה על הרכישה! 🙏<br>כרטיס המתנה שלך ל-{studio_name} בשווי ₪{card['amount_cents'] / 100:.0f} "
                    f"נשלח בהצלחה ל-<strong>{recipient_display}</strong>.</p>"
                )
                db.add(MessageJob(
                    studio_id=ctx.studio_id,
                    client_id=buyer_client.id,
                    channel="email",
                    to_phone=buyer_client.email,
                    subject=f"🎁 תודה על הרכישה — כרטיס המתנה נשלח ל-{recipient_display}",
                    body=_email_base("תודה על הרכישה! 🙏", email_html),
                    scheduled_at=datetime.now(timezone.utc),
                    status="pending",
                    reminder_type="gift_card_buyer_thanks_email",
                ))
            db.commit()
        except Exception:
            log.exception("[GiftCard] buyer thank-you notification failed for %s", card_id)

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
