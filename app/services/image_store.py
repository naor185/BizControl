"""Saving an uploaded image — Cloudinary when it is set up (production), otherwise the server's own uploads/ folder
(local runs and tests)."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone

log = logging.getLogger(__name__)


def save_image(image_bytes: bytes, content_type: str, folder: str, prefix: str, db=None) -> str | None:
    """The image's address, or None when it couldn't be saved anywhere."""
    ext = (content_type or "image/jpeg").split("/")[-1].replace("jpeg", "jpg")
    public_id = f"{prefix}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    try:
        from app.api.upload_routes import _cloudinary_upload
        cloud_url = _cloudinary_upload(image_bytes, folder=folder, public_id=public_id, db=db)
        if cloud_url:
            return cloud_url
    except Exception as e:
        log.debug("Cloudinary not available: %s", e)
    try:
        upload_dir = os.path.join("uploads", *folder.split("/"))
        os.makedirs(upload_dir, exist_ok=True)
        fname = f"{public_id}.{ext}"
        with open(os.path.join(upload_dir, fname), "wb") as fh:
            fh.write(image_bytes)
        return f"/uploads/{folder}/{fname}"
    except Exception as e:
        log.warning("Could not save image: %s", e)
        return None
