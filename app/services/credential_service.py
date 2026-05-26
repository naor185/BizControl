"""
Encrypted credential storage for sensitive platform tokens.
Super Admin injects → stored encrypted → service decrypts at runtime.
Regular users never see raw values.
"""
from __future__ import annotations
import base64
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.studio_credential import StudioCredential
from app.utils.logger import get_logger

log = get_logger(__name__)

_fernet = None


def _get_fernet():
    global _fernet
    if _fernet is None:
        from cryptography.fernet import Fernet
        key = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "")
        if not key:
            # Generate a stable key from JWT_SECRET so existing deployments don't break
            import hashlib
            jwt_secret = os.getenv("JWT_SECRET", "bizcontrol-insecure-default")
            key_bytes = hashlib.sha256(jwt_secret.encode()).digest()
            key = base64.urlsafe_b64encode(key_bytes).decode()
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()


def set_credential(
    db: Session,
    studio_id: uuid.UUID,
    platform: str,
    key_name: str,
    value: str,
    injected_by: uuid.UUID | None = None,
    expires_at: datetime | None = None,
    notes: str | None = None,
) -> None:
    """Upsert an encrypted credential for a studio."""
    existing = db.scalar(
        select(StudioCredential).where(
            StudioCredential.studio_id == studio_id,
            StudioCredential.platform == platform,
            StudioCredential.key_name == key_name,
        )
    )
    encrypted = encrypt(value)
    if existing:
        existing.encrypted_value = encrypted
        existing.injected_by = injected_by
        existing.injected_at = datetime.now(timezone.utc)
        existing.expires_at = expires_at
        existing.notes = notes
    else:
        db.add(StudioCredential(
            id=uuid.uuid4(),
            studio_id=studio_id,
            platform=platform,
            key_name=key_name,
            encrypted_value=encrypted,
            injected_by=injected_by,
            injected_at=datetime.now(timezone.utc),
            expires_at=expires_at,
            notes=notes,
        ))
    db.commit()


def get_credential(db: Session, studio_id: uuid.UUID, platform: str, key_name: str) -> Optional[str]:
    """Retrieve and decrypt a credential. Returns None if not found or expired."""
    row = db.scalar(
        select(StudioCredential).where(
            StudioCredential.studio_id == studio_id,
            StudioCredential.platform == platform,
            StudioCredential.key_name == key_name,
        )
    )
    if not row:
        return None
    if row.expires_at and row.expires_at < datetime.now(timezone.utc):
        log.warning("[credentials] expired: studio=%s platform=%s key=%s", studio_id, platform, key_name)
        return None
    try:
        return decrypt(row.encrypted_value)
    except Exception as e:
        log.error("[credentials] decrypt failed: %s", e)
        return None


def delete_credential(db: Session, studio_id: uuid.UUID, platform: str, key_name: str) -> bool:
    row = db.scalar(
        select(StudioCredential).where(
            StudioCredential.studio_id == studio_id,
            StudioCredential.platform == platform,
            StudioCredential.key_name == key_name,
        )
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def list_credentials_meta(db: Session, studio_id: uuid.UUID) -> list[dict]:
    """Return credential metadata (no raw values) for display in admin UI."""
    rows = db.scalars(
        select(StudioCredential).where(StudioCredential.studio_id == studio_id)
    ).all()
    return [
        {
            "platform": r.platform,
            "key_name": r.key_name,
            "has_value": bool(r.encrypted_value),
            "injected_at": r.injected_at.isoformat() if r.injected_at else None,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "notes": r.notes,
        }
        for r in rows
    ]
