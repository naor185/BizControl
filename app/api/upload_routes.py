import os
import shutil
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_studio_ctx, AuthContext
from app.models.studio_settings import StudioSettings

router = APIRouter(prefix="/studio/upload", tags=["Uploads"])

UPLOAD_DIR = "uploads"

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)

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

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    file_extension = file.filename.split(".")[-1]
    new_filename = f"logo_{ctx.studio_id}_{uuid4().hex[:8]}.{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, new_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Optional: remove old logo if exists to save space
    if settings.logo_filename:
        old_path = os.path.join(UPLOAD_DIR, settings.logo_filename)
        if os.path.exists(old_path):
            os.remove(old_path)

    settings.logo_filename = new_filename
    db.commit()

    return {"filename": new_filename}

@router.post("/image")
def upload_generic_image(
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(require_studio_ctx)
):
    if ctx.role not in ("owner", "admin", "manager"):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    file_extension = file.filename.split(".")[-1]
    new_filename = f"image_{ctx.studio_id}_{uuid4().hex[:8]}.{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, new_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"filename": new_filename}
