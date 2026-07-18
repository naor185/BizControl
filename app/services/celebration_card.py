"""
Points-redemption celebration card — a festive, shareable image sent to a
client who redeems a large amount of loyalty points/cashback in one payment.
Designed to be screenshot/story-worthy (confetti, bold savings figure, club
branding) so it doubles as free marketing for the studio's loyalty club.
"""
from __future__ import annotations

import random
from typing import Optional


def _draw_confetti(img, count: int = 90) -> None:
    """Scatter small rotated colored rectangles across the image as a
    background layer, drawn before the panel/text so the panel's opaque
    fill naturally covers the pieces behind it."""
    from PIL import Image

    palette = [
        (255, 107, 157), (255, 209, 102), (6, 214, 160),
        (17, 138, 178), (239, 71, 111), (255, 255, 255),
    ]
    W, H = img.size
    for _ in range(count):
        w_piece, h_piece = random.randint(10, 22), random.randint(6, 12)
        color = random.choice(palette) + (215,)
        piece = Image.new("RGBA", (w_piece, h_piece), color)
        rotated = piece.rotate(random.randint(0, 359), expand=True)
        x = random.randint(0, max(0, W - rotated.width))
        y = random.randint(0, max(0, H - rotated.height))
        img.paste(rotated, (x, y), rotated)


def build_points_celebration_png(
    studio_name: str,
    client_name: str,
    amount_saved_ils: float,
    join_link: Optional[str] = None,
    logo_image=None,
) -> bytes:
    """Draw a festive landscape PNG (WhatsApp-friendly, previews inline)
    celebrating a big points/cashback redemption."""
    import io
    from PIL import Image, ImageDraw, ImageFont
    from app.api.invoice_routes import _find_font_path
    from app.api.gift_card_routes import _h

    W, H = 1200, 750
    BG_TOP = (255, 94, 140)     # warm coral-pink
    BG_BOTTOM = (255, 175, 64)  # warm gold
    PANEL_FILL = (255, 255, 255)
    PANEL_BORDER = (255, 255, 255)
    TITLE_COLOR = (255, 255, 255)
    AMOUNT_COLOR = (239, 71, 111)
    TEXT_DARK = (51, 41, 45)
    MUTED = (148, 130, 128)

    img = Image.new("RGB", (W, H), BG_TOP)
    draw = ImageDraw.Draw(img)
    for y in range(H):
        ratio = y / H
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * ratio)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * ratio)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * ratio)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    _draw_confetti(img)
    draw = ImageDraw.Draw(img)  # re-bind after paste() calls touched the buffer

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
            logo_h = 80
            ratio = logo_h / logo_image.height
            logo_w = int(logo_image.width * ratio)
            logo_resized = logo_image.resize((logo_w, logo_h))
            img.paste(logo_resized, ((W - logo_w) // 2, title_y), logo_resized)
            title_y += logo_h + 20
        except Exception:
            pass

    center_text(title_y, f"כל הכבוד, {client_name}!", font(46, bold=True), TITLE_COLOR)

    pad = 60
    panel_top = title_y + 90
    draw.rounded_rectangle([pad, panel_top, W - pad, H - pad], radius=28, fill=PANEL_FILL, outline=PANEL_BORDER, width=2)

    center_text(panel_top + 44, "היום חסכת", font(28), MUTED)
    center_text(panel_top + 88, f"₪{amount_saved_ils:.0f}", font(88, bold=True), AMOUNT_COLOR)
    center_text(panel_top + 200, f"בזכות מועדון הלקוחות של {studio_name}", font(24, bold=True), TEXT_DARK)

    if join_link:
        box_top = H - pad - 110
        draw.rounded_rectangle([pad + 40, box_top, W - pad - 40, box_top + 78], radius=16, fill=(255, 240, 235))
        center_text(box_top + 16, "עוד לא חבר/ה במועדון?", font(18, bold=True), (200, 90, 60))
        center_text(box_top + 44, join_link, font(20), (200, 90, 60))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def save_celebration_image(image_bytes: bytes, studio_id: str, db=None) -> Optional[str]:
    """Save the celebration PNG — Cloudinary if configured, otherwise local uploads/."""
    import logging
    import os
    import uuid
    from datetime import datetime

    log = logging.getLogger(__name__)
    public_id = f"celebration_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    try:
        from app.api.upload_routes import _cloudinary_upload
        cloud_url = _cloudinary_upload(image_bytes, folder=f"celebration-cards/{studio_id}", public_id=public_id, db=db)
        if cloud_url:
            return cloud_url
    except Exception as e:
        log.debug("Cloudinary not available: %s", e)
    try:
        upload_dir = os.path.join("uploads", "celebration-cards", studio_id)
        os.makedirs(upload_dir, exist_ok=True)
        fname = f"{public_id}.png"
        with open(os.path.join(upload_dir, fname), "wb") as fh:
            fh.write(image_bytes)
        return f"/uploads/celebration-cards/{studio_id}/{fname}"
    except Exception as e:
        log.warning("Could not save celebration image: %s", e)
        return None
