import os
import shutil
from uuid import uuid4
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.studio_settings import StudioSettings
from app.models.studio import Studio

router = APIRouter(prefix="/studio/upload", tags=["Uploads"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"}


def _save_image(file: UploadFile, prefix: str, studio_id) -> str:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    ext = (file.filename or "img.jpg").rsplit(".", 1)[-1].lower()
    filename = f"{prefix}_{studio_id}_{uuid4().hex[:10]}.{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    return filename


# ── Logo ──────────────────────────────────────────────────────────────────────

@router.post("/logo")
def upload_logo(
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")
    filename = _save_image(file, "logo", ctx.studio_id)
    if settings.logo_filename:
        old = os.path.join(UPLOAD_DIR, settings.logo_filename)
        if os.path.exists(old):
            os.remove(old)
    settings.logo_filename = filename
    db.commit()
    return {"filename": filename}


@router.post("/image")
def upload_generic_image(
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(require_studio_ctx)
):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    filename = _save_image(file, "image", ctx.studio_id)
    return {"filename": filename}


# ── Cover photo ───────────────────────────────────────────────────────────────

@router.post("/cover")
def upload_cover(
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    settings = db.get(StudioSettings, ctx.studio_id)
    if not settings:
        raise HTTPException(status_code=404, detail="Settings not found")
    filename = _save_image(file, "cover", ctx.studio_id)
    url = f"/uploads/{filename}"
    settings.marketplace_cover_url = url
    db.commit()
    return {"url": url}


# ── Gallery ───────────────────────────────────────────────────────────────────

@router.get("/gallery")
def list_gallery(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    rows = db.execute(
        text("SELECT id, url, caption, sort_order, created_at FROM studio_gallery WHERE studio_id=:sid ORDER BY sort_order, created_at"),
        {"sid": str(ctx.studio_id)}
    ).fetchall()
    return [{"id": str(r[0]), "url": r[1], "caption": r[2], "sort_order": r[3], "created_at": str(r[4])} for r in rows]


@router.post("/gallery")
def upload_gallery_photo(
    file: UploadFile = File(...),
    caption: Optional[str] = Form(None),
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    count = db.execute(
        text("SELECT COUNT(*) FROM studio_gallery WHERE studio_id=:sid"),
        {"sid": str(ctx.studio_id)}
    ).scalar() or 0
    if count >= 20:
        raise HTTPException(status_code=400, detail="מקסימום 20 תמונות בגלריה")
    gallery_dir = os.path.join(UPLOAD_DIR, "gallery", str(ctx.studio_id))
    os.makedirs(gallery_dir, exist_ok=True)
    ext = (file.filename or "img.jpg").rsplit(".", 1)[-1].lower()
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    filename = f"{uuid4().hex}.{ext}"
    path = os.path.join(gallery_dir, filename)
    with open(path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    url = f"/uploads/gallery/{ctx.studio_id}/{filename}"
    db.execute(
        text("INSERT INTO studio_gallery (studio_id, url, caption, sort_order) VALUES (:sid, :url, :caption, :sort)"),
        {"sid": str(ctx.studio_id), "url": url, "caption": caption, "sort": int(count)}
    )
    db.commit()
    row = db.execute(
        text("SELECT id, url, caption, sort_order FROM studio_gallery WHERE studio_id=:sid AND url=:url"),
        {"sid": str(ctx.studio_id), "url": url}
    ).fetchone()
    return {"id": str(row[0]), "url": row[1], "caption": row[2], "sort_order": row[3]}


@router.delete("/gallery/{photo_id}")
def delete_gallery_photo(
    photo_id: str,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")
    row = db.execute(
        text("SELECT url FROM studio_gallery WHERE id=:pid AND studio_id=:sid"),
        {"pid": photo_id, "sid": str(ctx.studio_id)}
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    file_path = row[0].lstrip("/")
    if os.path.exists(file_path):
        os.remove(file_path)
    db.execute(text("DELETE FROM studio_gallery WHERE id=:pid"), {"pid": photo_id})
    db.commit()
    return {"ok": True}


# ── Business type (for studio owner) ─────────────────────────────────────────

@router.get("/business-type-options")
def get_business_type_options(
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    studio = db.get(Studio, ctx.studio_id)
    rows = db.execute(
        text("SELECT business_type, display_name FROM business_type_templates ORDER BY display_name")
    ).fetchall()
    return {
        "current": studio.business_type if studio else "other",
        "options": [{"value": r[0], "label": r[1]} for r in rows]
    }


@router.patch("/business-type")
def set_business_type(
    payload: dict,
    ctx: AuthContext = Depends(require_studio_ctx),
    db: Session = Depends(get_db)
):
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
    bt = payload.get("business_type", "other")
    studio = db.get(Studio, ctx.studio_id)
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    studio.business_type = bt
    db.commit()
    return {"business_type": bt}
